const { test: base, expect } = require('@playwright/test');
const {
  GITHUB_API,
  REQRES_API,
  DUMMYJSON_API,
  DEFAULT_TOKEN_TTL_MS,
  REQRES_CREDENTIALS,
  githubHeaders,
  parseRateLimit,
  isRateLimited,
  fetchRateLimitStatus,
  exhaustRateLimit,
  msUntilReset,
  TokenExpiredError,
  ExternalQuotaExceededError,
  reqresQuotaExceeded,
  TokenManager,
  isTokenRejected,
  authorizedGet,
  reqresHeaders,
  loginReqRes,
  loginDummyJson,
} = require('./utils/api-helper');

/**
 * Sessão autenticada compartilhada por worker: o login acontece uma única vez
 * e todos os testes que pedem `sessao` reutilizam o mesmo TokenManager.
 * (Fixtures de worker não acessam `request`, por isso o contexto é criado aqui.)
 */
const test = base.extend({
  sessao: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      const tokenManager = new TokenManager({ login: () => loginDummyJson(request) });
      await use({ request, tokenManager });
      await request.dispose();
    },
    { scope: 'worker' },
  ],
});

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

const USERS_URL = `${GITHUB_API}/users/github`;
// A busca tem cota própria e curta (10/min sem token, 30/min com token),
// separada da cota "core" (60/h) e com as mesmas regras e headers. Serve para
// os testes que precisam de cota disponível ou de esperar o reset.
const SEARCH_URL = `${GITHUB_API}/search/users?q=github&per_page=1`;

/**
 * Garante cota disponível antes do teste: se a cota de busca (janela de 1 min)
 * estiver abaixo do mínimo, espera o reset informado pela própria API em vez
 * de pular o teste.
 */
async function aguardarCota(request, recurso, minimo) {
  const cota = (await fetchRateLimitStatus(request))[recurso];
  if (cota.remaining >= minimo) return;

  const espera = Math.max(0, cota.reset * 1000 - Date.now()) + 2_000;
  expect(espera, `Cota "${recurso}" só reinicia em ${Math.round(espera / 1000)}s`).toBeLessThanOrEqual(65_000);
  test.info().annotations.push({ type: 'aguardou-reset', description: `${recurso}: ${Math.round(espera / 1000)}s` });
  await sleep(espera);
}

test.describe('GitHub API - rate limiting', () => {
  test('CT-API-01 - headers de rate limit presentes e consistentes em GET /users/github', async ({ request }) => {
    const response = await request.get(USERS_URL, { headers: githubHeaders() });
    const rl = parseRateLimit(response);

    if (process.env.GITHUB_TOKEN) {
      // PAT: 5000/h; token do GitHub Actions: 1000/h. Em ambos, acima do anônimo.
      expect(rl.limit).toBeGreaterThan(60);
    } else {
      expect(rl.limit).toBe(60);
    }
    expect(rl.resource).toBe('core');
    expect(Number.isInteger(rl.remaining)).toBe(true);
    expect(rl.remaining).toBeGreaterThanOrEqual(0);
    // Esta própria requisição consumiu cota, então remaining < limit.
    expect(rl.remaining).toBeLessThan(rl.limit);
    expect(rl.used + rl.remaining).toBe(rl.limit);

    // Reset é um epoch UTC em segundos, no futuro e dentro da janela de 1 hora
    // (5s de tolerância para diferença de relógio).
    const agora = Date.now() / 1000;
    expect(rl.reset).toBeGreaterThan(agora - 5);
    expect(rl.reset).toBeLessThanOrEqual(agora + 3600 + 5);

    if (isRateLimited(response)) {
      // O CT-API-05 esgota a cota anônima do IP de propósito; numa nova execução
      // dentro da mesma hora a resposta é 403, e os headers continuam obrigatórios
      // (são eles que dizem ao cliente quando pode voltar).
      test.info().annotations.push({ type: 'cota-core', description: 'esgotada: headers validados na resposta 403' });
      expect(rl.remaining).toBe(0);
    } else {
      expect(response.status()).toBe(200);
      expect((await response.json()).login).toBe('github');
    }
  });

  test('CT-API-02 - X-RateLimit-Remaining decrementa 1 a cada requisição', async ({ request }) => {
    test.setTimeout(120_000);
    // Usa a cota de busca: a cota core pode estar esgotada pelo CT-API-05 de uma execução anterior.
    await aguardarCota(request, 'search', 2);

    const primeira = parseRateLimit(await request.get(SEARCH_URL, { headers: githubHeaders() }));
    const segunda = parseRateLimit(await request.get(SEARCH_URL, { headers: githubHeaders() }));

    if (segunda.reset === primeira.reset) {
      expect(segunda.remaining).toBe(primeira.remaining - 1);
      expect(segunda.used).toBe(primeira.used + 1);
    } else {
      // A janela reiniciou entre as duas chamadas: a segunda é a 1ª da nova janela.
      expect(segunda.remaining).toBe(segunda.limit - 1);
    }
  });

  test('CT-API-03 - GET /rate_limit informa a cota sem consumi-la', async ({ request }) => {
    const antes = await fetchRateLimitStatus(request);
    const depois = await fetchRateLimitStatus(request);

    for (const recurso of ['core', 'search']) {
      expect(depois[recurso].limit).toBeGreaterThan(0);
      if (depois[recurso].reset === antes[recurso].reset) {
        expect(depois[recurso].used).toBe(antes[recurso].used);
      }
    }
  });

  test('CT-API-04 - token inválido é rejeitado com 401 (não cai silenciosamente para anônimo)', async ({ request }) => {
    const response = await request.get(USERS_URL, { headers: githubHeaders({ token: 'token-invalido' }) });

    expect(response.status()).toBe(401);
    expect((await response.json()).message).toBe('Bad credentials');
  });

  // Tag @esgota-cota: o CI de push/PR roda sem este teste (--grep-invert) para não
  // esgotar a cota do IP compartilhado dos runners; o job agendado roda a suíte completa.
  test('CT-API-05 - GET /users/github: ao exceder o limite a API responde 403 com remaining = 0', {
    tag: '@esgota-cota',
  }, async ({ request }) => {
    test.setTimeout(120_000);

    // Sempre anônimo (60/h por IP), mesmo com GITHUB_TOKEN: esgotar 5000 req seria inviável.
    // Efeito colateral conhecido: a cota anônima do IP fica esgotada até o reset (até 1h).
    // O teste é idempotente: se a cota já estiver esgotada, a 1ª resposta já é o 403.
    const { response, statuses, initial, limited } = await exhaustRateLimit(request, USERS_URL, {
      headers: githubHeaders({ token: '' }),
    });
    test.info().annotations.push({ type: 'requisicoes-ate-o-bloqueio', description: String(statuses.length) });

    expect(limited, `Sequência de status recebida: ${statuses.join(',')}`).toBe(true);
    expect(response.status()).toBe(403);

    const rl = parseRateLimit(response);
    expect(rl).toMatchObject({ limit: 60, remaining: 0, resource: 'core' });
    expect(rl.reset * 1000).toBeGreaterThan(Date.now() - 5000);

    const body = await response.json();
    expect(body.message).toMatch(/rate limit exceeded/i);
    expect(body.documentation_url).toContain('docs.github.com');

    // Se a cota estava disponível no início, o bloqueio acontece exatamente na
    // requisição seguinte à última permitida: todas as anteriores foram 200.
    if (statuses[0] === 200) {
      expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
      expect(statuses).toHaveLength(initial.remaining + 2);
    }
  });

  test('CT-API-06 - após o reset informado no header a API volta a responder 200', async ({ request }) => {
    test.setTimeout(150_000);

    // A cota de busca reinicia a cada minuto, o que torna viável esperar o reset no teste.
    const { response, statuses } = await exhaustRateLimit(request, SEARCH_URL);
    expect(isRateLimited(response), `Sequência de status recebida: ${statuses.join(',')}`).toBe(true);
    expect(response.status()).toBe(403);
    expect(parseRateLimit(response)).toMatchObject({ remaining: 0, resource: 'search' });

    // O tempo de espera vem da própria resposta (X-RateLimit-Reset / Retry-After).
    const espera = msUntilReset(response);
    expect(espera).toBeLessThanOrEqual(65_000);
    await sleep(espera);

    // Poll curto cobre diferença entre o relógio local e o do servidor.
    await expect
      .poll(async () => (await request.get(SEARCH_URL, { headers: githubHeaders() })).status(), {
        timeout: 20_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBe(200);
  });
});

/*
 * O ReqRes limita o uso anônimo por IP (40 req/dia; esta suíte usa ~10 por
 * execução). Cota esgotada é condição do ambiente, não defeito: o teste é
 * pulado com o motivo e o horário de reset, em vez de falhar. Com
 * REQRES_API_KEY (conta gratuita) a cota é maior.
 */
async function pularSeCotaReqResEsgotada(response) {
  const motivo = await reqresQuotaExceeded(response);
  test.skip(!!motivo, motivo);
}

/** Função de login para o TokenManager que pula o teste se a cota do ReqRes estiver esgotada. */
const loginReqResOuPular = (request) => async () => {
  try {
    return await loginReqRes(request);
  } catch (erro) {
    test.skip(erro instanceof ExternalQuotaExceededError, erro.message);
    throw erro;
  }
};

test.describe('ReqRes - login e cache de token', () => {
  test('CT-API-07 - login válido retorna token', async ({ request }) => {
    const response = await request.post(`${REQRES_API}/api/login`, {
      data: REQRES_CREDENTIALS,
      headers: reqresHeaders(),
    });
    await pularSeCotaReqResEsgotada(response);

    expect(response.status()).toBe(200);
    const { token } = await response.json();
    expect(token).toMatch(/^[A-Za-z0-9]{10,}$/);
  });

  const loginsInvalidos = [
    { caso: 'sem senha', data: { email: REQRES_CREDENTIALS.email }, erro: 'Missing password' },
    { caso: 'sem e-mail', data: { password: REQRES_CREDENTIALS.password }, erro: 'Missing email or username' },
    { caso: 'usuário inexistente', data: { email: 'nao.existe@reqres.in', password: 'x' }, erro: 'user not found' },
  ];
  for (const { caso, data, erro } of loginsInvalidos) {
    test(`CT-API-08 - login ${caso} retorna 400 sem token`, async ({ request }) => {
      const response = await request.post(`${REQRES_API}/api/login`, { data, headers: reqresHeaders() });
      await pularSeCotaReqResEsgotada(response);

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe(erro);
      expect(body.token).toBeUndefined();
    });
  }

  test('CT-API-09 - TokenManager faz login uma vez e reutiliza o token', async ({ request }) => {
    const tokenManager = new TokenManager({ login: loginReqResOuPular(request) });

    const tokens = [await tokenManager.getToken(), await tokenManager.getToken(), await tokenManager.getToken()];

    expect(tokenManager.loginCount).toBe(1);
    expect(new Set(tokens).size).toBe(1);
  });

  test(`CT-API-10 - expiração simulada (TTL ${DEFAULT_TOKEN_TTL_MS / 1000}s) é detectada e o token é renovado`, async ({ request }) => {
    // Relógio controlado pelo teste: simula a passagem do tempo sem esperar 2 minutos.
    let agora = Date.now();
    const tokenManager = new TokenManager({
      login: loginReqResOuPular(request),
      ttlMs: DEFAULT_TOKEN_TTL_MS,
      now: () => agora,
    });
    const token = await tokenManager.getToken();

    agora += DEFAULT_TOKEN_TTL_MS - 1;
    expect(tokenManager.isExpired()).toBe(false);
    expect(tokenManager.assertValid()).toBe(token);

    agora += 1;
    expect(tokenManager.isExpired()).toBe(true);
    expect(() => tokenManager.assertValid()).toThrow(TokenExpiredError);

    // Tratamento: o próximo getToken renova automaticamente.
    await tokenManager.getToken();
    expect(tokenManager.loginCount).toBe(2);
    expect(tokenManager.isExpired()).toBe(false);
  });

  test('CT-API-11 - fluxo do enunciado no ReqRes: token Bearer em GET /api/users/2 é recusado (contrato atual)', async ({
    request,
  }) => {
    // Executa exatamente o fluxo pedido: login -> token -> GET /api/users/2 com Bearer.
    const tokenManager = new TokenManager({ login: loginReqResOuPular(request) });
    const token = await tokenManager.getToken();

    const comToken = await request.get(`${REQRES_API}/api/users/2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await pularSeCotaReqResEsgotada(comToken);

    // Evidência da mudança de contrato que levou o fluxo autenticado para o
    // DummyJSON (CT-API-12 a 15): o ReqRes reserva Bearer para /app/* (sessão
    // por magic link) e exige x-api-key em /api/*.
    expect(comToken.status()).toBe(401);
    const body = await comToken.json();
    expect(body.error).toBe('missing_api_key');
    expect(body.hint).toMatch(/Bearer/);

    // Sem o token o mesmo recurso responde 200: o token do login não é usado
    // pelo ReqRes para autenticar nada, então não há o que reutilizar ali.
    const semToken = await request.get(`${REQRES_API}/api/users/2`);
    await pularSeCotaReqResEsgotada(semToken);
    expect(semToken.status()).toBe(200);
    expect((await semToken.json()).data.id).toBe(2);
  });
});

/*
 * Fluxo autenticado com o DummyJSON (troca de API permitida pelo enunciado):
 * o token do login é exigido nas chamadas seguintes, é um JWT com expiração
 * real (`expiresInMins`) e o servidor responde 401 quando ele vence.
 */
test.describe('DummyJSON - login, reuso do token e expiração real', () => {
  test('CT-API-12 - login obtém o token e o reutiliza em requisição autenticada (GET /auth/me)', async ({
    sessao,
  }) => {
    const { request, tokenManager } = sessao;

    const { response } = await authorizedGet(request, tokenManager, `${DUMMYJSON_API}/auth/me`);

    expect(response.status()).toBe(200);
    expect((await response.json()).username).toBe('emilys');
    // O mesmo token, sem novo login, é aceito também numa segunda chamada.
    const { response: segunda } = await authorizedGet(request, tokenManager, `${DUMMYJSON_API}/auth/me`);
    expect(segunda.status()).toBe(200);
    expect(tokenManager.loginCount).toBe(1);
  });

  test('CT-API-13 - outro teste reaproveita o mesmo token, sem novo login', async ({ sessao }) => {
    const { request, tokenManager } = sessao;

    const { response } = await authorizedGet(request, tokenManager, `${DUMMYJSON_API}/auth/products/1`);

    expect(response.status()).toBe(200);
    expect((await response.json()).id).toBe(1);
    // Login aconteceu uma única vez para o worker inteiro.
    expect(tokenManager.loginCount).toBe(1);
  });

  test('CT-API-14 - requisição sem token ou com token inválido retorna 401', async ({ request }) => {
    const semToken = await request.get(`${DUMMYJSON_API}/auth/me`);
    expect(semToken.status()).toBe(401);
    expect((await semToken.json()).message).toBe('Access Token is required');

    const tokenInvalido = await request.get(`${DUMMYJSON_API}/auth/me`, {
      headers: { Authorization: 'Bearer token-invalido' },
    });
    expect(tokenInvalido.status()).toBe(401);
    expect((await tokenInvalido.json()).message).toBe('Invalid/Expired Token!');
    expect(await isTokenRejected(tokenInvalido)).toBe(true);
  });

  test('CT-API-15 - token de 1 min expira no servidor, é detectado e renovado', async ({ request }) => {
    test.setTimeout(150_000);

    const tokenManager = new TokenManager({ login: () => loginDummyJson(request, { expiresInMins: 1 }) });
    const tokenOriginal = await tokenManager.getToken();
    const meComToken = (/** @type {string} */ token) =>
      request.get(`${DUMMYJSON_API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });

    expect((await meComToken(tokenOriginal)).status()).toBe(200);

    // Espera até o `exp` do JWT (+2s) e confirma que o servidor recusa o token.
    await sleep(Math.max(0, tokenManager.expiresAt - Date.now()) + 2_000);
    expect(tokenManager.isExpired()).toBe(true);
    await expect
      .poll(async () => (await meComToken(tokenOriginal)).status(), { timeout: 15_000 })
      .toBe(401);
    // A API distingue token vencido ("Token Expired!") de token inválido ("Invalid/Expired Token!").
    const expirado = await meComToken(tokenOriginal);
    expect((await expirado.json()).message).toBe('Token Expired!');
    expect(await isTokenRejected(expirado)).toBe(true);

    // Detecção reativa: cliente com relógio divergente ainda acha o token
    // válido. A resposta 401 dispara invalidação, novo login e nova tentativa.
    const tokensEmCache = [tokenOriginal];
    const clienteDesatualizado = new TokenManager({
      login: async () =>
        tokensEmCache.length
          ? { token: /** @type {string} */ (tokensEmCache.shift()), expiresAt: Number.POSITIVE_INFINITY }
          : loginDummyJson(request, { expiresInMins: 1 }),
    });
    const { response, renewed, rejected } = await authorizedGet(
      request,
      clienteDesatualizado,
      `${DUMMYJSON_API}/auth/me`,
    );
    expect(rejected?.status()).toBe(401);
    expect(renewed).toBe(true);
    expect(response.status()).toBe(200);
    expect(clienteDesatualizado.loginCount).toBe(2);

    // Detecção proativa: o TokenManager original sabe que expirou e renova sozinho.
    const tokenNovo = await tokenManager.getToken();
    expect(tokenManager.loginCount).toBe(2);
    expect((await meComToken(tokenNovo)).status()).toBe(200);
  });
});

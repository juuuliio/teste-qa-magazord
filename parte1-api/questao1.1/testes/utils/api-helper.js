/**
 * Helpers da Parte 1.
 *
 * - Rate limit (GitHub): leitura tipada dos headers X-RateLimit-*, detecção de
 *   bloqueio e utilitários para esgotar/aguardar a cota de forma controlada.
 * - Token: TokenManager faz login uma única vez, reutiliza o token enquanto ele
 *   for válido e renova quando expira (expiração proativa pelo relógio e
 *   reativa pela resposta 401 do servidor).
 */

const GITHUB_API = 'https://api.github.com';
const REQRES_API = 'https://reqres.in';
const DUMMYJSON_API = 'https://dummyjson.com';

/** TTL simulado para tokens opacos (sem `exp`), como o do ReqRes. Padrão: 2 min. */
const DEFAULT_TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS) || 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

/** Headers recomendados pela documentação da GitHub REST API. */
function githubHeaders({ token = process.env.GITHUB_TOKEN } = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'teste-qa-magazord',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Converte os headers de rate limit em números. Header ausente vira NaN, o que
 * faz qualquer asserção numérica falhar de forma explícita.
 *
 * @param {import('@playwright/test').APIResponse} response
 */
function parseRateLimit(response) {
  const h = response.headers();
  const num = (/** @type {string} */ name) => (h[name] === undefined ? NaN : Number(h[name]));
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    used: num('x-ratelimit-used'),
    /** Epoch em segundos (UTC) em que a janela reinicia. */
    reset: num('x-ratelimit-reset'),
    resource: h['x-ratelimit-resource'],
    retryAfter: h['retry-after'] === undefined ? undefined : Number(h['retry-after']),
  };
}

/**
 * A GitHub sinaliza limite excedido com 403 (ou 429, segundo a documentação
 * atual) e X-RateLimit-Remaining = 0 (limite primário) ou Retry-After (limite
 * secundário). Só o status não basta: 403 também significa "sem permissão".
 *
 * @param {import('@playwright/test').APIResponse} response
 */
function isRateLimited(response) {
  if (![403, 429].includes(response.status())) return false;
  const { remaining, retryAfter } = parseRateLimit(response);
  return remaining === 0 || retryAfter !== undefined;
}

/**
 * GET /rate_limit: situação de todas as cotas. Esse endpoint NÃO consome cota,
 * por isso é usado como pré-condição dos testes (evita falso negativo quando a
 * cota do IP já foi gasta por execuções anteriores).
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<Record<string, { limit: number, remaining: number, used: number, reset: number }>>}
 */
async function fetchRateLimitStatus(request, headers = githubHeaders()) {
  const response = await request.get(`${GITHUB_API}/rate_limit`, { headers });
  if (!response.ok()) throw new Error(`GET /rate_limit falhou: ${response.status()} ${await response.text()}`);
  return (await response.json()).resources;
}

/**
 * Faz requisições sequenciais até a API responder com rate limit.
 * A quantidade máxima é derivada do próprio header (remaining + margem), para
 * nunca ficar em loop caso a API pare de limitar.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} url
 * @param {{ headers?: Record<string, string>, margem?: number }} [options]
 */
async function exhaustRateLimit(request, url, { headers = githubHeaders(), margem = 5 } = {}) {
  const statuses = [];
  let response = await request.get(url, { headers });
  statuses.push(response.status());
  const initial = parseRateLimit(response);
  const maxRequests = initial.remaining + margem;

  while (!isRateLimited(response) && statuses.length <= maxRequests) {
    response = await request.get(url, { headers });
    statuses.push(response.status());
  }
  return { response, statuses, initial, limited: isRateLimited(response) };
}

/** Milissegundos até o reset informado na resposta (+ folga para diferença de relógio). */
function msUntilReset(response, folgaMs = 2000) {
  const { reset, retryAfter } = parseRateLimit(response);
  if (retryAfter !== undefined) return retryAfter * 1000 + folgaMs;
  return Math.max(0, reset * 1000 - Date.now()) + folgaMs;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

class TokenExpiredError extends Error {
  /** @param {number} expiresAt */
  constructor(expiresAt) {
    super(`Token expirado em ${new Date(expiresAt).toISOString()}`);
    this.name = 'TokenExpiredError';
    this.expiresAt = expiresAt;
  }
}

/** Lê o `exp` de um JWT (sem validar assinatura). Retorna epoch em ms ou undefined. */
function jwtExpiresAt(token) {
  const [, payload] = String(token).split('.');
  if (!payload) return undefined;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @typedef {{ token: string, expiresAt?: number }} LoginResult
 */

/**
 * Cache de token com expiração.
 *
 * - `login`: função que autentica e devolve o token (injetada: serve para
 *   qualquer API).
 * - `ttlMs`: usado quando o token não informa a própria expiração (token opaco).
 * - `now`: relógio injetável; os testes avançam o tempo sem precisar esperar.
 * - `margemMs`: renova um pouco antes de expirar, evitando que o token vença
 *   entre a checagem e o uso.
 */
class TokenManager {
  /**
   * @param {{ login: () => Promise<LoginResult>, ttlMs?: number, now?: () => number, margemMs?: number }} options
   */
  constructor({ login, ttlMs = DEFAULT_TOKEN_TTL_MS, now = Date.now, margemMs = 0 }) {
    this.login = login;
    this.ttlMs = ttlMs;
    this.now = now;
    this.margemMs = margemMs;
    /** @type {string | undefined} */
    this.token = undefined;
    this.expiresAt = 0;
    this.loginCount = 0;
  }

  isExpired() {
    return !this.token || this.now() >= this.expiresAt - this.margemMs;
  }

  /** Lança TokenExpiredError se o token atual não puder mais ser usado. */
  assertValid() {
    if (this.isExpired()) throw new TokenExpiredError(this.expiresAt);
    return /** @type {string} */ (this.token);
  }

  /** Força um novo login no próximo getToken (ex.: servidor respondeu 401). */
  invalidate() {
    this.token = undefined;
    this.expiresAt = 0;
  }

  /** Devolve o token em cache ou faz login se não houver token válido. */
  async getToken() {
    if (this.isExpired()) {
      const { token, expiresAt } = await this.login();
      this.loginCount += 1;
      this.token = token;
      this.expiresAt = expiresAt ?? jwtExpiresAt(token) ?? this.now() + this.ttlMs;
    }
    return /** @type {string} */ (this.token);
  }
}

/**
 * Resposta típica de token vencido/inválido: 401 com mensagem citando
 * expiração ou invalidez. Mantido separado para ser reaproveitado em outras APIs.
 *
 * @param {import('@playwright/test').APIResponse} response
 */
async function isTokenRejected(response) {
  if (response.status() !== 401) return false;
  const body = await response.text();
  return /expired|invalid/i.test(body);
}

/**
 * GET autenticado com renovação automática: se o servidor rejeitar o token
 * (expirou antes do previsto, foi revogado...), descarta o cache, faz login
 * de novo e repete a chamada uma única vez.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {TokenManager} tokenManager
 * @param {string} url
 */
async function authorizedGet(request, tokenManager, url) {
  const send = async () =>
    request.get(url, { headers: { Authorization: `Bearer ${await tokenManager.getToken()}` } });

  const first = await send();
  if (!(await isTokenRejected(first))) return { response: first, renewed: false, rejected: undefined };

  tokenManager.invalidate();
  return { response: await send(), renewed: true, rejected: first };
}

// ---------------------------------------------------------------------------
// Logins das APIs usadas nos testes
// ---------------------------------------------------------------------------

const REQRES_CREDENTIALS = { email: 'eve.holt@reqres.in', password: 'cityslicka' };
const DUMMYJSON_CREDENTIALS = { username: 'emilys', password: 'emilyspass' };

/** Cota de um serviço externo esgotada: condição do ambiente, não defeito do sistema testado. */
class ExternalQuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExternalQuotaExceededError';
  }
}

/**
 * O ReqRes limita o uso anônimo por IP (40 req/dia no plano demo) e responde
 * 429 `rate_limit_exceeded`. Devolve a mensagem para o motivo do skip, ou
 * undefined se a resposta não for de cota esgotada.
 *
 * @param {import('@playwright/test').APIResponse} response
 */
async function reqresQuotaExceeded(response) {
  if (response.status() !== 429) return undefined;
  const body = await response.json().catch(() => ({}));
  return (
    `Cota do ReqRes esgotada (${body.message ?? '429'}; reinicia em ${body.resets_in ?? '?'}, ` +
    'à meia-noite UTC). Para uma cota maior, defina REQRES_API_KEY com a chave de uma conta gratuita em app.reqres.in.'
  );
}

/** Chave opcional do ReqRes (plano gratuito); sem ela o login usa a cota demo compartilhada. */
function reqresHeaders() {
  return process.env.REQRES_API_KEY ? { 'x-api-key': process.env.REQRES_API_KEY } : {};
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<LoginResult>}
 */
async function loginReqRes(request, credentials = REQRES_CREDENTIALS) {
  const response = await request.post(`${REQRES_API}/api/login`, { data: credentials, headers: reqresHeaders() });
  const cotaEsgotada = await reqresQuotaExceeded(response);
  if (cotaEsgotada) throw new ExternalQuotaExceededError(cotaEsgotada);
  if (!response.ok()) throw new Error(`Login ReqRes falhou: ${response.status()} ${await response.text()}`);
  const { token } = await response.json();
  return { token };
}

/**
 * Login no DummyJSON: devolve um JWT com `exp` real, controlado por `expiresInMins`.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<LoginResult>}
 */
async function loginDummyJson(request, { expiresInMins = 30, ...credentials } = DUMMYJSON_CREDENTIALS) {
  const response = await request.post(`${DUMMYJSON_API}/auth/login`, {
    data: { ...DUMMYJSON_CREDENTIALS, ...credentials, expiresInMins },
  });
  if (!response.ok()) throw new Error(`Login DummyJSON falhou: ${response.status()} ${await response.text()}`);
  const { accessToken } = await response.json();
  return { token: accessToken, expiresAt: jwtExpiresAt(accessToken) };
}

module.exports = {
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
  jwtExpiresAt,
  isTokenRejected,
  authorizedGet,
  reqresHeaders,
  loginReqRes,
  loginDummyJson,
};

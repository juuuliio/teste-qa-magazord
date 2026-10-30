# Questão 1.1 - Rate Limiting e Autenticação com Token

Implementação: [`testes/api.spec.js`](testes/api.spec.js) e [`testes/utils/api-helper.js`](testes/utils/api-helper.js).

---

## 1.1.a) Como estruturar os testes de rate limiting e testar o comportamento ao exceder o limite

Separo o rate limiting em quatro camadas, da mais barata para a mais cara:

| Camada | O que valida | Custo para a cota |
|---|---|---|
| 1. Contrato dos headers | `X-RateLimit-Limit`, `-Remaining`, `-Reset` (e `-Used`, `-Resource`) presentes, numéricos e coerentes: `used + remaining = limit`, `remaining < limit`, `reset` é epoch futuro dentro da janela de 1 h | 1 requisição |
| 2. Consumo | `remaining` cai exatamente 1 por requisição; endpoints que não deveriam consumir (`/rate_limit`) não consomem; token inválido gera 401 e não cai silenciosamente para o limite anônimo | 2 a 3 requisições |
| 3. Limite excedido | Status 403/429, `remaining = 0`, mensagem "rate limit exceeded", `documentation_url`; bloqueio ocorre **exatamente** na requisição seguinte à última permitida | Esgota uma cota |
| 4. Recuperação | Após o horário de `X-RateLimit-Reset` (ou `Retry-After`), a API volta a responder 200 | Espera a janela |

**Como exceder o limite sem quebrar a suíte.** A cota anônima do GitHub é por IP e dura 1 hora. Depois de esgotada, toda execução seguinte dentro dessa hora já encontra a API bloqueada. O desenho precisa funcionar nos dois estados:

- **CT-API-05** provoca o 403 real no endpoint pedido (`GET /users/github`), com requisições anônimas até o bloqueio. É **idempotente**: se a cota já estiver esgotada, a primeira resposta já é o 403 e o teste valida a mesma coisa.
- **CT-API-01** valida os headers também na resposta 403. Eles são obrigatórios no bloqueio, porque são eles que informam ao cliente quando pode voltar. Assim o teste não depende do estado da cota.
- Testes que **precisam** de cota disponível (decremento, recuperação após o reset) usam a **cota de busca** (`/search/*`, 10 req/min anônimo). Ela tem as mesmas regras e headers da `core`, mas é independente e reinicia em 1 minuto, o que torna viável esperar o reset dentro do teste (CT-API-06).
- O número de requisições vem do próprio header (`remaining + margem`), sem valor fixo no código. Assim o teste funciona com 60, 5000 ou qualquer outro limite e nunca entra em loop infinito.
- `GET /rate_limit` (que não consome cota) serve de pré-condição: se a cota de busca já tiver sido gasta por fatores externos, o teste de decremento **espera o reset** informado pela API (até 60 s) em vez de falhar ou ser pulado.
- O projeto de API roda em série (`fullyParallel: false`): a cota é um recurso compartilhado, e testes paralelos se interfeririam.
- **Separação no CI:** o teste que esgota a cota tem a tag `@esgota-cota`. No `npm test` local ele roda, porque o enunciado pede a detecção do 403 nesse endpoint. No CI de push/PR ele fica de fora (`npm run test:ci` = `--grep-invert @esgota-cota`), porque os runners compartilham IP e o bloqueio afetaria outros jobs por até 1 hora. Um job agendado (diário) e o disparo manual rodam a suíte completa.

**Em um sistema próprio** (não uma API pública), eu ainda acrescentaria:
- um ambiente/chave de teste com limite baixo (ex.: 5 req/min), configurável, para tornar o teste rápido e determinístico;
- testes do **cliente** contra um mock (WireMock) que devolve 429 + `Retry-After`, validando backoff, fila e ausência de rajadas, sem depender do servidor real;
- verificação de que o limite é aplicado por chave/usuário/IP conforme a regra, e de que um cliente não consome a cota do outro;
- teste de concorrência (N requisições simultâneas, para checar se o contador é atômico) em ferramenta de carga (k6), fora da suíte funcional.

## 1.1.b) Obter e reutilizar o token entre os testes

Uso duas peças, ambas no helper:

1. **`TokenManager`**: um cache com expiração. `getToken()` devolve o token em memória e só faz login quando não há token ou ele expirou. A função de login é injetada, então o mesmo mecanismo serve para ReqRes, DummyJSON ou qualquer outra API.
2. **Fixture de escopo `worker`** do Playwright (`sessao` em `api.spec.js`): o `TokenManager` é criado uma vez por worker e entregue a todos os testes daquele worker. Os testes CT-API-12 e CT-API-13 comprovam isso: os dois fazem chamadas autenticadas e `loginCount` continua 1.

```js
const test = base.extend({
  sessao: [async ({ playwright }, use) => {
    const request = await playwright.request.newContext();
    const tokenManager = new TokenManager({ login: () => loginDummyJson(request) });
    await use({ request, tokenManager });
    await request.dispose();
  }, { scope: 'worker' }],
});
```

Por que não um `globalSetup` que grava o token em arquivo? Funciona para sessões longas (é o padrão `storageState` do Playwright), mas um token de vida curta pode vencer no meio da suíte, e o arquivo vira um token morto. A obtenção preguiçosa com renovação automática resolve os dois casos. Cuidados adicionais:
- credenciais vêm de variáveis de ambiente/secret store e nunca são logadas (o token também não vai para o relatório);
- um token por worker evita disputa entre workers paralelos; se a API invalidar sessões anteriores a cada login, vale ter um usuário por worker (`testInfo.workerIndex`).

## 1.1.c) Detectar que o token expirou e tratar o cenário

Combino duas detecções:

- **Proativa (pelo relógio).** Se o token é um JWT, leio o `exp`; se a resposta de login traz `expires_in`, uso esse valor; se o token é opaco (ReqRes), uso um TTL configurado (`TOKEN_TTL_MS`, padrão 2 min). `isExpired()` compara com o relógio, com margem opcional para renovar pouco antes de vencer. `assertValid()` lança `TokenExpiredError`.
- **Reativa (pela resposta).** O relógio do cliente pode divergir do servidor, e o token pode ser revogado antes do prazo. `authorizedGet()` identifica 401 com mensagem de expirado/inválido (em APIs OAuth, o header `WWW-Authenticate: Bearer error="invalid_token"`), invalida o cache, faz login de novo e repete **uma única vez**, o que evita loop se o login também estiver quebrado.

O que os testes validam:
- **CT-API-10 (simulação, TTL fixo de 2 min):** o relógio é injetado no `TokenManager` (`now: () => agora`). O teste avança o tempo para 1 ms antes do TTL (token válido) e para o TTL exato (expirado, `TokenExpiredError`). Em seguida o próximo `getToken()` renova (`loginCount = 2`). Roda em menos de 1 s, sem `sleep` de 2 minutos.
- **CT-API-15 (expiração real no servidor):** login no DummyJSON com `expiresInMins: 1` e espera até o `exp`. O servidor responde 401 `Token Expired!`, diferente de token inválido (`Invalid/Expired Token!`) e de ausente (`Access Token is required`). Um cliente com relógio "atrasado" recebe o 401, renova e repete com sucesso. O cliente com relógio correto renova sozinho, sem nem tomar o 401.

Também diferencio os códigos: **401** é problema de autenticação (token ausente, inválido ou expirado: renovar faz sentido) e **403** é falta de permissão ou rate limit (renovar não resolve). Tratar 403 como expiração esconde bugs reais de autorização.

> **Por que DummyJSON além do ReqRes:** em 29/10/2026 o ReqRes faz login sem chave, mas passou a responder 401 `missing_api_key` a qualquer `GET /api/*` com `Authorization: Bearer`, e a chave pública `reqres-free-v1` foi revogada. Além disso, ele nunca validou o token que emite. O CT-API-11 executa o fluxo literal do enunciado e registra essa recusa como evidência. Por isso mantive o ReqRes para login e cache, e uso o DummyJSON para reuso e expiração validados pelo servidor. Detalhes no README.

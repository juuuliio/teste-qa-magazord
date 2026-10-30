# Teste QA Sênior - Julio Adão

Teste técnico para a vaga de **Coordenador de Qualidade - Magazord**, com automação em **Playwright**.

## Tecnologias Utilizadas

- Node.js v20.19+ (testado com v22 e v26). Node 18 não é suportado, ver [Limitações conhecidas](#limitações-conhecidas)
- Playwright 1.x (`@playwright/test` 1.64): testes de API (`APIRequestContext`) e E2E (Chromium)
- @faker-js/faker 10 (locale pt_BR): massa de dados dinâmica e reproduzível por semente
- dotenv: configuração opcional via `.env`
- GitHub Actions: pipeline em [`.github/workflows/testes.yml`](.github/workflows/testes.yml)

## Instalação

```bash
npm install
```

O `postinstall` baixa o Chromium do Playwright. Em Linux "limpo" (container/CI), instale também as dependências de sistema:

```bash
npx playwright install --with-deps chromium
```

Nenhuma variável de ambiente é obrigatória. As opcionais estão em [`.env.example`](.env.example) (copie para `.env`).

## Execução dos Testes

### Todos os testes
```bash
npm test
```

### Por parte
```bash
npm run test:parte1
npm run test:parte2
npm run test:parte3
# Partes 4 e 5 são teóricas, sem script de execução
```

### Outros comandos úteis
```bash
npm run test:ci                         # suíte sem o CT-API-05 (não esgota a cota do GitHub do IP)
npm run report                          # abre o relatório HTML da última execução
npm run test:headed                     # E2E com o navegador visível
npm run test:ui                         # modo UI do Playwright (debug interativo)
npx playwright test -g "CT-E2E-02"      # um caso específico pelo ID
FAKER_SEED=123456 npm run test:parte2   # reproduz a massa de uma execução (semente no relatório)
```

> No PowerShell, defina variáveis assim: `$env:FAKER_SEED=123456; npm run test:parte2`.

### Resultado esperado

```text
  41 passed
```

Nenhum teste é pulado, com uma exceção externa (a cota diária do ReqRes, logo abaixo):
- o CT-E2E-06 passa afirmando o comportamento atual de um **defeito do SauceDemo** (ver [Defeito encontrado](#defeito-encontrado));
- os testes do GitHub passam tanto na primeira execução quanto nas seguintes, mesmo com a cota anônima do IP já esgotada pelo CT-API-05;
- se a cota de busca do GitHub estiver baixa (ex.: duas execuções seguidas), o CT-API-02 **espera o reset** dela (até 60 s, anotado no relatório como `aguardou-reset`) em vez de ser pulado.

> **Cota do ReqRes:** o uso anônimo do ReqRes é limitado a **40 requisições por dia por IP** (reinicia à meia-noite UTC, 21h em Brasília), e a suíte usa cerca de 10 por execução. A partir da 4ª ou 5ª execução no mesmo dia, o ReqRes responde 429, e os testes dele (CT-API-07 a 11) são **pulados com o motivo e o horário de reset** no relatório, em vez de falharem. Para rodar mais vezes, crie uma conta gratuita em [app.reqres.in](https://app.reqres.in) e defina `REQRES_API_KEY` no `.env`.

> **Atenção:** o `npm test` inclui o **CT-API-05**, que esgota de propósito a cota anônima do GitHub (60 req/h) do seu IP, como pede o enunciado (detectar o 403 em `GET /users/github`). Depois dele, outras chamadas anônimas à API do GitHub a partir do mesmo IP ficam bloqueadas por até 1h. Para rodar sem esse efeito: `npm run test:ci`.

A suíte leva **pouco mais de 2 minutos**. Quase todo esse tempo vem de dois testes da Parte 1 que esperam o tempo real (reset da cota de busca do GitHub e expiração de um token de 1 minuto). As Partes 2 e 3 rodam em paralelo em cerca de 20 s.

## Estrutura do Projeto

```text
.
├── README.md
├── CASOS_DE_TESTE.txt              # Casos de teste das 3 partes práticas (IDs = títulos dos testes)
├── package.json
├── playwright.config.js            # Um "project" por parte (config e execução isoladas)
├── .env.example                    # Variáveis opcionais
├── .nvmrc / .npmrc                 # Node 22 no CI; engine-strict barra Node < 20.19 já no npm install
├── .gitattributes                  # Fixtures CSV sem conversão de fim de linha (comparadas por SHA-256)
├── .github/workflows/testes.yml    # CI: push/PR sem @esgota-cota; agendado/manual com a suíte completa
│
├── parte1-api/questao1.1/
│   ├── RESPOSTA_TEORICA.md
│   └── testes/
│       ├── api.spec.js             # GitHub (rate limit), ReqRes (login) e DummyJSON (token/expiração)
│       └── utils/api-helper.js     # Leitura de rate limit, TokenManager, renovação em 401
│
├── parte2-e2e/questao2.1/
│   ├── RESPOSTA_TEORICA.md
│   └── testes/
│       ├── checkout-flow.spec.js
│       ├── pages/                  # Page Objects: login, inventory, cart, checkout (3 etapas)
│       ├── fixtures/checkout-data.js  # Gerador de dados (Faker pt_BR + semente)
│       └── support/                # sessao.js (limpeza de cookies/storage) e precos.js (parse de valores)
│
├── parte3-arquivos/questao3.1/
│   ├── RESPOSTA_TEORICA.md
│   └── testes/
│       ├── csv-upload.spec.js
│       ├── pages/upload-page.js    # Page Object do upload + download do arquivo gravado
│       ├── utils/csv-generator.js  # Gerador de CSV (10/100/1000+ linhas, injeção de defeitos)
│       ├── utils/csv-validator.js  # Regras do "importador": formato, negócio, duplicata, relacionamento
│       └── fixtures/               # válido, vazio, só cabeçalho, formato incorreto, malformado, corrompido
│
├── parte4-mobile/questao4.1/RESPOSTA_TEORICA.md
└── parte5-mocks/questao5.1/RESPOSTA_TEORICA.md
```

**Padrões adotados:**
- **Page Objects injetados como fixtures** do Playwright (`test.extend`): o teste declara o que usa (`async ({ checkoutPage }) => ...`) e não instancia nada.
- **Seletores estáveis:** `data-test` do SauceDemo via `getByTestId` (configurado em `testIdAttribute`) e roles acessíveis. Nenhum XPath ou classe CSS de layout.
- **Helpers sem asserções** (`api-helper.js`, `csv-generator.js`): devolvem dados, e o teste decide o que afirmar. Isso mantém as falhas legíveis no próprio teste.
- **IDs de caso de teste nos títulos** (`CT-API-05`, `CT-E2E-02`, `CT-ARQ-06`) para rastrear do `CASOS_DE_TESTE.txt` até o código e o relatório.
- **Data-driven** para variações do mesmo comportamento (campos obrigatórios, logins inválidos, tamanhos de CSV, arquivos inválidos).
- **Evidências na falha:** trace, screenshot e vídeo (`retain-on-failure`); retry só no CI (`retries: 1`) para não esconder flakiness localmente.

## Observações

### Decisões técnicas

**Parte 1 - Rate limiting no endpoint pedido, sem quebrar execuções seguintes.**
- O **CT-API-05** provoca o 403 de verdade em `GET /users/github`: faz requisições anônimas até o bloqueio (no máximo `remaining + 5`, valor lido do próprio header).
  - **Efeito colateral:** a cota anônima `core` do IP (60/h) fica esgotada até o reset, em até 1 hora. Com `GITHUB_TOKEN`, os demais testes usam a cota do token e não são afetados.
  - **No CI:** o teste tem a tag `@esgota-cota`. Push e PR rodam `npm run test:ci` (sem ele), porque os runners compartilham IP. O job agendado (diário) e o disparo manual rodam a suíte completa.
- A suíte foi desenhada para **continuar verde** nas execuções seguintes dentro da mesma hora:
  - o CT-API-05 é idempotente: com a cota já esgotada, a 1ª resposta já é o 403;
  - o CT-API-01 valida os headers também na resposta 403. Eles são obrigatórios no bloqueio, porque são eles que dizem quando a API volta;
  - o CT-API-02 (decremento) usa a cota de busca, independente da `core`.
- O **CT-API-06** comprova a **recuperação após o reset** usando a cota de busca (`/search`, 10/min). Ela tem as mesmas regras e headers da `core`, mas reinicia em 1 minuto, o que torna viável esperar o reset dentro do teste.

**Parte 1 - ReqRes + DummyJSON.** Em 29/10/2026 verifiquei que o fluxo do enunciado não é mais possível no ReqRes:
- o login funciona sem chave e devolve o token do enunciado;
- `GET /api/users/2` com `Authorization: Bearer <token>` retorna **401 `missing_api_key`**. Os endpoints `/api/*` exigem `x-api-key`, e a chave pública `reqres-free-v1` foi revogada. Uma chave pessoal não pode ir para o repositório (o checklist proíbe credenciais no código);
- o `Bearer` só é aceito em `/app/*`, com sessão criada por *magic link* enviado por e-mail, o que não é automatizável;
- sem token, o mesmo `GET /api/users/2` responde 200: o token do login não autentica nada no ReqRes.

Como ficou a cobertura:
- **ReqRes:** login válido (CT-API-07), erros de login (CT-API-08), cache do token (CT-API-09) e expiração simulada de 2 min com relógio injetado (CT-API-10);
- **fluxo literal do enunciado** (CT-API-11): roda sempre e registra a recusa atual como evidência da mudança de contrato;
- **DummyJSON** (troca de API permitida pelo enunciado): login, **reuso do token em requisição autenticada** (CT-API-12 e 13) e **expiração real** (CT-API-15). O `/auth/login` aceita `expiresInMins`, emite JWT de verdade e responde `401 Token Expired!` quando ele vence. O `TokenManager` é o mesmo para as duas APIs (a função de login é injetada).

**Parte 2 - Cupom e e-mail.** O SauceDemo não tem cupom nem envia e-mail; a estratégia para os dois está em [`RESPOSTA_TEORICA.md`](parte2-e2e/questao2.1/RESPOSTA_TEORICA.md). A massa (nome, sobrenome, CEP e produtos) é gerada a cada execução, e a **semente** fica anotada no relatório (`faker-seed`) para reproduzir uma falha.

**Parte 2 - Limpeza.** O Playwright já isola cada teste num contexto novo. Ainda assim, o `afterEach` limpa cookies, `localStorage` e `sessionStorage` explicitamente, e o CT-E2E-08 testa a própria limpeza (estado presente antes, ausente depois, área logada volta a exigir login).

**Parte 3 - O the-internet não valida conteúdo.** O site aceita qualquer arquivo, inclusive vazio ou binário (só o envio sem arquivo gera erro: HTTP 500). Para não fingir uma validação que o site não faz:
- as regras de importação (formato, negócio, duplicata, relacionamento) estão em `csv-validator.js`, que faz o papel do importador, e os testes comparam **erro e linha exatos**;
- todo upload é verificado **de ponta a ponta**: o arquivo é baixado de `/download/<nome>` e comparado por SHA-256 com o enviado, e o conteúdo baixado é revalidado (as 1000 linhas chegaram e continuam válidas);
- os nomes de arquivo são únicos por execução, porque o servidor é público e compartilhado.

### Defeito encontrado

**CT-E2E-06:** o SauceDemo permite seguir para o resumo (0 itens, Total $0.00) e **finalizar um pedido com o carrinho vazio**. O esperado seria bloquear o checkout.

O teste é de **caracterização**: afirma exatamente o comportamento atual e leva a anotação `defeito` no relatório. Quando o defeito for corrigido, ele falha e deve ser invertido para a regra esperada.

Preferi isso a `test.fail()`, porque o `test.fail()` aceita *qualquer* falha como esperada, inclusive um seletor quebrado, e poderia mascarar uma regressão da própria automação.

### Dificuldades encontradas

- **Mudança de contrato do ReqRes** (descrita acima): o fluxo do enunciado, `Bearer` em `/api/users/2`, hoje retorna 401. Foi identificada antes da implementação, sondando a API.
- **Dependência de serviços públicos:** GitHub, ReqRes, DummyJSON, SauceDemo e the-internet podem ficar instáveis ou aplicar limites (a cota anônima do ReqRes é de 40 requisições por dia por IP). No CI uso `retries: 1` e publico trace e relatório para diagnóstico. Numa suíte de produto, esses serviços seriam substituídos por mocks na maior parte dos testes (ver Parte 5).
- **Vulnerabilidade no Faker 9** (GHSA-qxc2-j82w-r537, em `helpers.fake`): mesmo sem usar essa função, atualizei para o Faker 10.6 para o `npm install` sair limpo (`found 0 vulnerabilities`). O Faker 10 é distribuído só como ESM, então o Node mínimo é 20.19. O `.npmrc` (`engine-strict=true`) faz o `npm install` falhar com mensagem clara em versões anteriores. Validado no Node 22 (versão do CI) e no 26.

### Limitações conhecidas

Resumo do que **não** é validado exatamente como o enunciado descreve, e por quê:

| Ponto | O que acontece | Como foi tratado |
|---|---|---|
| Token do ReqRes em requisição autenticada | O ReqRes recusa `Bearer` em `/api/*` (401 `missing_api_key`) e não usa o token do login para autenticar nada | CT-API-11 executa o fluxo literal e registra a recusa; o reuso e a expiração real do token são provados no **DummyJSON** (CT-API-12 a 15) |
| Rejeição de CSV inválido | O the-internet **aceita qualquer arquivo**; não existe importador no servidor | A rejeição é feita por um **componente local** (`csv-validator.js`), no papel do importador. O site só comprova que o arquivo chega íntegro (SHA-256). Os títulos dos testes CT-ARQ-03 a 07 deixam isso explícito |
| Cupom de uso único e e-mail de confirmação | O SauceDemo não tem nenhum dos dois | Estratégia descrita em [2.1.a e 2.1.b](parte2-e2e/questao2.1/RESPOSTA_TEORICA.md) |
| Cota anônima do ReqRes (40 req/dia por IP) | Depois de ~4 execuções no mesmo dia, o ReqRes responde 429 | CT-API-07 a 11 são pulados com motivo e horário de reset (não falham); `REQRES_API_KEY` de conta gratuita aumenta a cota |
| CT-API-05 esgota a cota real do GitHub | A cota anônima do IP fica bloqueada por até 1h | Roda no `npm test` (requisito do enunciado); no CI de push/PR fica de fora (`npm run test:ci`) e roda no job agendado/manual |
| Node 18 | O modelo de README do enunciado cita "Node.js v18+", mas o Node 18 está fora de suporte desde abril/2025 e o Playwright atual (1.64) exige Node 20 | `engines` exige 20.19+ (por causa do Faker 10, que é só ESM); o `.npmrc` faz o `npm install` falhar com mensagem clara em versões anteriores |

### Variáveis opcionais

| Variável | Efeito |
|---|---|
| `GITHUB_TOKEN` | Limite do GitHub sobe de 60 para 5000 req/h (1000 no Actions) |
| `REQRES_API_KEY` | Chave pessoal do ReqRes (`x-api-key`), em vez da cota demo compartilhada |
| `TOKEN_TTL_MS` | TTL simulado do token do ReqRes (padrão 120000 = 2 min) |
| `FAKER_SEED` | Reproduz a massa de dados da Parte 2 |

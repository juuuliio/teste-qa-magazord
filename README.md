# Teste QA Sênior - Julio Adão

Teste técnico para a vaga de **Coordenador de Qualidade - Magazord**, com automação em **Playwright**.

## Tecnologias Utilizadas

- Node.js v20.19+ (testado com v22 e v26), ver [Pré-requisitos e efeitos da execução](#pré-requisitos-e-efeitos-da-execução)
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
  50 passed        (npm run test:ci: 49, sem o CT-API-05)
```

Nenhum teste é pulado, com uma exceção externa (a cota diária do ReqRes, logo abaixo):
- o CT-E2E-06 passa afirmando o comportamento atual de um **defeito do SauceDemo** (ver [Defeito encontrado](#defeito-encontrado));
- os testes do GitHub passam tanto na primeira execução quanto nas seguintes, mesmo com a cota anônima do IP já esgotada pelo CT-API-05;
- se a cota de busca do GitHub estiver baixa (ex.: duas execuções seguidas), o CT-API-02 **espera o reset** dela (até 60 s, anotado no relatório como `aguardou-reset`) em vez de ser pulado.

> **Cota do ReqRes:** o uso anônimo do ReqRes é limitado a **40 requisições por dia por IP** (reinicia à meia-noite UTC, 21h em Brasília), e a suíte usa cerca de 10 por execução. A partir da 4ª ou 5ª execução no mesmo dia, o ReqRes responde 429, e os testes dele (CT-API-07 a 11) são **pulados com o motivo e o horário de reset** no relatório, em vez de falharem. Para rodar mais vezes, crie uma conta gratuita em [app.reqres.in](https://app.reqres.in) e defina `REQRES_API_KEY` no `.env`.

> **Atenção:** o `npm test` inclui o **CT-API-05**, que esgota de propósito a cota anônima do GitHub (60 req/h) do seu IP, como pede o enunciado (detectar o 403 em `GET /users/github`). Depois dele, outras chamadas anônimas à API do GitHub a partir do mesmo IP ficam bloqueadas por até 1h. Para rodar sem esse efeito: `npm run test:ci`.

A suíte leva **pouco mais de 2 minutos**. Quase todo esse tempo vem de dois testes da Parte 1 que esperam o tempo real (reset da cota de busca do GitHub e expiração de um token de 1 minuto). As Partes 2 e 3 rodam em paralelo em cerca de 30 s.

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
│   ├── importador/                 # Sistema testado: importador de clientes (Node puro, sobe sozinho)
│   │   ├── server.js               # API de importação (201/422/413), base por loja, tudo ou nada
│   │   ├── index.html              # Tela de importação
│   │   └── csv-validator.js        # Regras: formato, negócio, duplicata, relacionamento
│   └── testes/
│       ├── csv-upload.spec.js      # Upload no the-internet: válidos, inválidos, integridade (SHA-256)
│       ├── csv-importacao.spec.js  # Importação no importador: rejeição pelo servidor e reconciliação
│       ├── pages/                  # upload-page.js (the-internet) e importador-page.js
│       ├── utils/csv-generator.js  # Gerador de CSV (10/100/1000+ linhas, injeção de defeitos)
│       └── fixtures/               # CSVs válido/vazio/só cabeçalho/formato incorreto/malformado/corrompido
│                                   # + casos-invalidos.js (erros esperados de cada um)
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

**Parte 2 - Cupom e e-mail.** Os itens "Implemente" da Parte 2 são login, produtos, checkout, dados dinâmicos, confirmação e limpeza, e todos estão automatizados. Cupom e e-mail aparecem só no contexto e nas perguntas teóricas (o SauceDemo não tem nenhum dos dois); a estratégia para ambos está em [`RESPOSTA_TEORICA.md`](parte2-e2e/questao2.1/RESPOSTA_TEORICA.md). A massa (nome, sobrenome, CEP e produtos) é gerada a cada execução, e a **semente** fica anotada no relatório (`faker-seed`) para reproduzir uma falha.

**Parte 2 - Limpeza.** O Playwright já isola cada teste num contexto novo. Ainda assim, o `afterEach` limpa cookies, `localStorage` e `sessionStorage` explicitamente, e o CT-E2E-08 testa a própria limpeza (estado presente antes, ausente depois, área logada volta a exigir login).

**Parte 3 - Upload no the-internet + importador de referência.** O the-internet (site pedido) aceita qualquer arquivo, inclusive vazio ou binário, e não importa nada: só o envio sem arquivo gera erro (HTTP 500). O contexto da questão, porém, é um **sistema que importa** CSV e valida formato, regras, duplicatas e relacionamentos. Por isso a Parte 3 tem duas frentes:
- **the-internet** (`csv-upload.spec.js`): upload de arquivos válidos e inválidos, como o enunciado pede. Todo upload é verificado de ponta a ponta: o arquivo é baixado de `/download/<nome>` e comparado por SHA-256 com o enviado. Os nomes são únicos por execução, porque o servidor é público e compartilhado.
- **importador de referência** (`importador/`, testado em `csv-importacao.spec.js`): um servidor Node sem dependências, que o Playwright sobe sozinho (`webServer`), com tela de importação, API e base de dados por loja. Aqui a **rejeição é feita pelo servidor**: HTTP 422 com erro e linha, tabela de erros na tela e base conferida pela API, que deve continuar vazia (política tudo ou nada). Também cobre o que o the-internet não permite: reconciliação das 1000 linhas gravadas campo a campo, duplicata contra registros já importados e limite de tamanho (HTTP 413).

### Defeito encontrado

**CT-E2E-06:** o SauceDemo permite seguir para o resumo (0 itens, Total $0.00) e **finalizar um pedido com o carrinho vazio**. O esperado seria bloquear o checkout.

O teste é de **caracterização**: afirma exatamente o comportamento atual e leva a anotação `defeito` no relatório. Quando o defeito for corrigido, ele falha e deve ser invertido para a regra esperada.

Preferi isso a `test.fail()`, porque o `test.fail()` aceita *qualquer* falha como esperada, inclusive um seletor quebrado, e poderia mascarar uma regressão da própria automação.

### Dificuldades encontradas

- **Limite de 260 caracteres de caminho no Windows:** no teste de "máquina limpa" (clone numa pasta funda), o arquivo CSV gerado em `test-results/...` ficou com mais de 260 caracteres. O Chromium não consegue ler esse arquivo, e o upload travava até o timeout. O arquivo de upload passou a ser gerado num diretório temporário curto (com cópia anexada ao relatório), e o Page Object falha cedo com a causa real se o caminho passar do limite.
- **Mudança de contrato do ReqRes** (descrita acima): o fluxo do enunciado, `Bearer` em `/api/users/2`, hoje retorna 401. Foi identificada antes da implementação, sondando a API.
- **Dependência de serviços públicos:** GitHub, ReqRes, DummyJSON, SauceDemo e the-internet podem ficar instáveis ou aplicar limites (a cota anônima do ReqRes é de 40 requisições por dia por IP). No CI uso `retries: 1` e publico trace e relatório para diagnóstico. Numa suíte de produto, esses serviços seriam substituídos por mocks na maior parte dos testes (ver Parte 5).
- **Vulnerabilidade no Faker 9** (GHSA-qxc2-j82w-r537, em `helpers.fake`): mesmo sem usar essa função, atualizei para o Faker 10.6 para o `npm install` sair limpo (`found 0 vulnerabilities`). O Faker 10 é distribuído só como ESM, então o Node mínimo é 20.19. O `.npmrc` (`engine-strict=true`) faz o `npm install` falhar com mensagem clara em versões anteriores. Validado no Node 22 (versão do CI) e no 26.

### Adaptação ao enunciado

Todos os itens "Implemente" das partes 1, 2 e 3 estão automatizados. Só um deles precisou de API alternativa, por mudança no serviço sugerido:

| Item | O que mudou no serviço | Como foi coberto |
|---|---|---|
| Login no ReqRes e reuso do token em requisição autenticada | O ReqRes passou a recusar `Bearer` em `/api/*` (401 `missing_api_key`), e o token do login não autentica nada (a mesma chamada sem token responde 200) | CT-API-11 executa o fluxo literal no ReqRes e registra a recusa; login, reuso do token e expiração real são provados no **DummyJSON** (CT-API-12 a 15), troca permitida pelo enunciado ("fique à vontade para utilizar outro") |

### Pré-requisitos e efeitos da execução

| Ponto | Detalhe |
|---|---|
| Node.js 20.19+ | O modelo de README do enunciado cita "v18+"; o Node 22 atende. O Node 18 está fora de suporte desde abril/2025 e o Playwright atual (1.64) exige Node 20. O `.npmrc` faz o `npm install` falhar com mensagem clara em versões anteriores |
| Cota anônima do ReqRes (40 req/dia por IP) | A suíte usa cerca de 10 por execução. Esgotada, o ReqRes responde 429 e os CT-API-07 a 11 são pulados com motivo e horário de reset (não falham). `REQRES_API_KEY` de conta gratuita aumenta a cota |
| CT-API-05 esgota a cota real do GitHub | É o que o enunciado pede (detectar o 403). A cota anônima do IP fica bloqueada por até 1h. No CI de push/PR fica de fora (`npm run test:ci`) e roda no job agendado/manual |
| Porta 3333 livre | Usada pelo importador da Parte 3, que o Playwright sobe sozinho. Para trocar: `IMPORTADOR_PORT` |

### Variáveis opcionais

| Variável | Efeito |
|---|---|
| `GITHUB_TOKEN` | Limite do GitHub sobe de 60 para 5000 req/h (1000 no Actions) |
| `REQRES_API_KEY` | Chave pessoal do ReqRes (`x-api-key`), em vez da cota demo compartilhada |
| `TOKEN_TTL_MS` | TTL simulado do token do ReqRes (padrão 120000 = 2 min) |
| `FAKER_SEED` | Reproduz a massa de dados da Parte 2 |
| `IMPORTADOR_PORT` | Porta do importador da Parte 3 (padrão 3333) |

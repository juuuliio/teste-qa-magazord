# Questão 5.1 - Mocks de APIs Externas

**Contexto:** integração com marketplaces (Mercado Livre, Amazon) para publicar produtos, atualizar preços, processar pedidos e atualizar estoque.

---

## 5.1.a) Testar as integrações sem afetar os ambientes reais

A regra é que **nenhum teste automatizado fala com produção de marketplace**. Um erro de teste ali publica produto com preço errado para clientes reais, zera estoque ou aceita pedido. Organizo em camadas, cada uma com sua dependência:

| Camada | Depende de | Para quê | Quando roda |
|---|---|---|---|
| Unitário | Fake do *adapter* (interface `MarketplaceClient`) | Regras de negócio: cálculo de preço, mapeamento de categoria, decisão de reprocessar | Cada commit |
| Integração do adapter | **Mock server HTTP** (WireMock) | Montagem de requisição, autenticação/refresh de token, parsing de resposta, erros 4xx/5xx, timeout, 429 | Cada PR |
| Contrato | Schemas/OpenAPI dos marketplaces + contratos internos | Payload no formato que o provedor espera; mocks fiéis à API real | Cada PR + verificação agendada |
| Sandbox do marketplace | Mercado Livre: **usuários de teste** (`POST /users/test_user`); Amazon SP-API: **sandbox estático e dinâmico** | Prova de que autenticação e fluxo principal funcionam contra a API verdadeira | Nightly / pré-release, poucos testes |
| Produção | Nada: só **monitoração** (sintético read-only, alertas de erro e latência) | Detectar mudança do provedor | Contínuo |

Práticas de suporte:
- **Base URL e credenciais por ambiente**, injetadas por configuração. O código não sabe se está falando com mock, sandbox ou produção, e credenciais de produção não existem no ambiente de teste (falha "segura").
- **Adapter/porta isolando o marketplace** (arquitetura hexagonal): o domínio fala com `MarketplaceClient`, e cada marketplace tem seu adapter. É o que torna o mock trivial e o teste unitário possível.
- **Idempotência** nas operações de escrita (chave por operação). O teste valida que um retry não publica duas vezes.
- **Guarda adicional:** contas e sellers de teste explicitamente marcados, e um *allowlist* de hosts no ambiente de teste.

## 5.1.b) Estratégia de mock e ferramentas

| | **WireMock** | **MSW** | **JSON Server** |
|---|---|---|---|
| Onde roda | Processo/contêiner separado (Docker), acessado via HTTP | Dentro do processo JS (browser via Service Worker; Node via interceptação) | Processo Node, CRUD REST sobre um `db.json` |
| Linguagem do sistema testado | **Qualquer** (fala HTTP) | Só JS/TS | Qualquer |
| Injeção de falhas (500, delay, reset de conexão) | **Nativa** (`fixedDelayMilliseconds`, `fault: CONNECTION_RESET_BY_PEER`) | Possível via código | Não tem |
| Cenários com estado | **Sim** (*scenarios*: 1ª chamada 429, 2ª 200) | Via código | CRUD simples |
| Verificação de requisições recebidas | **Sim** (request journal, `verify(count, ...)`) | Via código | Não |
| Record & playback do sandbox | **Sim** | Não | Não |
| Melhor uso | Integração back-end ↔ API externa | Front-end e testes unitários/integração de código JS | Protótipo de front-end, demo |

**Minha escolha: WireMock** (contêiner nos testes de integração e no ambiente de QA) para as integrações com marketplace, porque:
- a integração acontece no **back-end**, possivelmente em outra linguagem: o mock precisa ser externo ao processo e independente de linguagem;
- os cenários exigidos (500, timeout, 429 com `Retry-After`, sequência falha-depois-sucesso) são nativos;
- dá para **afirmar o que o sistema enviou** (quantas vezes, com que payload), não só o que ele recebeu: essencial para provar que não houve publicação duplicada;
- o *record & playback* contra o sandbox gera stubs com respostas reais, reduzindo o risco de inventar formatos.

**MSW** eu usaria no **front-end** (painel do lojista: telas de status da integração, mensagens de erro), e **JSON Server** não usaria aqui: ele simula CRUD, não o comportamento (erros, limites, autenticação) que é o que importa nessa integração.

**Organização dos stubs:**
```text
mocks/
├── mercadolivre/
│   ├── mappings/   # items-post-201.json, items-post-500.json, orders-get-429.json ...
│   └── __files/    # corpos de resposta, gravados do sandbox ou gerados do schema
└── amazon-sp-api/
```
- Stubs **versionados** junto do código e revisados em PR.
- Respostas **gravadas do sandbox** ou **geradas do schema** (OpenAPI), nunca escritas à mão sem referência.
- Para cenários pontuais, o teste registra o stub via API admin do WireMock no próprio setup e limpa no teardown (`/__admin/reset`), o que mantém os testes isolados.

## 5.1.c) Simulação de erro 500, timeout e rate limit (429)

### Erro 500

```json
{ "request":  { "method": "POST", "urlPath": "/items" },
  "response": { "status": 500, "jsonBody": { "message": "internal_error" } } }
```
Variação com estado: *scenario* em que o 1º POST retorna 500 e o 2º retorna 201.

**O que validar no sistema:**
- retry com backoff exponencial e **limite de tentativas** (verifico no WireMock: exatamente N chamadas);
- **sem duplicidade:** com idempotency key, ou consultando antes de recriar, o produto é publicado uma vez só, mesmo com retries;
- estado interno coerente: o produto fica "pendente/erro na publicação", nunca "publicado";
- após esgotar as tentativas, o item vai para fila de reprocessamento (DLQ) com motivo, e há log e alerta;
- o lojista vê o erro com mensagem compreensível e opção de reenviar.

### Timeout

```json
{ "request":  { "method": "PUT", "urlPathPattern": "/items/.*/price" },
  "response": { "status": 200, "fixedDelayMilliseconds": 35000 } }
```
Também simulo `"fault": "CONNECTION_RESET_BY_PEER"` e `"EMPTY_RESPONSE"`.

**O que validar:**
- o cliente tem **timeout configurado** (connect e read) e não fica pendurado. O teste mede que a falha ocorre no tempo esperado, não depois de 35 s;
- **resultado incerto:** no timeout, a operação **pode** ter sido aplicada no marketplace. O sistema precisa reconciliar (consultar o estado) ou reenviar de forma idempotente antes de assumir falha. Esse é o cenário que mais gera bug em produção (preço aplicado duas vezes, pedido aceito sem registro);
- a fila de outros sellers/produtos não trava por causa de uma chamada lenta (isolamento e *bulkhead*);
- circuit breaker abre após falhas consecutivas e fecha quando o mock volta ao normal.

### Rate limiting (429)

```json
{ "scenarioName": "throttle", "requiredScenarioState": "Started", "newScenarioState": "liberado",
  "request":  { "method": "PUT", "urlPath": "/items/MLB123/stock" },
  "response": { "status": 429, "headers": { "Retry-After": "2" } } }
```
Mais um stub no estado `liberado` retornando 200.

**O que validar:**
- o sistema **respeita `Retry-After`**: medindo o intervalo entre as chamadas no request journal, a próxima vem só depois de 2 s;
- 429 **não** conta como erro de negócio nem dispara alerta crítico; é tratado como *throttling*;
- **controle de vazão proativo:** atualizações em massa (ex.: preço de 10 mil SKUs) passam por fila com limite por seller/app e não disparam rajadas;
- **coalescência:** se o preço do mesmo SKU mudou 3 vezes durante o throttling, só o último valor precisa ser enviado;
- nenhuma atualização é perdida: ao final, todas as mudanças estão no request journal.

## 5.1.d) Validação de payload (schema validation) e onde ela entra no pipeline

**Fonte dos schemas:**
- **Amazon SP-API:** modelos OpenAPI publicados oficialmente (repositório `selling-partner-api-models`);
- **Mercado Livre:** documentação da API e respostas do sandbox, a partir das quais mantenho JSON Schemas próprios, versionados no repositório;
- **APIs internas:** o OpenAPI do próprio serviço é a fonte da verdade.

**Validação nos dois sentidos:**
1. **Saída (o que enviamos):** o *builder* de payload é validado com **Ajv** contra o JSON Schema em teste unitário, para cada tipo de produto (simples, com variações, kit), incluindo campos obrigatórios por categoria, tipos, enums, limites (título com até N caracteres) e formatos (preço com 2 casas, moeda). No teste de integração, o stub do WireMock usa *matchers* de JSON (`matchesJsonSchema` / `equalToJson` com placeholders): payload fora do formato não casa com o stub e o teste falha.
2. **Entrada (o que recebemos):** os **mocks também são validados contra o schema**. Se um stub não respeita o schema do provedor, o teste do mock falha, e isso impede que a suíte passe contra respostas que o marketplace nunca devolveria (mock drift).
3. **Em runtime (produção):** validação leve das respostas no adapter, com log e métrica de "campo inesperado/ausente", para detectar mudança do provedor antes que vire incidente.

**No pipeline:**
```text
commit/PR:   lint → unit (Ajv nos builders) → contrato (Pact/OpenAPI) → integração com WireMock (matchers de schema)
agendado:    verificação contra sandbox + diff do OpenAPI publicado pelo provedor → abre alerta se mudou
produção:    validação/observabilidade de schema no adapter
```
Validar schema **cedo** (unitário e contrato) é barato e dá feedback em segundos; os testes contra sandbox ficam para o que só o provedor real pode confirmar.

## 5.1.e) Testes com mock vs testes de contrato

Os dois respondem perguntas diferentes:

- **Teste com mock** pergunta: *"dado que o marketplace responde X, meu sistema se comporta corretamente?"* Valida **o nosso comportamento**: retries, idempotência, estados, mensagens. É rápido, determinístico e o único jeito prático de simular 500, timeout e 429 sob demanda. A fraqueza: o mock é uma **suposição**. Se o Mercado Livre mudar um campo, os testes com mock continuam verdes e a produção quebra.
- **Teste de contrato** pergunta: *"as suposições que o consumidor faz sobre o provedor continuam verdadeiras?"* Ele mantém o mock honesto. No modelo **consumer-driven** (Pact), o consumidor publica o contrato e o **provedor** roda a verificação no pipeline dele.

**A nuance do cenário de marketplace:** Mercado Livre e Amazon **não vão rodar nossos contratos Pact** no pipeline deles. Por isso, para APIs de terceiros:
1. uso **contrato orientado pelo provedor**: o OpenAPI/schema publicado pelo marketplace é o contrato. Com **bi-directional contract testing** (PactFlow), comparo automaticamente as interações que o consumidor espera (geradas dos nossos testes com mock) com o OpenAPI do provedor; se o nosso mock pede algo que o provedor não oferece, o pipeline falha;
2. complemento com **testes agendados contra o sandbox** que validam o formato das respostas reais e re-gravam stubs, mantendo os mocks sincronizados com a realidade;
3. monitoro o **changelog/versão** das APIs dos marketplaces e trato depreciações como itens de backlog com prazo.

Já entre **serviços internos da plataforma** (ex.: hub de integração ↔ catálogo ↔ pedidos), o **Pact consumer-driven** é a escolha ideal: os dois lados estão sob nosso controle, e o contrato impede que uma mudança no catálogo quebre o hub sem ninguém perceber até o deploy.

**Resumo de quando usar cada um:**

| Pergunta | Ferramenta |
|---|---|
| Meu sistema trata 500, timeout e 429 corretamente? Não duplica publicação? | Teste com **mock** (WireMock) |
| O payload que eu envio está no formato que o marketplace aceita? | **Schema validation** + contrato contra OpenAPI do provedor |
| Meus mocks ainda representam a API real? | **Contrato bi-direcional** + verificação agendada no **sandbox** |
| A mudança no serviço interno X quebra o consumidor Y? | **Pact consumer-driven** |
| Está funcionando em produção agora? | **Monitoração** e testes sintéticos read-only |

Mocks dão **velocidade e controle**; contratos dão **confiança de que o que foi mockado é real**. Uma estratégia só com mocks dá falsa segurança, e uma só com sandbox fica lenta e frágil demais para rodar a cada PR.

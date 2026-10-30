# Questão 2.1 - Fluxo de Checkout

Implementação: [`testes/checkout-flow.spec.js`](testes/checkout-flow.spec.js), Page Objects em [`testes/pages/`](testes/pages/) e gerador de dados em [`testes/fixtures/checkout-data.js`](testes/fixtures/checkout-data.js).

---

## 2.1.a) Garantir que cada execução use um cupom válido diferente

O problema central é que o cupom é **estado compartilhado e consumível**: um código fixo no teste funciona uma vez e quebra todas as execuções seguintes (e quebra testes paralelos já na primeira). A regra é que **cada teste cria o próprio cupom**, em vez de procurar um que "ainda funcione".

**Abordagem principal: criar o cupom via API/back-office no `beforeEach` (test data factory).**

```js
// fixture: cada teste recebe um cupom novo, de uso único, criado pela API administrativa
cupom: async ({ adminApi }, use, testInfo) => {
  const codigo = `QA-${process.env.CI_RUN_ID ?? 'local'}-${testInfo.workerIndex}-${randomUUID().slice(0, 8)}`.toUpperCase();
  const cupom = await adminApi.criarCupom({ codigo, desconto: 10, tipo: 'PERCENTUAL', usoMaximo: 1, validade: amanha() });
  await use(cupom);
  await adminApi.desativarCupom(cupom.id); // limpeza, mesmo que o teste falhe
},
```

- **Unicidade:** prefixo `QA-` (fácil de identificar e limpar), id da execução do CI, `workerIndex` (paralelismo) e um sufixo aleatório. Dois testes nunca colidem, nem em execuções simultâneas de pipelines diferentes.
- **Determinismo:** o teste controla regras e valor do cupom, então sabe exatamente qual desconto esperar no total, sem depender de cupom cadastrado manualmente.
- **Limpeza:** desativo o cupom no teardown e mantenho um job que expira cupons `QA-*` antigos (rede de proteção quando o teardown não roda).

**Alternativas, por ordem de preferência:**
1. **Seed direto no banco** (ambiente de teste): mais rápido, porém acopla o teste ao schema. Só uso se não houver API.
2. **Pool pré-provisionado com reserva atômica** (ex.: `UPDATE ... SET reservado_por = :run WHERE reservado_por IS NULL LIMIT 1 RETURNING codigo`): útil quando cupons vêm de sistema externo que não permite criação sob demanda. Exige reposição e monitoramento do pool.
3. **Mock da validação de cupom** (`page.route` sobre o endpoint de cupom): bom para testar a UI isoladamente, mas não serve para o E2E, porque deixa de validar a regra real de uso único.

**Cobertura da própria regra de uso único**, que é o risco de negócio (desconto aplicado duas vezes = prejuízo):
- cupom aplicado e pedido finalizado: desconto correto no total;
- segunda tentativa com o mesmo cupom (mesmo ou outro cliente): rejeitada com mensagem clara;
- concorrência: dois checkouts simultâneos com o mesmo cupom, só um pode concluir (teste de API com requisições paralelas);
- cupom aplicado mas pedido abandonado: o cupom **não** pode ser consumido;
- expirado, inexistente, valor mínimo não atingido, combinação com outras promoções.

> O SauceDemo não tem funcionalidade de cupom, por isso o teste prático cobre login, carrinho, checkout e confirmação. A geração dinâmica de dados por execução (nome, sobrenome, CEP com Faker) segue o mesmo princípio: cada execução usa massa nova, e a **semente** fica anotada no relatório para reproduzir uma falha com `FAKER_SEED=<semente>`.

## 2.1.b) Validar a confirmação do pedido sem depender de e-mail real

Separo **o pedido foi confirmado** de **o cliente foi notificado**, e valido cada um no ponto mais confiável:

1. **Confirmação na interface:** página de sucesso, número do pedido exibido e carrinho vazio. É o que o teste prático valida (`complete-header`, `complete-text`, badge do carrinho e carrinho vazio depois de voltar para a vitrine).
2. **Estado no back-end:** com o número do pedido capturado na UI, consulto `GET /pedidos/{id}` (ou o banco, em ambiente de teste) e valido status, itens, valores, desconto do cupom e dados do cliente. A UI pode mostrar "sucesso" mesmo sem o pedido persistido corretamente; essa é a validação que pega isso.
3. **Notificação, sem caixa de e-mail real:**
   - **SMTP de teste** no ambiente de QA (Mailpit, MailHog, smtp4dev): a aplicação envia normalmente, o servidor captura e expõe uma API (`GET /api/v1/search?query=to:cliente+run123@...`). O teste busca a mensagem pelo destinatário único e valida assunto, número do pedido, itens, total e links;
   - **serviços de inbox programática** (Mailosaur, MailSlurp) quando o ambiente precisa enviar e-mail de verdade (ex.: staging com provedor real);
   - **validação no evento:** se o e-mail é disparado por fila/evento (`PedidoConfirmado`), valido que o evento foi publicado com o payload correto (contrato) e testo o template de e-mail isoladamente. Assim o E2E não depende do provedor.
4. **Correlação:** cada teste usa um e-mail único (`qa+<runId>-<worker>@dominio-de-teste`), o que permite buscar exatamente a mensagem daquele teste mesmo em execução paralela. Para a espera assíncrona uso polling com timeout (`expect.poll`), nunca `sleep` fixo.

Nunca uso caixas de e-mail reais (Gmail via IMAP, por exemplo): são lentas, instáveis, sujeitas a filtro de spam e exigem credenciais pessoais no pipeline.

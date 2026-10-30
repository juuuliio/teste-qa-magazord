const { test: base, expect } = require('@playwright/test');
const { LoginPage } = require('./pages/login-page');
const { InventoryPage } = require('./pages/inventory-page');
const { CartPage } = require('./pages/cart-page');
const { CheckoutPage, TAXA } = require('./pages/checkout-page');
const { USUARIO_PADRAO, definirSemente, gerarComprador, sortearProdutos } = require('./fixtures/checkout-data');
const { limparSessao, lerEstadoSessao } = require('./support/sessao');
const { arredondar } = require('./support/precos');

/** Page Objects injetados como fixtures: os testes recebem só o que usam. */
const test = base.extend({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  inventoryPage: async ({ page }, use) => use(new InventoryPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),
});

test.beforeEach(async ({}, testInfo) => {
  // A semente vai para o relatório: FAKER_SEED=<valor> reproduz a mesma massa.
  const seed = definirSemente();
  testInfo.annotations.push({ type: 'faker-seed', description: String(seed) });
});

/** Limpeza após cada teste de navegador: cookies, localStorage e sessionStorage. */
const limparAposCadaTeste = async ({ page }) => limparSessao(page);

test.describe('Checkout - usuário autenticado', () => {
  test.afterEach(limparAposCadaTeste);

  test.beforeEach(async ({ loginPage, inventoryPage }) => {
    await loginPage.goto();
    await loginPage.login(USUARIO_PADRAO);
    await expect(inventoryPage.titulo).toHaveText('Products');
  });

  test('CT-E2E-01 - fluxo completo com 1 produto até a confirmação do pedido', async ({
    page,
    inventoryPage,
    cartPage,
    checkoutPage,
  }) => {
    const [produto] = sortearProdutos(await inventoryPage.listarProdutos(), 1);
    const comprador = gerarComprador();

    await inventoryPage.adicionarAoCarrinho([produto]);
    await expect(inventoryPage.badgeCarrinho).toHaveText('1');

    await inventoryPage.abrirCarrinho();
    await expect(cartPage.nomesItens).toHaveText([produto]);
    await cartPage.iniciarCheckout();

    await expect(checkoutPage.titulo).toHaveText('Checkout: Your Information');
    await checkoutPage.preencherDados(comprador);
    await checkoutPage.continuar();

    await expect(checkoutPage.titulo).toHaveText('Checkout: Overview');
    await expect(checkoutPage.itensResumo).toHaveCount(1);
    await checkoutPage.finalizar();

    // Confirmação do pedido
    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.titulo).toHaveText('Checkout: Complete!');
    await expect(checkoutPage.confirmacaoTitulo).toHaveText('Thank you for your order!');
    await expect(checkoutPage.confirmacaoTexto).toContainText('Your order has been dispatched');
    await expect(inventoryPage.badgeCarrinho).toBeHidden();

    // Pedido concluído não pode deixar itens no carrinho
    await checkoutPage.botaoVoltarProdutos.click();
    await expect(inventoryPage.titulo).toHaveText('Products');
    await inventoryPage.abrirCarrinho();
    await expect(cartPage.itens).toHaveCount(0);
  });

  test('CT-E2E-02 - múltiplos produtos: resumo confere itens, preços, taxa e total', async ({
    inventoryPage,
    cartPage,
    checkoutPage,
  }) => {
    const produtos = sortearProdutos(await inventoryPage.listarProdutos(), 3);
    const adicionados = await inventoryPage.adicionarAoCarrinho(produtos);
    await expect(inventoryPage.badgeCarrinho).toHaveText('3');

    await inventoryPage.abrirCarrinho();
    await cartPage.iniciarCheckout();
    await checkoutPage.preencherDados(gerarComprador());
    await checkoutPage.continuar();

    const resumo = await checkoutPage.lerResumo();
    const porNome = (a, b) => a.nome.localeCompare(b.nome);

    // Itens e preços do resumo = itens e preços vistos na vitrine
    expect(resumo.itens.map(({ nome, preco }) => ({ nome, preco })).sort(porNome)).toEqual(adicionados.sort(porNome));
    expect(resumo.itens.every((item) => item.quantidade === 1)).toBe(true);

    // Totais: subtotal = soma; taxa = 8% (arredondada em centavos); total = subtotal + taxa
    const subtotalEsperado = arredondar(adicionados.reduce((soma, item) => soma + item.preco, 0));
    expect(resumo.subtotal).toBe(subtotalEsperado);
    expect(Math.abs(resumo.taxa - resumo.subtotal * TAXA)).toBeLessThanOrEqual(0.005 + Number.EPSILON);
    expect(resumo.total).toBe(arredondar(resumo.subtotal + resumo.taxa));

    // Pagamento e entrega exibidos antes de finalizar
    await expect(checkoutPage.pagamento).toHaveText(/^SauceCard #\d+$/);
    await expect(checkoutPage.entrega).toHaveText('Free Pony Express Delivery!');

    await checkoutPage.finalizar();
    await expect(checkoutPage.confirmacaoTitulo).toHaveText('Thank you for your order!');
  });

  const camposObrigatorios = [
    { campo: 'firstName', rotulo: 'nome', mensagem: 'Error: First Name is required' },
    { campo: 'lastName', rotulo: 'sobrenome', mensagem: 'Error: Last Name is required' },
    { campo: 'postalCode', rotulo: 'CEP', mensagem: 'Error: Postal Code is required' },
  ];
  for (const { campo, rotulo, mensagem } of camposObrigatorios) {
    test(`CT-E2E-03 - checkout sem ${rotulo} é bloqueado e recupera após correção`, async ({
      page,
      inventoryPage,
      cartPage,
      checkoutPage,
    }) => {
      await inventoryPage.adicionarAoCarrinho(sortearProdutos(await inventoryPage.listarProdutos(), 1));
      await cartPage.goto();
      await cartPage.iniciarCheckout();

      const comprador = gerarComprador();
      await checkoutPage.preencherDados({ ...comprador, [campo]: undefined });
      await checkoutPage.continuar();

      await expect(checkoutPage.erro).toHaveText(mensagem);
      await expect(page).toHaveURL(/\/checkout-step-one\.html$/);

      // Corrigindo o campo, o fluxo segue normalmente
      await checkoutPage.preencherDados({ [campo]: comprador[campo] });
      await checkoutPage.continuar();
      await expect(checkoutPage.titulo).toHaveText('Checkout: Overview');
    });
  }

  test('CT-E2E-04 - item removido do carrinho não aparece no resumo nem no total', async ({
    inventoryPage,
    cartPage,
    checkoutPage,
  }) => {
    const [mantido, removido] = sortearProdutos(await inventoryPage.listarProdutos(), 2);
    const adicionados = await inventoryPage.adicionarAoCarrinho([mantido, removido]);

    await inventoryPage.abrirCarrinho();
    await cartPage.remover(removido);
    await expect(cartPage.nomesItens).toHaveText([mantido]);
    await expect(inventoryPage.badgeCarrinho).toHaveText('1');

    await cartPage.iniciarCheckout();
    await checkoutPage.preencherDados(gerarComprador());
    await checkoutPage.continuar();

    const resumo = await checkoutPage.lerResumo();
    expect(resumo.itens.map((item) => item.nome)).toEqual([mantido]);
    expect(resumo.subtotal).toBe(adicionados[0].preco);
  });

  test('CT-E2E-05 - cancelar no resumo volta para a vitrine sem perder o carrinho', async ({
    page,
    inventoryPage,
    cartPage,
    checkoutPage,
  }) => {
    await inventoryPage.adicionarAoCarrinho(sortearProdutos(await inventoryPage.listarProdutos(), 2));
    await inventoryPage.abrirCarrinho();
    await cartPage.iniciarCheckout();
    await checkoutPage.preencherDados(gerarComprador());
    await checkoutPage.continuar();

    await checkoutPage.cancelar();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(inventoryPage.badgeCarrinho).toHaveText('2');
  });

  test('CT-E2E-06 - [DEFEITO] carrinho vazio não bloqueia o checkout e o pedido sem itens é finalizado', async ({
    page,
    cartPage,
    checkoutPage,
  }) => {
    // Regra esperada: sem itens não há checkout. O teste fixa o comportamento
    // atual com asserções precisas (teste de caracterização), em vez de
    // test.fail(), que aceitaria qualquer falha, até um seletor quebrado.
    // Quando o defeito for corrigido, este teste falha e deve ser invertido.
    test.info().annotations.push({
      type: 'defeito',
      description: 'Checkout permitido com carrinho vazio; esperado: bloquear antes do resumo',
    });

    await cartPage.goto();
    await expect(cartPage.itens).toHaveCount(0);
    await cartPage.iniciarCheckout();
    await checkoutPage.preencherDados(gerarComprador());
    await checkoutPage.continuar();

    await expect(page).toHaveURL(/\/checkout-step-two\.html$/);
    const resumo = await checkoutPage.lerResumo();
    expect(resumo.itens).toEqual([]);
    expect(resumo.total).toBe(0);

    await checkoutPage.finalizar();
    await expect(checkoutPage.confirmacaoTitulo).toHaveText('Thank you for your order!');
  });
});

test.describe('Checkout - controle de acesso e limpeza de estado', () => {
  test.afterEach(limparAposCadaTeste);

  test('CT-E2E-07 - acesso direto ao checkout sem login redireciona para o login', async ({
    loginPage,
    checkoutPage,
  }) => {
    await checkoutPage.gotoEtapaDados();

    await expect(loginPage.botaoLogin).toBeVisible();
    await expect(loginPage.erro).toHaveText(
      "Epic sadface: You can only access '/checkout-step-one.html' when you are logged in.",
    );
  });

  test('CT-E2E-08 - limpeza remove cookies e storage e encerra a sessão', async ({
    page,
    loginPage,
    inventoryPage,
  }) => {
    await loginPage.goto();
    await loginPage.login(USUARIO_PADRAO);
    await inventoryPage.adicionarAoCarrinho(sortearProdutos(await inventoryPage.listarProdutos(), 1));

    const antes = await lerEstadoSessao(page);
    expect(antes.cookies.map((c) => c.name)).toContain('session-username');
    expect(antes.localStorage).toHaveProperty('cart-contents');

    await limparSessao(page);

    const depois = await lerEstadoSessao(page);
    expect(depois.cookies).toEqual([]);
    expect(depois.localStorage).toEqual({});
    expect(depois.sessionStorage).toEqual({});

    // Sem cookie de sessão, área logada volta a exigir login
    await inventoryPage.goto();
    await expect(loginPage.botaoLogin).toBeVisible();
  });
});

test.describe('Massa de dados', () => {
  test('CT-E2E-09 - dados do comprador são dinâmicos e reproduzíveis pela semente', () => {
    definirSemente(2026);
    const primeiro = gerarComprador();
    definirSemente(2026);
    const repetido = gerarComprador();
    definirSemente(31337);
    const outro = gerarComprador();

    expect(repetido).toEqual(primeiro);
    expect(outro).not.toEqual(primeiro);
    for (const comprador of [primeiro, outro]) {
      expect(comprador.firstName.trim()).not.toBe('');
      expect(comprador.lastName.trim()).not.toBe('');
      expect(comprador.postalCode).toMatch(/^\d{5}-\d{3}$/);
    }
  });
});

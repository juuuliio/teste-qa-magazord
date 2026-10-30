const { parsePreco } = require('../support/precos');

/** Alíquota que o SauceDemo aplica sobre o subtotal. */
const TAXA = 0.08;

/**
 * Checkout completo do SauceDemo, nas três etapas:
 *  1. /checkout-step-one.html  - dados do comprador
 *  2. /checkout-step-two.html  - resumo (itens, pagamento, frete, totais)
 *  3. /checkout-complete.html  - confirmação do pedido
 */
class CheckoutPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.titulo = page.getByTestId('title');

    // Etapa 1
    this.firstName = page.getByTestId('firstName');
    this.lastName = page.getByTestId('lastName');
    this.postalCode = page.getByTestId('postalCode');
    this.botaoContinuar = page.getByTestId('continue');
    this.botaoCancelar = page.getByTestId('cancel');
    this.erro = page.getByTestId('error');

    // Etapa 2
    this.itensResumo = page.getByTestId('inventory-item');
    this.pagamento = page.getByTestId('payment-info-value');
    this.entrega = page.getByTestId('shipping-info-value');
    this.subtotal = page.getByTestId('subtotal-label');
    this.taxa = page.getByTestId('tax-label');
    this.total = page.getByTestId('total-label');
    this.botaoFinalizar = page.getByTestId('finish');

    // Etapa 3
    this.confirmacaoTitulo = page.getByTestId('complete-header');
    this.confirmacaoTexto = page.getByTestId('complete-text');
    this.botaoVoltarProdutos = page.getByTestId('back-to-products');
  }

  async gotoEtapaDados() {
    await this.page.goto('/checkout-step-one.html');
  }

  /**
   * Preenche só os campos informados (permite testar campos obrigatórios).
   * @param {{ firstName?: string, lastName?: string, postalCode?: string }} dados
   */
  async preencherDados({ firstName, lastName, postalCode }) {
    if (firstName !== undefined) await this.firstName.fill(firstName);
    if (lastName !== undefined) await this.lastName.fill(lastName);
    if (postalCode !== undefined) await this.postalCode.fill(postalCode);
  }

  async continuar() {
    await this.botaoContinuar.click();
  }

  async cancelar() {
    await this.botaoCancelar.click();
  }

  async finalizar() {
    await this.botaoFinalizar.click();
  }

  /** Lê itens e valores do resumo (etapa 2) já convertidos para número. */
  async lerResumo() {
    // locator.all() não espera: sem isso, em máquina rápida (CI) a leitura
    // acontece ainda na etapa 1 e devolve lista vazia. Espera a etapa 2
    // renderizada (o rodapé de totais existe mesmo com carrinho vazio).
    await this.page.waitForURL('**/checkout-step-two.html');
    await this.total.waitFor();

    const itens = [];
    for (const item of await this.itensResumo.all()) {
      itens.push({
        nome: await item.getByTestId('inventory-item-name').innerText(),
        preco: parsePreco(await item.getByTestId('inventory-item-price').innerText()),
        quantidade: Number(await item.getByTestId('item-quantity').innerText()),
      });
    }
    return {
      itens,
      subtotal: parsePreco(await this.subtotal.innerText()),
      taxa: parsePreco(await this.taxa.innerText()),
      total: parsePreco(await this.total.innerText()),
    };
  }

  /**
   * Fluxo feliz das etapas 1 e 2 até a confirmação.
   * @param {{ firstName: string, lastName: string, postalCode: string }} dados
   */
  async concluirCompra(dados) {
    await this.preencherDados(dados);
    await this.continuar();
    await this.finalizar();
  }
}

module.exports = { CheckoutPage, TAXA };

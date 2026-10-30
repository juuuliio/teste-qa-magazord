/** Carrinho (/cart.html). */
class CartPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.itens = page.getByTestId('inventory-item');
    this.nomesItens = page.getByTestId('inventory-item-name');
    this.botaoCheckout = page.getByTestId('checkout');
  }

  async goto() {
    await this.page.goto('/cart.html');
  }

  /** @param {string} nome */
  async remover(nome) {
    await this.itens
      .filter({ has: this.page.getByText(nome, { exact: true }) })
      .getByRole('button', { name: 'Remove' })
      .click();
  }

  async iniciarCheckout() {
    await this.botaoCheckout.click();
  }
}

module.exports = { CartPage };

const { parsePreco } = require('../support/precos');

/** Vitrine de produtos (/inventory.html) e header com o carrinho. */
class InventoryPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.titulo = page.getByTestId('title');
    this.itens = page.getByTestId('inventory-item');
    this.nomesProdutos = page.getByTestId('inventory-item-name');
    this.badgeCarrinho = page.getByTestId('shopping-cart-badge');
    this.linkCarrinho = page.getByTestId('shopping-cart-link');
  }

  async goto() {
    await this.page.goto('/inventory.html');
  }

  /** @param {string} nome */
  item(nome) {
    return this.itens.filter({ has: this.page.getByText(nome, { exact: true }) });
  }

  /** Nomes de todos os produtos exibidos na vitrine. */
  async listarProdutos() {
    // allTextContents() não espera: garante a vitrine renderizada antes de ler.
    await this.nomesProdutos.first().waitFor();
    return this.nomesProdutos.allTextContents();
  }

  /**
   * Adiciona os produtos ao carrinho e devolve nome + preço exibidos na
   * vitrine, que servem de referência para validar o resumo do pedido.
   *
   * @param {string[]} nomes
   */
  async adicionarAoCarrinho(nomes) {
    const adicionados = [];
    for (const nome of nomes) {
      const item = this.item(nome);
      const preco = parsePreco(await item.getByTestId('inventory-item-price').innerText());
      await item.getByRole('button', { name: 'Add to cart' }).click();
      adicionados.push({ nome, preco });
    }
    return adicionados;
  }

  async abrirCarrinho() {
    await this.linkCarrinho.click();
  }
}

module.exports = { InventoryPage };

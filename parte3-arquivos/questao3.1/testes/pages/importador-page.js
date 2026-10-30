const IMPORTADOR_URL = process.env.IMPORTADOR_URL || 'http://127.0.0.1:3333';

/** Tela de importação de clientes do importador (importador/index.html) e sua API. */
class ImportadorPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.inputArquivo = page.getByLabel('Arquivo CSV');
    this.botaoImportar = page.getByRole('button', { name: 'Importar' });
    this.resultado = page.getByRole('status');
    this.tabelaErros = page.getByRole('table', { name: 'Erros da importação' });
    this.linhasErro = this.tabelaErros.locator('tbody tr');
  }

  /** @param {string} loja  cada teste usa a sua loja: a base é separada por loja */
  async goto(loja) {
    this.loja = loja;
    await this.page.goto(`${IMPORTADOR_URL}/?loja=${encodeURIComponent(loja)}`);
  }

  /**
   * Seleciona o arquivo, clica em Importar e devolve a resposta HTTP do servidor.
   * Use só o status: o corpo de um fetch feito pela página nem sempre fica
   * disponível no Chromium ("evicted from inspector cache"). O conteúdo da
   * resposta é verificado pela tela ou por importarViaApi().
   * @param {string} caminho
   */
  async importar(caminho) {
    await this.inputArquivo.setInputFiles(caminho);
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/importacoes')),
      this.botaoImportar.click(),
    ]);
    return response;
  }

  /** Erros exibidos na tabela da tela, como { linha, codigo }. */
  async lerErrosDaTela() {
    await this.tabelaErros.waitFor();
    return this.linhasErro.evaluateAll((linhas) =>
      linhas.map((tr) => ({ linha: Number(tr.cells[0].textContent), codigo: tr.cells[1].textContent })),
    );
  }

  /**
   * Mesma importação direto na API (sem tela), para validar o contrato JSON.
   * @param {Buffer | string} conteudo
   */
  async importarViaApi(conteudo) {
    const response = await this.page.request.post(
      `${IMPORTADOR_URL}/api/lojas/${encodeURIComponent(this.loja)}/importacoes`,
      { data: Buffer.from(conteudo), headers: { 'Content-Type': 'text/csv' } },
    );
    return { status: response.status(), corpo: await response.json() };
  }

  /** Registros gravados na base da loja (consulta direta à API, sem passar pela tela). */
  async lerBase() {
    const response = await this.page.request.get(`${IMPORTADOR_URL}/api/lojas/${encodeURIComponent(this.loja)}/clientes`);
    if (!response.ok()) throw new Error(`Consulta da base falhou: ${response.status()}`);
    return response.json();
  }
}

module.exports = { ImportadorPage };

/** File Uploader do the-internet (/upload) e o download do arquivo gravado. */
class UploadPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.inputArquivo = page.locator('#file-upload');
    this.botaoEnviar = page.locator('#file-submit');
    this.titulo = page.getByRole('heading', { level: 3 });
    this.arquivosEnviados = page.locator('#uploaded-files');
  }

  async goto() {
    await this.page.goto('/upload');
  }

  /**
   * Envia o arquivo e devolve a resposta HTTP do POST, para os testes
   * validarem status além do que aparece na tela.
   *
   * @param {string | undefined} caminho  undefined = envia o formulário sem arquivo
   */
  async enviar(caminho) {
    if (caminho !== undefined) await this.inputArquivo.setInputFiles(caminho);
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/upload'),
      this.botaoEnviar.click(),
    ]);
    return response;
  }

  /**
   * Baixa o arquivo que o servidor gravou. Permite comparar byte a byte o que
   * foi enviado com o que foi armazenado (prova de que nenhuma linha se perdeu).
   *
   * @param {string} nome
   */
  async baixarArquivoEnviado(nome) {
    const response = await this.page.request.get(`/download/${encodeURIComponent(nome)}`);
    if (!response.ok()) throw new Error(`Download de ${nome} falhou: ${response.status()}`);
    return response.body();
  }
}

module.exports = { UploadPage };

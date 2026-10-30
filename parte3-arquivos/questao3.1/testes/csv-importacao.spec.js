const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test: base, expect } = require('@playwright/test');
const { ImportadorPage } = require('./pages/importador-page');
const { gerarCsv, gerarRegistros, paraCsv, arquivoTemporario } = require('./utils/csv-generator');
const { CODIGOS } = require('../importador/csv-validator');
const { CASOS_INVALIDOS } = require('./fixtures/casos-invalidos');

/*
 * Importação de CSV de ponta a ponta no importador de referência
 * (importador/server.js, iniciado pelo Playwright): o arquivo é enviado pela
 * tela, o SERVIDOR aplica as regras e responde, e a base é conferida pela API.
 * Cada teste usa uma loja própria, então a base começa vazia e os testes rodam
 * em paralelo sem interferir uns nos outros.
 */

const FIXTURES = path.join(__dirname, 'fixtures');
const LIMITE_BYTES = 2 * 1024 * 1024;

const test = base.extend({
  importadorPage: async ({ page }, use) => {
    const importadorPage = new ImportadorPage(page);
    await importadorPage.goto(`loja-${crypto.randomUUID().slice(0, 8)}`);
    await use(importadorPage);
  },
});

/** Envia o conteúdo pela tela e devolve a resposta do servidor. */
async function importar(importadorPage, conteudo, nome = 'clientes.csv') {
  const { caminho, remover } = arquivoTemporario(conteudo, nome);
  try {
    return await importadorPage.importar(caminho);
  } finally {
    remover();
  }
}

const porEmail = (a, b) => a.email.localeCompare(b.email);

test.describe('Importador de clientes - importação válida', () => {
  test('CT-ARQ-12 - 1000 linhas importadas: tela confirma e a base tem exatamente os registros do arquivo', async ({
    importadorPage,
  }) => {
    const registros = gerarRegistros(1000);

    const response = await importar(importadorPage, paraCsv(registros));

    expect(response.status()).toBe(201);
    await expect(importadorPage.resultado).toHaveText('1000 registros importados');

    // Reconciliação pela chave e campo a campo: nada perdido, duplicado ou alterado
    const gravados = await importadorPage.lerBase();
    expect(gravados).toHaveLength(1000);
    expect(gravados.sort(porEmail)).toEqual([...registros].sort(porEmail));
  });
});

test.describe('Importador de clientes - rejeição pelo servidor', () => {
  const ids = ['CT-ARQ-13a', 'CT-ARQ-13b', 'CT-ARQ-13c', 'CT-ARQ-13d', 'CT-ARQ-13e'];

  for (const [i, { descricao, arquivo, erros }] of CASOS_INVALIDOS.entries()) {
    test(`${ids[i]} - ${descricao}: servidor rejeita (422), tela lista erro e linha, base não muda`, async ({
      importadorPage,
    }) => {
      const conteudo = fs.readFileSync(path.join(FIXTURES, arquivo));

      // Pela tela: status HTTP, mensagem e tabela de erros
      const response = await importar(importadorPage, conteudo, arquivo);
      expect(response.status()).toBe(422);
      await expect(importadorPage.resultado).toHaveText(`Arquivo rejeitado: ${erros.length} erro(s)`);
      expect(await importadorPage.lerErrosDaTela()).toEqual(erros);

      // Pela API: contrato da resposta, com mensagem legível para cada erro
      const { status, corpo } = await importadorPage.importarViaApi(conteudo);
      expect(status).toBe(422);
      expect(corpo.status).toBe('rejeitado');
      expect(corpo.erros.map(({ linha, codigo }) => ({ linha, codigo }))).toEqual(erros);
      for (const { mensagem } of corpo.erros) expect(mensagem.length).toBeGreaterThan(0);

      // Tudo ou nada: nenhum registro, nem as linhas válidas do arquivo, foi gravado
      expect(await importadorPage.lerBase()).toEqual([]);
    });
  }

  test('CT-ARQ-14 - um único erro na linha 735 de 1000 rejeita o arquivo inteiro (tudo ou nada)', async ({
    importadorPage,
  }) => {
    const response = await importar(importadorPage, gerarCsv(1000, { defeitos: [{ registro: 734, tipo: 'cidade' }] }));

    expect(response.status()).toBe(422);
    expect(await importadorPage.lerErrosDaTela()).toEqual([{ linha: 735, codigo: CODIGOS.CIDADE_INEXISTENTE }]);
    expect(await importadorPage.lerBase()).toEqual([]);
  });

  test('CT-ARQ-15 - reimportar o mesmo arquivo é rejeitado por duplicata com a base e não duplica registros', async ({
    importadorPage,
  }) => {
    const conteudo = gerarCsv(10);
    expect((await importar(importadorPage, conteudo)).status()).toBe(201);

    const segunda = await importar(importadorPage, conteudo);

    expect(segunda.status()).toBe(422);
    const esperado = Array.from({ length: 10 }, (_, i) => ({ linha: i + 2, codigo: CODIGOS.EMAIL_JA_CADASTRADO }));
    expect(await importadorPage.lerErrosDaTela()).toEqual(esperado);
    expect(await importadorPage.lerBase()).toHaveLength(10);
  });

  test('CT-ARQ-16 - arquivo acima de 2 MB é recusado (413) sem gravar nada', async ({ importadorPage }) => {
    const conteudo = gerarCsv(60_000);
    expect(Buffer.byteLength(conteudo)).toBeGreaterThan(LIMITE_BYTES);

    const response = await importar(importadorPage, conteudo);

    expect(response.status()).toBe(413);
    expect(await importadorPage.lerErrosDaTela()).toEqual([{ linha: 0, codigo: CODIGOS.ARQUIVO_GRANDE }]);
    expect(await importadorPage.lerBase()).toEqual([]);
  });
});

const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const { UploadPage } = require('./pages/upload-page');
const { gerarCsv, gerarRegistros, paraCsv, salvarCsv, nomeUnico, sha256 } = require('./utils/csv-generator');
const { validarCsv, parseCsv, CODIGOS } = require('./utils/csv-validator');

const FIXTURES = path.join(__dirname, 'fixtures');

const test = base.extend({
  uploadPage: async ({ page }, use) => use(new UploadPage(page)),
});

/**
 * Envia o arquivo pela UI e confirma, pelo download, que o servidor gravou
 * exatamente os mesmos bytes (nenhuma linha perdida, truncada ou convertida).
 *
 * @param {UploadPage} uploadPage
 * @param {Buffer | string} conteudo
 * @param {string} nome
 * @param {import('@playwright/test').TestInfo} testInfo
 */
async function enviarEConferirIntegridade(uploadPage, conteudo, nome, testInfo) {
  const caminho = salvarCsv(conteudo, testInfo.outputPath(nome));

  await uploadPage.goto();
  const response = await uploadPage.enviar(caminho);

  expect(response.status()).toBe(200);
  await expect(uploadPage.titulo).toHaveText('File Uploaded!');
  await expect(uploadPage.arquivosEnviados).toHaveText(nome);

  const armazenado = await uploadPage.baixarArquivoEnviado(nome);
  expect(armazenado.length).toBe(Buffer.byteLength(conteudo));
  expect(sha256(armazenado)).toBe(sha256(conteudo));
  return armazenado;
}

test.describe('Upload de CSV válido', () => {
  const tamanhos = [
    { linhas: 10, porte: 'pequeno' },
    { linhas: 100, porte: 'médio' },
    { linhas: 1000, porte: 'grande' },
  ];

  for (const { linhas, porte } of tamanhos) {
    test(`CT-ARQ-01 - CSV ${porte} gerado (${linhas} linhas) é enviado e armazenado íntegro`, async ({
      uploadPage,
    }, testInfo) => {
      const conteudo = gerarCsv(linhas);

      // Antes do envio: o arquivo gerado respeita layout e regras de negócio
      const preValidacao = validarCsv(conteudo);
      expect(preValidacao.erros).toEqual([]);
      expect(preValidacao.totalRegistros).toBe(linhas);

      const armazenado = await enviarEConferirIntegridade(uploadPage, conteudo, nomeUnico(`clientes-${linhas}`), testInfo);

      // Depois do envio: todas as linhas continuam presentes e válidas
      const posValidacao = validarCsv(armazenado);
      expect(posValidacao.totalRegistros).toBe(linhas);
      expect(posValidacao.registrosValidos).toBe(linhas);
    });
  }

  test('CT-ARQ-02 - CSV de exemplo com aspas, vírgula no nome e idades-limite é aceito', async ({
    uploadPage,
  }, testInfo) => {
    const conteudo = fs.readFileSync(path.join(FIXTURES, 'valido.csv'));

    const validacao = validarCsv(conteudo);
    expect(validacao.erros).toEqual([]);
    expect(validacao.totalRegistros).toBe(10);

    await enviarEConferirIntegridade(uploadPage, conteudo, nomeUnico('valido'), testInfo);
  });
});

/*
 * O the-internet não interpreta o conteúdo: aceita qualquer arquivo. Cada teste
 * tem duas etapas: (1) o upload, que comprova que o arquivo chega ao servidor
 * sem alteração; (2) a importação, em que o validador (utils/csv-validator.js),
 * no papel do importador, rejeita o arquivo apontando erro e linha.
 */
test.describe('Upload de CSV inválido', () => {
  const invalidos = [
    {
      id: 'CT-ARQ-03',
      descricao: 'CSV vazio (0 bytes)',
      arquivo: 'vazio.csv',
      erros: [{ linha: 0, codigo: CODIGOS.ARQUIVO_VAZIO }],
    },
    {
      id: 'CT-ARQ-04',
      descricao: 'CSV só com cabeçalho',
      arquivo: 'somente-cabecalho.csv',
      erros: [{ linha: 1, codigo: CODIGOS.SEM_REGISTROS }],
    },
    {
      id: 'CT-ARQ-05',
      descricao: 'CSV com formato incorreto (separador ";" e cabeçalho diferente)',
      arquivo: 'formato-incorreto.csv',
      erros: [{ linha: 1, codigo: CODIGOS.CABECALHO_INVALIDO }],
    },
    {
      id: 'CT-ARQ-06',
      descricao: 'CSV com dados malformados',
      arquivo: 'dados-malformados.csv',
      erros: [
        { linha: 3, codigo: CODIGOS.COLUNAS },
        { linha: 4, codigo: CODIGOS.EMAIL_INVALIDO },
        { linha: 5, codigo: CODIGOS.IDADE_INVALIDA },
        { linha: 6, codigo: CODIGOS.IDADE_INVALIDA },
        { linha: 7, codigo: CODIGOS.NOME_OBRIGATORIO },
        { linha: 8, codigo: CODIGOS.EMAIL_DUPLICADO },
        { linha: 9, codigo: CODIGOS.CIDADE_INEXISTENTE },
        { linha: 10, codigo: CODIGOS.ASPAS_NAO_FECHADAS },
      ],
    },
    {
      id: 'CT-ARQ-07',
      descricao: 'CSV corrompido (conteúdo binário)',
      arquivo: 'corrompido.csv',
      erros: [{ linha: 0, codigo: CODIGOS.ENCODING_INVALIDO }],
    },
  ];

  for (const { id, descricao, arquivo, erros } of invalidos) {
    test(`${id} - ${descricao}: site aceita o upload; validador local (importador) rejeita com erro e linha`, async ({
      uploadPage,
    }, testInfo) => {
      const conteudo = fs.readFileSync(path.join(FIXTURES, arquivo));

      await test.step('Upload: o the-internet recebe o arquivo íntegro (o site não valida conteúdo)', async () => {
        await enviarEConferirIntegridade(uploadPage, conteudo, nomeUnico(path.parse(arquivo).name), testInfo);
      });

      await test.step(`Validador local (csv-validator.js) rejeita: ${erros.map((e) => e.codigo).join(', ')}`, async () => {
        const validacao = validarCsv(conteudo);
        expect(validacao.valido).toBe(false);
        expect(validacao.erros.map(({ linha, codigo }) => ({ linha, codigo }))).toEqual(erros);
        // Toda rejeição precisa de mensagem legível para o usuário final
        for (const { mensagem } of validacao.erros) expect(mensagem.length).toBeGreaterThan(0);
      });
    });
  }

  test('CT-ARQ-08 - enviar o formulário sem arquivo retorna erro 500', async ({ page, uploadPage }) => {
    await uploadPage.goto();

    const response = await uploadPage.enviar(undefined);

    expect(response.status()).toBe(500);
    await expect(uploadPage.titulo).toHaveText('Internal Server Error');
    await expect(page.getByText('No file was chosen')).toBeVisible();
  });
});

test.describe('Gerador e validador de CSV', () => {
  test('CT-ARQ-09 - em 1000 linhas, defeitos injetados são encontrados exatamente nas linhas certas', () => {
    const conteudo = gerarCsv(1000, {
      defeitos: [
        { registro: 1, tipo: 'nome' },
        { registro: 250, tipo: 'email' },
        { registro: 500, tipo: 'idade' },
        { registro: 734, tipo: 'cidade' },
        { registro: 1000, tipo: 'duplicado' },
      ],
    });

    const validacao = validarCsv(conteudo);

    // Linha física = registro + 1 (cabeçalho é a linha 1)
    expect(validacao.erros.map(({ linha, codigo }) => ({ linha, codigo }))).toEqual([
      { linha: 2, codigo: CODIGOS.NOME_OBRIGATORIO },
      { linha: 251, codigo: CODIGOS.EMAIL_INVALIDO },
      { linha: 501, codigo: CODIGOS.IDADE_INVALIDA },
      { linha: 735, codigo: CODIGOS.CIDADE_INEXISTENTE },
      { linha: 1001, codigo: CODIGOS.EMAIL_DUPLICADO },
    ]);
    expect(validacao.totalRegistros).toBe(1000);
    expect(validacao.registrosValidos).toBe(995);
  });

  test('CT-ARQ-10 - gerador produz a quantidade pedida, e-mails únicos e é reproduzível pela semente', () => {
    const registros = gerarRegistros(1000, { seed: 42 });

    expect(registros).toHaveLength(1000);
    expect(new Set(registros.map((r) => r.email)).size).toBe(1000);
    expect(gerarRegistros(1000, { seed: 42 })).toEqual(registros);
    expect(gerarRegistros(1000, { seed: 43 })).not.toEqual(registros);
  });

  test('CT-ARQ-11 - campos com vírgula, aspas e quebra de linha sobrevivem ao round-trip', () => {
    const registro = { nome: 'Souza, "Ana"\nPaula', email: 'ana@exemplo.com.br', idade: 30, cidade: 'Joinville' };

    const { registros } = parseCsv(paraCsv([registro]));

    expect(registros[1].campos).toEqual([registro.nome, registro.email, '30', registro.cidade]);
    expect(validarCsv(paraCsv([registro])).erros).toEqual([]);
  });
});

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fakerPT_BR: faker } = require('@faker-js/faker');
const { CABECALHO, CIDADES_CADASTRADAS } = require('./csv-validator');

/** Escapa um campo conforme RFC 4180: aspas quando houver vírgula, aspas ou quebra de linha. */
function escaparCampo(valor) {
  const texto = String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * @param {Array<Record<string, unknown>>} registros
 * @param {{ cabecalho?: string[], quebra?: string }} [options]
 */
function paraCsv(registros, { cabecalho = CABECALHO, quebra = '\n' } = {}) {
  const linhas = registros.map((registro) => cabecalho.map((coluna) => escaparCampo(registro[coluna] ?? '')).join(','));
  return [cabecalho.join(','), ...linhas].join(quebra) + quebra;
}

/** "João da Silva" -> "joao.da.silva" (parte local de e-mail só com ASCII). */
function slug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

/**
 * Defeitos que podem ser injetados em posições conhecidas de um arquivo
 * válido, para testar se a validação encontra o erro na linha certa mesmo em
 * arquivos grandes.
 */
const DEFEITOS = {
  email: (registro) => ({ ...registro, email: 'email-sem-arroba' }),
  idade: (registro) => ({ ...registro, idade: 'abc' }),
  cidade: (registro) => ({ ...registro, cidade: 'Cidade Inexistente' }),
  nome: (registro) => ({ ...registro, nome: '' }),
  /** Repete o e-mail do 1º registro. */
  duplicado: (registro, primeiro) => ({ ...registro, email: primeiro.email }),
};

/**
 * Gera registros de clientes válidos: e-mails únicos (sufixo sequencial),
 * idade de 18 a 90 e cidades do cadastro de referência.
 *
 * @param {number} quantidade
 * @param {{ seed?: number, defeitos?: Array<{ registro: number, tipo: keyof typeof DEFEITOS }> }} [options]
 *        `registro` é 1-based (registro 1 = linha 2 do arquivo, logo após o cabeçalho).
 */
function gerarRegistros(quantidade, { seed, defeitos = [] } = {}) {
  if (seed !== undefined) faker.seed(seed);

  const registros = Array.from({ length: quantidade }, (_, i) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      nome: `${firstName} ${lastName}`,
      email: `${slug(`${firstName} ${lastName}`)}.${i + 1}@exemplo.com.br`,
      idade: faker.number.int({ min: 18, max: 90 }),
      cidade: faker.helpers.arrayElement(CIDADES_CADASTRADAS),
    };
  });

  for (const { registro, tipo } of defeitos) {
    registros[registro - 1] = DEFEITOS[tipo](registros[registro - 1], registros[0]);
  }
  return registros;
}

/** Atalho: CSV completo (cabeçalho + `quantidade` linhas). */
function gerarCsv(quantidade, options) {
  return paraCsv(gerarRegistros(quantidade, options));
}

/** Grava o conteúdo (texto ou binário) criando a pasta se preciso. */
function salvarCsv(conteudo, caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, conteudo);
  return caminho;
}

/** Nome de arquivo único por execução: o servidor de teste é compartilhado. */
function nomeUnico(prefixo) {
  return `${prefixo}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.csv`;
}

function sha256(conteudo) {
  return crypto.createHash('sha256').update(conteudo).digest('hex');
}

module.exports = { escaparCampo, paraCsv, gerarRegistros, gerarCsv, salvarCsv, nomeUnico, sha256, DEFEITOS };

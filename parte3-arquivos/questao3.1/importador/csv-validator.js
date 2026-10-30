/**
 * Regras de importação de CSV de clientes, usadas pelo servidor do importador
 * (server.js) e pelos testes unitários. Aplica as quatro camadas de validação
 * descritas no enunciado:
 *
 *  1. Formato        - encoding UTF-8, arquivo não vazio, cabeçalho, nº de colunas, aspas
 *  2. Regra de negócio - nome obrigatório, e-mail válido, idade inteira entre 0 e 120
 *  3. Duplicatas     - e-mail único no arquivo (case-insensitive)
 *  4. Relacionamento - cidade precisa existir no cadastro de referência
 *
 * Os erros trazem número de linha física e código estável, para que os testes
 * comparem exatamente "o quê" e "onde", e não só "falhou".
 */

const CABECALHO = ['nome', 'email', 'idade', 'cidade'];

/** Cadastro de referência usado na validação de relacionamento (cidade -> tabela de cidades). */
const CIDADES_CADASTRADAS = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre',
  'Florianópolis', 'Joinville', 'Blumenau', 'Salvador', 'Recife',
  'Fortaleza', 'Belém', 'Manaus', 'Goiânia', 'Brasília',
];

const CODIGOS = {
  ARQUIVO_VAZIO: 'ARQUIVO_VAZIO',
  ENCODING_INVALIDO: 'ENCODING_INVALIDO',
  CABECALHO_INVALIDO: 'CABECALHO_INVALIDO',
  SEM_REGISTROS: 'SEM_REGISTROS',
  ASPAS_NAO_FECHADAS: 'ASPAS_NAO_FECHADAS',
  COLUNAS: 'COLUNAS',
  NOME_OBRIGATORIO: 'NOME_OBRIGATORIO',
  EMAIL_INVALIDO: 'EMAIL_INVALIDO',
  IDADE_INVALIDA: 'IDADE_INVALIDA',
  EMAIL_DUPLICADO: 'EMAIL_DUPLICADO',
  CIDADE_INEXISTENTE: 'CIDADE_INEXISTENTE',
  // Aplicados pelo servidor (server.js), que conhece a base e o tamanho do upload
  EMAIL_JA_CADASTRADO: 'EMAIL_JA_CADASTRADO',
  ARQUIVO_GRANDE: 'ARQUIVO_GRANDE',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parser CSV (RFC 4180): campos entre aspas podem conter vírgula, quebra de
 * linha e aspas escapadas (""). Cada registro guarda a linha física onde
 * começa, para mensagens de erro apontarem a linha certa do arquivo.
 *
 * @param {string} texto
 * @param {string} [separador]
 */
function parseCsv(texto, separador = ',') {
  /** @type {{ linha: number, campos: string[] }[]} */
  const registros = [];
  let campos = [];
  let campo = '';
  let entreAspas = false;
  let linhaAtual = 1;
  let inicioRegistro = 1;
  let inicioAspas = 1;

  const fecharRegistro = () => {
    campos.push(campo);
    registros.push({ linha: inicioRegistro, campos });
    campos = [];
    campo = '';
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        if (c === '\n') linhaAtual++;
        campo += c;
      }
    } else if (c === '"' && campo === '') {
      entreAspas = true;
      inicioAspas = linhaAtual;
    } else if (c === separador) {
      campos.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fecharRegistro();
      linhaAtual++;
      inicioRegistro = linhaAtual;
    } else {
      campo += c;
    }
  }

  if (entreAspas) {
    return { registros, erroAspas: { linha: inicioAspas } };
  }
  // Última linha sem quebra final
  if (campo !== '' || campos.length > 0) fecharRegistro();
  return { registros, erroAspas: undefined };
}

/**
 * @param {Buffer | string} conteudo
 * @returns {{ valido: boolean, totalRegistros: number, registrosValidos: number,
 *             erros: { linha: number, codigo: string, mensagem: string }[],
 *             registros: { linha: number, nome: string, email: string, idade: number, cidade: string }[] }}
 *          `registros` traz só as linhas sem erro, já convertidas.
 */
function validarCsv(conteudo) {
  /** @type {{ linha: number, codigo: string, mensagem: string }[]} */
  const erros = [];
  const erro = (linha, codigo, mensagem) => erros.push({ linha, codigo, mensagem });
  /** @type {{ linha: number, nome: string, email: string, idade: number, cidade: string }[]} */
  const validos = [];
  const resultado = (totalRegistros = 0) => ({
    valido: erros.length === 0,
    totalRegistros,
    registrosValidos: validos.length,
    erros,
    registros: validos,
  });

  const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
  if (buffer.length === 0) {
    erro(0, CODIGOS.ARQUIVO_VAZIO, 'Arquivo vazio (0 bytes)');
    return resultado();
  }

  // 1. Formato: bytes inválidos em UTF-8 ou byte nulo indicam arquivo binário/corrompido.
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    erro(0, CODIGOS.ENCODING_INVALIDO, 'Arquivo não é texto UTF-8 válido (corrompido ou binário)');
    return resultado();
  }
  if (texto.includes('\0')) {
    erro(0, CODIGOS.ENCODING_INVALIDO, 'Arquivo contém bytes nulos (binário)');
    return resultado();
  }
  texto = texto.replace(/^﻿/, '');
  if (texto.trim() === '') {
    erro(0, CODIGOS.ARQUIVO_VAZIO, 'Arquivo sem conteúdo');
    return resultado();
  }

  const { registros, erroAspas } = parseCsv(texto);
  const [cabecalho, ...linhas] = registros;

  const cabecalhoRecebido = cabecalho.campos.map((c) => c.trim().toLowerCase());
  if (cabecalhoRecebido.join(',') !== CABECALHO.join(',')) {
    const dica = cabecalho.campos.length === 1 && cabecalho.campos[0].includes(';') ? ' (separador ";"?)' : '';
    erro(1, CODIGOS.CABECALHO_INVALIDO, `Cabeçalho esperado "${CABECALHO.join(',')}"${dica}`);
    return resultado();
  }

  if (linhas.length === 0 && !erroAspas) {
    erro(1, CODIGOS.SEM_REGISTROS, 'Arquivo contém apenas o cabeçalho');
    return resultado();
  }

  const emails = new Map();

  for (const { linha, campos } of linhas) {
    const errosAntes = erros.length;

    if (campos.length !== CABECALHO.length) {
      erro(linha, CODIGOS.COLUNAS, `Esperadas ${CABECALHO.length} colunas, encontradas ${campos.length}`);
      continue;
    }
    const [nome, email, idade, cidade] = campos.map((c) => c.trim());

    // 2. Regras de negócio
    if (!nome) erro(linha, CODIGOS.NOME_OBRIGATORIO, 'Nome é obrigatório');
    if (!EMAIL_REGEX.test(email)) erro(linha, CODIGOS.EMAIL_INVALIDO, `E-mail inválido: "${email}"`);
    if (!/^\d+$/.test(idade) || Number(idade) > 120) {
      erro(linha, CODIGOS.IDADE_INVALIDA, `Idade deve ser inteiro entre 0 e 120: "${idade}"`);
    }

    // 3. Duplicatas
    const chave = email.toLowerCase();
    if (emails.has(chave)) {
      erro(linha, CODIGOS.EMAIL_DUPLICADO, `E-mail já usado na linha ${emails.get(chave)}`);
    } else {
      emails.set(chave, linha);
    }

    // 4. Relacionamento
    if (!CIDADES_CADASTRADAS.includes(cidade)) {
      erro(linha, CODIGOS.CIDADE_INEXISTENTE, `Cidade não cadastrada: "${cidade}"`);
    }

    if (erros.length === errosAntes) validos.push({ linha, nome, email, idade: Number(idade), cidade });
  }

  if (erroAspas) {
    erro(erroAspas.linha, CODIGOS.ASPAS_NAO_FECHADAS, 'Aspas abertas e não fechadas até o fim do arquivo');
  }

  return resultado(linhas.length);
}

module.exports = { CABECALHO, CIDADES_CADASTRADAS, CODIGOS, parseCsv, validarCsv };

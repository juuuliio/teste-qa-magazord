/**
 * Importador de clientes por CSV: sistema de referência da Parte 3.
 *
 * O the-internet só armazena arquivos. Este servidor faz o que o contexto da
 * questão descreve: recebe o CSV, aplica as regras de importação, rejeita o
 * arquivo inválido e grava os registros válidos. Assim a rejeição é testada de
 * ponta a ponta (tela, status HTTP e base de dados), não só por função local.
 *
 * Sem dependências: `node server.js` (porta IMPORTADOR_PORT, padrão 3333).
 * O Playwright sobe o servidor automaticamente (webServer no playwright.config.js).
 *
 * Rotas
 *   GET  /                             tela de importação (?loja=<id>)
 *   GET  /health                       verificação usada pelo Playwright
 *   POST /api/lojas/:loja/importacoes  corpo = bytes do CSV
 *        201 { status: 'importado', importados }
 *        422 { status: 'rejeitado', totalRegistros, erros: [{ linha, codigo, mensagem }] }
 *        413 { status: 'rejeitado', erros: [{ linha: 0, codigo: 'ARQUIVO_GRANDE', mensagem }] }
 *   GET  /api/lojas/:loja/clientes     registros gravados da loja
 *
 * Política "tudo ou nada": qualquer erro rejeita o arquivo inteiro e nada é
 * gravado. Os dados ficam em memória, separados por loja (multi-tenant), o que
 * isola os testes que rodam em paralelo.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { validarCsv, CODIGOS } = require('./csv-validator');

const PORTA = Number(process.env.IMPORTADOR_PORT) || 3333;
const LIMITE_BYTES = 2 * 1024 * 1024;
const PAGINA = fs.readFileSync(path.join(__dirname, 'index.html'));

/** loja -> Map(e-mail em minúsculas -> registro) */
const bases = new Map();

function baseDaLoja(loja) {
  if (!bases.has(loja)) bases.set(loja, new Map());
  return bases.get(loja);
}

function responderJson(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

/** Lê o corpo da requisição; acima do limite devolve undefined sem acumular o excedente. */
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho <= LIMITE_BYTES) partes.push(parte);
    });
    req.on('end', () => resolve(tamanho > LIMITE_BYTES ? undefined : Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function importar(req, res, loja) {
  const corpo = await lerCorpo(req);
  if (corpo === undefined) {
    return responderJson(res, 413, {
      status: 'rejeitado',
      erros: [{ linha: 0, codigo: CODIGOS.ARQUIVO_GRANDE, mensagem: `Arquivo acima de ${LIMITE_BYTES / 1024 / 1024} MB` }],
    });
  }

  const validacao = validarCsv(corpo);
  const base = baseDaLoja(loja);
  const erros = [...validacao.erros];

  // Duplicata contra a base: e-mail já importado por um arquivo anterior da mesma loja.
  for (const { linha, email } of validacao.registros) {
    if (base.has(email.toLowerCase())) {
      erros.push({ linha, codigo: CODIGOS.EMAIL_JA_CADASTRADO, mensagem: `E-mail já cadastrado: "${email}"` });
    }
  }

  if (erros.length > 0) {
    erros.sort((a, b) => a.linha - b.linha);
    return responderJson(res, 422, { status: 'rejeitado', totalRegistros: validacao.totalRegistros, erros });
  }

  for (const { linha, ...registro } of validacao.registros) base.set(registro.email.toLowerCase(), registro);
  return responderJson(res, 201, { status: 'importado', importados: validacao.registros.length });
}

const servidor = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const rotaLoja = pathname.match(/^\/api\/lojas\/([\w-]+)\/(importacoes|clientes)$/);

    if (req.method === 'GET' && pathname === '/health') return responderJson(res, 200, { status: 'ok' });
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGINA);
    }
    if (rotaLoja && req.method === 'POST' && rotaLoja[2] === 'importacoes') return await importar(req, res, rotaLoja[1]);
    if (rotaLoja && req.method === 'GET' && rotaLoja[2] === 'clientes') {
      return responderJson(res, 200, [...baseDaLoja(rotaLoja[1]).values()]);
    }
    return responderJson(res, 404, { erro: 'Rota não encontrada' });
  } catch (erro) {
    return responderJson(res, 500, { erro: erro.message });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`Importador de clientes em http://127.0.0.1:${PORTA}`);
});

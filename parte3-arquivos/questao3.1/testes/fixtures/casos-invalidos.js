const { CODIGOS } = require('../../importador/csv-validator');

/**
 * Arquivos inválidos versionados nesta pasta e os erros esperados (linha física
 * + código). Compartilhado pelos testes de upload no the-internet e pelos
 * testes do importador, para os dois afirmarem exatamente a mesma regra.
 */
const CASOS_INVALIDOS = [
  {
    id: 'vazio',
    descricao: 'CSV vazio (0 bytes)',
    arquivo: 'vazio.csv',
    erros: [{ linha: 0, codigo: CODIGOS.ARQUIVO_VAZIO }],
  },
  {
    id: 'somente-cabecalho',
    descricao: 'CSV só com cabeçalho',
    arquivo: 'somente-cabecalho.csv',
    erros: [{ linha: 1, codigo: CODIGOS.SEM_REGISTROS }],
  },
  {
    id: 'formato-incorreto',
    descricao: 'CSV com formato incorreto (separador ";" e cabeçalho diferente)',
    arquivo: 'formato-incorreto.csv',
    erros: [{ linha: 1, codigo: CODIGOS.CABECALHO_INVALIDO }],
  },
  {
    id: 'dados-malformados',
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
    id: 'corrompido',
    descricao: 'CSV corrompido (conteúdo binário)',
    arquivo: 'corrompido.csv',
    erros: [{ linha: 0, codigo: CODIGOS.ENCODING_INVALIDO }],
  },
];

module.exports = { CASOS_INVALIDOS };

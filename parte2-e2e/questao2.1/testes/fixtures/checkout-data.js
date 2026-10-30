const { randomInt } = require('node:crypto');
const { fakerPT_BR: faker } = require('@faker-js/faker');

/** Credenciais públicas do SauceDemo (fornecidas no enunciado, não são secrets). */
const USUARIO_PADRAO = { username: 'standard_user', password: 'secret_sauce' };

/**
 * Semente da massa de dados. Cada execução usa uma semente nova; para
 * reproduzir uma falha, rode com FAKER_SEED=<semente anotada no relatório>.
 */
function definirSemente(seed = Number(process.env.FAKER_SEED) || randomInt(2 ** 31 - 1)) {
  faker.seed(seed);
  return seed;
}

/** Dados do comprador gerados dinamicamente (nome, sobrenome e CEP brasileiros). */
function gerarComprador() {
  return {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    postalCode: faker.location.zipCode('#####-###'),
  };
}

/**
 * Sorteia `quantidade` produtos distintos da vitrine.
 * @param {string[]} produtosDisponiveis
 */
function sortearProdutos(produtosDisponiveis, quantidade) {
  return faker.helpers.arrayElements(produtosDisponiveis, quantidade);
}

module.exports = { USUARIO_PADRAO, definirSemente, gerarComprador, sortearProdutos };

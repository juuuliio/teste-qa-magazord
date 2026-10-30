/** "$29.99" ou "Item total: $29.99" -> 29.99 */
function parsePreco(texto) {
  const match = texto.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Preço não encontrado em "${texto}"`);
  return Number(match[1]);
}

const arredondar = (/** @type {number} */ valor) => Math.round(valor * 100) / 100;

module.exports = { parsePreco, arredondar };

/**
 * Remove todo o estado do navegador deixado por um teste: cookies (o SauceDemo
 * guarda o usuário logado em `session-username`) e Web Storage (o carrinho
 * fica em `localStorage['cart-contents']`).
 *
 * O Playwright já cria um contexto novo por teste; a limpeza explícita garante
 * isolamento também quando o contexto é reaproveitado (ex.: storageState,
 * modo debug, execução em outro runner) e documenta o que é estado do teste.
 *
 * @param {import('@playwright/test').Page} page
 */
async function limparSessao(page) {
  await page.context().clearCookies();
  // Web Storage é por origem: só pode ser limpo com uma página do site aberta.
  if (page.url().startsWith('http')) {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
}

/** @param {import('@playwright/test').Page} page */
async function lerEstadoSessao(page) {
  return {
    cookies: await page.context().cookies(),
    localStorage: await page.evaluate(() => ({ ...localStorage })),
    sessionStorage: await page.evaluate(() => ({ ...sessionStorage })),
  };
}

module.exports = { limparSessao, lerEstadoSessao };

/** Tela de login do SauceDemo (/). */
class LoginPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.username = page.getByTestId('username');
    this.password = page.getByTestId('password');
    this.botaoLogin = page.getByTestId('login-button');
    this.erro = page.getByTestId('error');
  }

  async goto() {
    await this.page.goto('/');
  }

  /** @param {{ username: string, password: string }} credenciais */
  async login({ username, password }) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.botaoLogin.click();
  }
}

module.exports = { LoginPage };

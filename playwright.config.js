// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

/**
 * Um "project" por parte do teste: permite rodar cada parte isoladamente
 * (npm run test:parteN) e dar a cada uma a configuração que faz sentido
 * (API sem browser, E2E com testIdAttribute do SauceDemo, etc.).
 */
module.exports = defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'parte1-api',
      testDir: './parte1-api',
      // Testes de rate limit dependem da ordem (cota compartilhada pelo IP): execução sequencial.
      fullyParallel: false,
    },
    {
      name: 'parte2-e2e',
      testDir: './parte2-e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.SAUCEDEMO_URL || 'https://www.saucedemo.com',
        // O SauceDemo expõe atributos data-test estáveis: getByTestId() passa a usá-los.
        testIdAttribute: 'data-test',
      },
    },
    {
      name: 'parte3-arquivos',
      testDir: './parte3-arquivos',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.THE_INTERNET_URL || 'https://the-internet.herokuapp.com',
      },
    },
  ],
});

/**
 * Smoke tests (S11, D-034): the main loop against a running environment, never the mock. Each run makes its own
 * throwaway club and accounts on smoke.runflow.club (no e-mail ever goes there) and deletes them at the end.
 *   SMOKE_URL=https://qa.runflow.club SMOKE_KEY=… npx playwright test -c playwright.smoke.config.ts
 * Against a development backend (EMAIL_PROVIDER=log) no key is needed: sign-in answers the code anyway.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e-smoke",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.SMOKE_URL ?? "http://localhost:4173",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
});

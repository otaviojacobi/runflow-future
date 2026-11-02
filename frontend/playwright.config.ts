/**
 * End-to-end suite (F20). Runs its own mock API (:8788, fresh seed in a temp file) and web server (:8089),
 * so it never touches the demo on :8787/:8080. Local runs can point at an installed Chrome with PW_CHROME.
 */
import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_PORT = 8788, WEB_PORT = 8089;
export default defineConfig({
  testDir: "e2e",
  workers: 1, // the mock API is one shared state
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  webServer: [
    { command: "node ../api/mock/server.mjs --reset", url: `http://localhost:${API_PORT}/v1/health`, reuseExistingServer: false, env: { PORT: String(API_PORT), MOCK_LATENCY: "0", MOCK_DATA_FILE: join(tmpdir(), "runflow-e2e-db.json") } },
    { command: `npx vite --port ${WEB_PORT} --strictPort`, url: `http://localhost:${WEB_PORT}`, reuseExistingServer: false, env: { PORT: String(WEB_PORT), RUNFLOW_API: `http://localhost:${API_PORT}` } },
  ],
});

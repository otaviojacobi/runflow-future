import { expect, test, type Page } from "@playwright/test";
import { OWNER, signIn } from "./helpers";

const RUNFLOW_BRAND = "#4b4fe8";
const brand = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rf-brand-solid").trim().toLowerCase());

/** Public pages are always Runflow's; the club's colors only inside the signed-in app (founder, 2026-11-02). */
test("club colors only inside the app", async ({ page }) => {
  await signIn(page, OWNER); // Pace Forte: red
  await expect(page).toHaveURL(/\/dashboard/);
  expect(await brand(page)).not.toBe(RUNFLOW_BRAND);
  for (const path of ["/", "/clubs", "/invite/nao-existe", "/rota-inexistente"]) {
    await page.goto(path); // full load: the inline script must not paint the cached club theme here
    await page.waitForLoadState("networkidle");
    expect(await brand(page), path).toBe(RUNFLOW_BRAND);
  }
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  expect(await brand(page)).not.toBe(RUNFLOW_BRAND);
});

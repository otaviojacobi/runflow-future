import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

/** WCAG 2.1 A/AA rules; serious and critical findings fail the build. */
async function audit(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect.soft(bad.map((v) => `${path} ` +  `${v.id}: ${v.help} (${v.nodes.length}) → ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  void path;
}

// Each test sweeps many screens; under a loaded machine or CI that can pass 30 s.
test.describe.configure({ timeout: 90_000 });

test("public pages", async ({ page }) => {
  for (const path of ["/", "/login"]) await test.step(path, () => audit(page, path));
});
test("staff pages", async ({ page }) => {
  await signIn(page, OWNER);
  for (const path of ["/dashboard", "/students", "/planning", "/library", "/messages", "/reports", "/classes/manage", "/club/settings"]) await test.step(path, () => audit(page, path));
});
test("student pages", async ({ page }) => {
  await signIn(page, STUDENT);
  for (const path of ["/today", "/schedule", "/classes", "/activities", "/races", "/messages", "/account"]) await test.step(path, () => audit(page, path));
});

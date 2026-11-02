import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

test.use({ viewport: { width: 360, height: 780 } });

/** No page may scroll sideways on a small phone. */
async function noSideScroll(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect.soft(sw, `${path} is ${sw}px wide on a ${iw}px screen`).toBeLessThanOrEqual(iw + 1);
}

test("student screens fit a 360 px phone", async ({ page }) => {
  await signIn(page, STUDENT);
  for (const p of ["/today", "/schedule", "/activities", "/classes", "/races", "/challenges", "/messages", "/payments", "/account", "/account/profile", "/notifications"]) await noSideScroll(page, p);
});
test("staff screens fit a 360 px phone", async ({ page }) => {
  await signIn(page, OWNER);
  for (const p of ["/dashboard", "/students", "/planning", "/feedback", "/messages", "/library", "/plans", "/exercises", "/assessments", "/reports", "/classes/manage", "/races/manage", "/challenges/manage", "/club/studio", "/club/members", "/club/settings", "/club/finances", "/club/billing"]) await noSideScroll(page, p);
});

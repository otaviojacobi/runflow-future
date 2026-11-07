import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

test.use({ viewport: { width: 360, height: 780 } });

/**
 * No page may scroll sideways on a small phone, nor run past its right edge: the main area clips what overflows, so
 * a page wider than the screen doesn't scroll, it gets cut (founder, 2026-11-07: Atividades cut "Registrar" to
 * "Regis"). Content inside a sideways scroller (a days strip, a wide table) is meant to be wider.
 */
async function noSideScroll(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { sw, iw, cut } = await page.evaluate(() => {
    const vw = window.innerWidth;
    const inScroller = (e: Element) => {
      for (let a = e.parentElement; a && a.tagName !== "MAIN"; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const cut = [...document.querySelectorAll("main *")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== "fixed" && !inScroller(e); })
      .slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
    return { sw: document.documentElement.scrollWidth, iw: vw, cut };
  });
  expect.soft(sw, `${path} is ${sw}px wide on a ${iw}px screen`).toBeLessThanOrEqual(iw + 1);
  expect.soft(cut, `${path} runs past the right edge`).toEqual([]);
}

// Each test sweeps many screens; under a loaded machine or CI that can pass 30 s.
test.describe.configure({ timeout: 90_000 });

test("student screens fit a 360 px phone", async ({ page }) => {
  await signIn(page, STUDENT);
  for (const p of ["/today", "/schedule", "/classes", "/activities", "/races", "/messages", "/account", "/account/profile", "/notifications"]) await noSideScroll(page, p);
});
test("staff screens fit a 360 px phone", async ({ page }) => {
  await signIn(page, OWNER);
  for (const p of ["/dashboard", "/students", "/planning", "/feedback", "/messages", "/library", "/plans", "/exercises", "/assessments", "/reports", "/races/manage", "/classes/manage", "/club/studio", "/club/members", "/club/settings", "/club/billing"]) await noSideScroll(page, p);
});

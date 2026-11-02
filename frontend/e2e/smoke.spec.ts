import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, failOnPageErrors, signIn } from "./helpers";

test("landing page leads to sign-in", async ({ page }) => {
  const check = failOnPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("O treino do seu");
  await page.getByRole("link", { name: "Entrar" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  check();
});

test("owner lands on the dashboard", async ({ page }) => {
  const check = failOnPageErrors(page);
  await signIn(page, OWNER);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcos");
  check();
});

test("student lands on Hoje", async ({ page }) => {
  const check = failOnPageErrors(page);
  await signIn(page, STUDENT);
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bruno");
  check();
});

test("unknown routes show the 404 page", async ({ page }) => {
  await page.goto("/nao-existe");
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("command palette opens a student", async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The shell attaches its shortcut listener right after mounting: retry until the palette shows.
  await expect(async () => { await page.keyboard.press("Control+k"); await expect(page.getByRole("combobox")).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 8000 });
  await page.getByRole("combobox").fill("henri");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/students\//);
});

import { type Page, expect } from "@playwright/test";

export const OWNER = "marcos@paceforte.com.br", TRAINER = "julia@paceforte.com.br", STUDENT = "bruno.lima@email.com", SWIMMER_OWNER = "renata@equipemare.com.br";

/** Sign in through the real e-mail code flow (the mock accepts 000000). */
export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Receber código por e-mail" }).click();
  await page.getByLabel("Código").fill("000000");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Fail on uncaught page errors. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors, "uncaught errors in the page").toEqual([]);
}

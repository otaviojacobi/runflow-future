import { expect, test } from "@playwright/test";
import { OWNER, SWIMMER_OWNER, signIn } from "./helpers";

/** D-023: personal, e-mailed, 7-day invites that only the invited e-mail can accept. */
test("owner invites by e-mail and only that account can join", async ({ page, browser, request }) => {
  const email = `convidada.${Date.now()}@email.com`;
  await signIn(page, OWNER);
  await page.goto("/club/members");
  await page.getByRole("button", { name: "Convidar por e-mail" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("E-mail", { exact: true }).fill(email);
  await d.getByLabel("Nome").fill("Helena");
  await d.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByText(`Convite enviado para ${email}`)).toBeVisible();
  // One person at a time: the form clears for the next invite and lists who was invited.
  await expect(d.getByLabel("E-mail", { exact: true })).toHaveValue("");
  await expect(d.getByText(`Helena · ${email}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Convites/ }).click();
  await expect(page.getByText(`Helena · ${email}`)).toBeVisible();

  // The e-mail is in the (mock) outbox with the personal link.
  const mail = (await (await request.get(`http://localhost:8788/v1/mock/outbox?to=${email}`)).json()).items[0];
  expect(mail.subject).toContain("convidou você para o Pace Forte Assessoria");
  const link: string = mail.action.url;

  // Someone else (signed in with another e-mail) cannot use it.
  const other = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(other, SWIMMER_OWNER); // not a Pace Forte member
  await other.goto(link);
  await expect(other.getByText(/mas este convite é para/)).toBeVisible();

  // The invited e-mail joins.
  const invited = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await invited.goto(link);
  await invited.getByRole("link", { name: "Entrar para aceitar" }).click();
  // The invite pre-fills (and locks) the invited address.
  await expect(invited.getByLabel("E-mail")).toHaveValue(email);
  await expect(invited.getByLabel("E-mail")).toHaveAttribute("readonly", "");
  await invited.getByRole("button", { name: "Receber código por e-mail" }).click();
  await invited.getByLabel("Código").fill("000000");
  await invited.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(invited).toHaveURL(/\/welcome/);

  // Onboarding: consent, then "Nome completo" (first and last name), then the watch; no goal step (D-035).
  await invited.getByRole("checkbox").first().check();
  await invited.getByRole("button", { name: "Continuar" }).click();
  await invited.getByLabel("Nome completo").fill("Helena");
  await invited.getByRole("button", { name: "Continuar" }).click();
  await expect(invited.getByText("Informe nome e sobrenome.")).toBeVisible();
  await invited.getByLabel("Nome completo").fill("Helena Prado");
  await invited.getByRole("button", { name: "Continuar" }).click();
  await expect(invited.getByRole("heading", { name: "Conecte seu relógio" })).toBeVisible();
});

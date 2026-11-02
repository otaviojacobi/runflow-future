import { expect, test } from "@playwright/test";
import { OWNER, SWIMMER_OWNER, signIn } from "./helpers";

/** D-023: personal, e-mailed, 7-day invites that only the invited e-mail can accept. */
test("owner invites by e-mail and only that account can join", async ({ page, browser, request }) => {
  const email = `convidada.${Date.now()}@email.com`;
  await signIn(page, OWNER);
  await page.goto("/club/members");
  await page.getByRole("button", { name: "Convidar por e-mail" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("E-mails").fill(email);
  await d.getByLabel("Nome").fill("Helena");
  await d.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByText("Convite enviado por e-mail")).toBeVisible();
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
  await invited.getByLabel("E-mail").fill(email);
  await invited.getByRole("button", { name: "Receber código por e-mail" }).click();
  await invited.getByLabel("Código").fill("000000");
  await invited.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(invited).toHaveURL(/\/welcome/);
});

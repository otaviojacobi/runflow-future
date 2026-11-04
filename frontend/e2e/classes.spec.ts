import { expect, test, type Page } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

/** Aulas (D-052): staff create a schedule, a student takes the only seat, another waits, a cancel promotes. */
const SECOND_STUDENT = "ana.souza@email.com";
const LONG = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** Tomorrow, club time (São Paulo): its ISO weekday. */
function tomorrowWeekday() {
  const d = new Date(Date.now() - 3 * 3600_000 + 86_400_000);
  return ((d.getUTCDay() + 6) % 7) + 1;
}
/** The student's Aulas, tomorrow's 06:15 class row. */
async function tomorrowsClass(page: Page) {
  await page.goto("/classes");
  await page.getByRole("group", { name: "Dias" }).getByRole("button").nth(1).click();
  // The day's list (once booked, the class also shows under "Minhas reservas").
  return page.getByRole("region", { name: "Próximas aulas" }).locator("article", { hasText: "06:15" });
}

test("aulas: a schedule, a booking, the waitlist, and a cancel that promotes it", async ({ page, browser }) => {
  // Staff: a recurring schedule with one seat, tomorrow at 06:15.
  await signIn(page, OWNER);
  await page.goto("/classes/manage");
  await page.getByRole("button", { name: "Nova grade" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tipo de aula").selectOption({ index: 1 });
  await dialog.getByLabel("Vagas").fill("1");
  await dialog.getByRole("button", { name: LONG[tomorrowWeekday()], exact: true }).click();
  await dialog.getByLabel("Horário de início").fill("0615");
  await dialog.getByRole("button", { name: "Criar grade" }).click();
  await expect(page.getByText("Grade criada")).toBeVisible();

  // First student takes the seat.
  const first = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(first, STUDENT);
  const row1 = await tomorrowsClass(first);
  await row1.getByRole("button", { name: /^Reservar ·/ }).click();
  await expect(first.getByText("Vaga garantida!")).toBeVisible();
  await expect(row1.getByText("Reservado")).toBeVisible();

  // The class is full: the second student joins the waitlist.
  const second = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(second, SECOND_STUDENT);
  const row2 = await tomorrowsClass(second);
  await row2.getByRole("button", { name: "Entrar na fila" }).click();
  await expect(second.getByText("Você entrou na fila")).toBeVisible();
  await expect(row2.getByText("1º na fila")).toBeVisible();

  // The first student cancels: the waitlist moves up.
  await row1.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(first.getByText("Reserva cancelada")).toBeVisible();
  const promoted = await tomorrowsClass(second);
  await expect(promoted.getByText("Reservado")).toBeVisible();
});

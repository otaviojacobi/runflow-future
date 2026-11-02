import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

test("student books a class", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/classes");
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  // Find a day in the agenda with a class this student hasn't booked yet.
  const book = page.getByRole("button", { name: /^Reservar|^Entrar na fila/ });
  for (const tab of await page.getByRole("tab").all()) { if (await book.count()) break; await tab.click(); }
  await book.first().click();
  await expect(page.getByText(/Vaga garantida!|Você entrou na fila/)).toBeVisible();
});

test("trainer and student exchange messages", async ({ page, browser }) => {
  await signIn(page, OWNER);
  await page.goto("/messages");
  await page.getByRole("button", { name: /Bruno Lima/ }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill("Oi Bruno, tudo certo para sábado?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Oi Bruno, tudo certo para sábado?").first()).toBeVisible();
  const student = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(student, STUDENT);
  await student.goto("/messages?c=1");
  await expect(student.getByText("Oi Bruno, tudo certo para sábado?")).toBeVisible();
});

test("owner adds a race and the student signs up", async ({ page, browser }) => {
  await signIn(page, OWNER);
  await page.goto("/races/manage");
  await page.getByRole("button", { name: "Nova prova" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nome da prova").fill("Corrida E2E");
  await d.getByLabel("Data").fill("2027-03-14");
  await d.getByRole("button", { name: "10 km" }).click();
  await d.getByRole("button", { name: "Adicionar prova" }).click();
  await expect(page.getByText("Prova adicionada ao calendário")).toBeVisible();
  const student = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(student, STUDENT);
  await student.goto("/races");
  await student.getByRole("article").filter({ hasText: "Corrida E2E" }).getByRole("button", { name: "Quero participar" }).click();
  await student.getByRole("dialog").getByRole("button", { name: "Confirmar participação" }).click();
  await expect(student.getByText("Inscrição feita!")).toBeVisible();
});

test("assistant turns a description into a workout", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/library/new");
  await page.getByLabel("Descrição do treino").fill("15 min de aquecimento, 5 tiros de 1 km a 4:30 com 2 min de trote e 10 min de desaquecimento");
  await page.getByRole("button", { name: "Montar treino" }).click();
  await expect(page.getByLabel("Nome do treino")).toHaveValue("Intervalado 5×1 km");
});

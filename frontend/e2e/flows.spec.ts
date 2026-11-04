import { expect, test } from "@playwright/test";
import { OWNER, STUDENT, signIn } from "./helpers";

test("week release: a future week stays in preparation until the trainer releases it", async ({ page, browser }) => {
  // Two weeks ahead: never released automatically yet, whatever day the suite runs (D-031).
  const student = await (await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  await signIn(student, STUDENT);
  await student.goto("/schedule");
  for (let i = 0; i < 2; i++) await student.getByRole("button", { name: "Próximo" }).click();
  await expect(student.getByText("Semana em preparação")).toBeVisible();

  await signIn(page, OWNER);
  await page.goto("/planning");
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Próxima semana" }).click();
  await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Liberar semana" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Liberar", exact: true }).click();
  await expect(page.getByText("Semana liberada", { exact: true }).first()).toBeVisible();

  await student.reload();
  for (let i = 0; i < 2; i++) await student.getByRole("button", { name: "Próximo" }).click();
  await expect(student.getByText("Semana em preparação")).toHaveCount(0);
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
  await d.getByLabel("Data").fill("14/03/2027");
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

test("hashtags: typed in quick text, saved, and used to filter the library", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/library/new");
  const name = `Tiros E2E ${Date.now()}`;
  await page.getByLabel("Nome do treino").fill(name);
  await page.getByLabel("Escrita rápida").fill("10' aquec + 8x400m @3:50 c/ 1' trote + 10' desaq #Tiros-Curtos ");
  await expect(page.getByRole("button", { name: "Remover #tiros-curtos" })).toBeVisible();
  await page.getByLabel("Tags").fill("pista ");
  await page.getByRole("button", { name: "Salvar na biblioteca" }).click();
  await expect(page.getByText("Treino salvo na biblioteca")).toBeVisible();
  await page.goto("/library");
  await page.getByLabel("Buscar treino").fill("#tiros-curtos");
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Buscar treino").fill("");
  await page.getByRole("group", { name: "Filtrar por tag" }).getByRole("button", { name: "#pista" }).click();
  await expect(page.getByText(name)).toBeVisible();
});

test("activity matching: the student says which workout an ambiguous run was (D-049)", async ({ page }) => {
  // The seed gives Ana a run from yesterday that fits two of her workouts about equally well.
  await signIn(page, "ana.souza@email.com");
  await page.goto("/today");
  const question = page.getByRole("heading", { name: "Qual treino foi esta atividade?" });
  await expect(question).toBeVisible();
  const option = page.getByRole("button", { name: /Foi este/ }).first();
  const title = (await option.locator("span.font-semibold").first().textContent())!;
  await option.click();
  await expect(page.getByText("Atividade ligada ao treino")).toBeVisible();
  await expect(question).toHaveCount(0);
  await page.goto("/activities");
  await page.getByRole("link", { name: /Corrida matinal/ }).click();
  await expect(page.getByText("Você escolheu este treino.")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
});

test("an open workout conversation shows the trainer's reply without leaving the page (regression, 2026-11-04)", async ({ page, request }) => {
  // The founder replied to a student on QA and she never saw it: the open conversation was fetched once.
  const API = "http://localhost:8788/v1";
  const token = async (email: string) => {
    await request.post(`${API}/auth/email/start`, { data: { email } });
    return (await (await request.post(`${API}/auth/email/verify`, { data: { email, code: "000000" } })).json()).token as string;
  };
  const as = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
  const student = await token(STUDENT);
  const me = await (await request.get(`${API}/me`, as(student))).json();
  const clubId = me.memberships.find((m: { membership: { role: string } }) => m.membership.role === "student").club.id;
  const day = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const calendar = await (await request.get(`${API}/clubs/${clubId}/my/workouts?from=${day(-7)}&to=${day(7)}`, as(student))).json();
  const workout = calendar.items[0];
  expect(workout, "the student has a visible workout").toBeTruthy();

  await signIn(page, STUDENT);
  const loaded = page.waitForResponse((r) => r.url().includes(`/planned-workouts/${workout.id}/comments`) && r.request().method() === "GET");
  await page.goto(`/workouts/${workout.id}`);
  await expect(page.getByRole("heading", { name: "Conversa com o treinador" })).toBeVisible();
  await loaded;

  const reply = `Vamos ajustar no próximo treino (${Date.now()})`;
  const owner = await token(OWNER);
  const posted = await request.post(`${API}/clubs/${clubId}/planned-workouts/${workout.id}/comments`, { ...as(owner), data: { body: reply } });
  expect(posted.ok()).toBeTruthy();
  await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 });
});

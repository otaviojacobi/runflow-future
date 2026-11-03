/** S11 smoke (D-034): sign in, create a club, invite and accept a student, plan and release, the student trains and
 * gives feedback, the trainer sees it; then the club and both accounts are deleted. API-level, plus the student's
 * sign-in and Hoje in the browser. */
import { type APIRequestContext, expect, test } from "@playwright/test";

const KEY = process.env.SMOKE_KEY ?? "";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER = `owner-${RUN}@smoke.runflow.club`;
const STUDENT = `student-${RUN}@smoke.runflow.club`;
const CLUB = `Smoke ${RUN}`;
const smokeHeaders = KEY ? { "x-smoke-key": KEY } : {};
const day = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + offset * 86_400_000));
const nextMonday = () => { const d = new Date(`${day()}T12:00:00Z`); const w = (d.getUTCDay() + 6) % 7; return day(7 - w); };
const structure = { v: 1, blocks: [{ kind: "step", intent: "active", duration: { type: "time", s: 1800 }, target: { type: "zone", metric: "pace", zone: 2 } }] };

/** Sign in through the API (the code comes back for smoke addresses) → a Bearer token. */
async function signIn(api: APIRequestContext, email: string): Promise<string> {
  const start = await api.post("/api/v1/auth/email/start", { data: { email }, headers: smokeHeaders });
  expect(start.ok(), await start.text()).toBeTruthy();
  const code = (await start.json()).dev_code as string | undefined;
  expect(code, "the environment answers smoke codes (SMOKE_KEY set on both sides?)").toBeTruthy();
  const v = await api.post("/api/v1/auth/email/verify", { data: { email, code }, headers: { "x-client": "mobile" } });
  expect(v.ok(), await v.text()).toBeTruthy();
  return (await v.json()).token;
}
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

test("main loop on a throwaway club", async ({ request: api, page }) => {
  const health = await api.get("/api/v1/health");
  expect((await health.json()).ok).toBe(true);

  const owner = await signIn(api, OWNER);
  const created = await api.post("/api/v1/clubs", { headers: as(owner), data: { name: CLUB, modalities: ["run"] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const clubId: string = (await created.json()).club.id;
  const club = `/api/v1/clubs/${clubId}`;
  let student = "";
  try {
    // Invite (no e-mail goes out to smoke addresses) and accept.
    const invite = await api.post(`${club}/invites`, { headers: as(owner), data: { email: STUDENT } });
    expect(invite.ok(), await invite.text()).toBeTruthy();
    const token = String((await invite.json()).url).split("/").pop();
    // The student signs in once, in the browser (the sign-in screen is part of the loop); the API calls reuse the token.
    if (KEY) await page.route("**/api/v1/auth/email/start", (r) => r.continue({ headers: { ...r.request().headers(), "x-smoke-key": KEY } }));
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(STUDENT);
    const started = page.waitForResponse((r) => r.url().endsWith("/auth/email/start"));
    await page.getByRole("button", { name: "Receber código por e-mail" }).click();
    const code = (await (await started).json()).dev_code as string | undefined;
    expect(code, "the environment answers smoke codes (SMOKE_KEY set on both sides?)").toBeTruthy();
    const verified = page.waitForResponse((r) => r.url().endsWith("/auth/email/verify"));
    await page.getByLabel("Código").fill(code!);
    student = (await (await verified).json()).token;
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    const accepted = await api.post(`/api/v1/invites/${token}/accept`, { headers: as(student), data: {} });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    const athlete: string = (await accepted.json()).membership.id;

    // Today's workout: visible at once (the week has started), in the API and on Hoje.
    const title = `Rodagem smoke ${RUN}`;
    const assigned = await api.post(`${club}/planned-workouts`, { headers: as(owner), data: { athlete_ids: [athlete], dates: [day()], sport: "run", title, structure } });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const workoutId: string = (await assigned.json()).items[0].id;
    const mine = await (await api.get(`${club}/my/workouts?from=${day()}&to=${day()}`, { headers: as(student) })).json();
    expect(mine.items.map((w: { title: string }) => w.title)).toContain(title);
    await page.goto("/today");
    await expect(page.getByText(title).first()).toBeVisible();

    // Feedback reaches the trainer.
    const done = await api.put(`${club}/my/workouts/${workoutId}/completion`, { headers: as(student), data: { status: "completed", rpe: 5, comment: "smoke" } });
    expect(done.ok(), await done.text()).toBeTruthy();
    const inbox = await (await api.get(`${club}/feedback?filter=all`, { headers: as(owner) })).json();
    expect(inbox.items.some((i: { workout: { id: string } }) => i.workout.id === workoutId)).toBe(true);

    // Next week stays a draft until it's released (D-031).
    const monday = nextMonday();
    await api.post(`${club}/planned-workouts`, { headers: as(owner), data: { athlete_ids: [athlete], dates: [monday], sport: "run", title: `${title} 2`, structure } });
    const before = await (await api.get(`${club}/my/workouts?from=${monday}&to=${monday}`, { headers: as(student) })).json();
    expect(before.items).toHaveLength(0);
    const released = await api.post(`${club}/weeks/${monday}/release`, { headers: as(owner), data: {} });
    expect(released.ok(), await released.text()).toBeTruthy();
    const after = await (await api.get(`${club}/my/workouts?from=${monday}&to=${monday}`, { headers: as(student) })).json();
    expect(after.items).toHaveLength(1);
  } finally {
    // Leave nothing behind: close the club, then delete both accounts (LGPD deletion).
    await api.delete(club, { headers: as(owner), data: { confirm_name: CLUB } });
    if (student) await api.delete("/api/v1/me", { headers: as(student) });
    await api.delete("/api/v1/me", { headers: as(owner) });
  }
});

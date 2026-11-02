/** Club finances (F26): fee plans, student fees, monthly charges, payments (mock Stripe Connect / Pix), receipts. */
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const METHODS = ["pix", "card", "boleto", "cash", "transfer", "other"];
const INTERVAL_MONTHS = { month: 1, quarter: 3, year: 12 };

export default function register(h) {
  const userOfM = (mid) => { const m = h.db.memberships.find((x) => x.id === mid); return m ? h.publicUser(h.db.users.find((u) => u.id === m.user_id)) : null; };
  const firstOf = (period) => period + "-01";
  const periodOk = (p) => /^\d{4}-\d{2}$/.test(p || "");
  const state = (c) => (c.status === "open" && c.due_date < h.today() ? "overdue" : c.status);
  const out = (c) => ({ ...c, state: state(c), athlete: { membership_id: c.membership_id, user: userOfM(c.membership_id) } });
  const account = (clubId) => h.db.club_payout_accounts.find((a) => a.club_id === clubId) || null;
  const nextReceipt = (clubId) => 1 + Math.max(0, ...h.db.charges.filter((c) => c.club_id === clubId && c.receipt_number).map((c) => c.receipt_number));
  const ownCharge = (ctx) => h.db.charges.find((c) => c.id === ctx.params.id && c.club_id === ctx.params.club_id) || h.fail(404, "charge.not_found", "Cobrança não encontrada", "Ela pode ter sido cancelada.");
  const notify = (mid, clubId, title, body) => { const m = h.db.memberships.find((x) => x.id === mid); if (m) h.db.notifications.push({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind: "billing", title, body, link: "/payments", read_at: null, created_at: h.nowIso() }); };
  const pay = (c, method, ref) => { Object.assign(c, { status: "paid", paid_at: h.nowIso(), method, external_ref: ref ?? null, receipt_number: nextReceipt(c.club_id) }); };

  // ---- payout account (Stripe Connect onboarding, mocked)
  h.get("/v1/clubs/:club_id/finance/account", (ctx) => { ctx.owner(ctx.params.club_id); return account(ctx.params.club_id) || { club_id: ctx.params.club_id, stripe_account_id: null, status: "not_connected" }; });
  h.post("/v1/clubs/:club_id/finance/account/connect", (ctx) => {
    ctx.owner(ctx.params.club_id);
    let a = account(ctx.params.club_id);
    if (!a) { a = { club_id: ctx.params.club_id, stripe_account_id: "acct_mock_" + h.uuid("acct").slice(0, 8), status: "active", created_at: h.nowIso(), updated_at: h.nowIso() }; h.db.club_payout_accounts.push(a); }
    else Object.assign(a, { status: "active", updated_at: h.nowIso() });
    return a;
  });

  // ---- summary
  h.get("/v1/clubs/:club_id/finance/summary", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const period = periodOk(ctx.query.period) ? ctx.query.period : h.today().slice(0, 7);
    const cs = h.db.charges.filter((c) => c.club_id === ctx.params.club_id && c.status !== "void" && (c.period === period || (!c.period && c.due_date.startsWith(period))));
    const sum = (f) => cs.filter(f).reduce((s, c) => s + c.amount_cents, 0);
    const assigned = h.db.student_fees.filter((f) => f.club_id === ctx.params.club_id && h.db.memberships.some((m) => m.id === f.membership_id && m.status === "active")).length;
    const allOverdue = h.db.charges.filter((c) => c.club_id === ctx.params.club_id && state(c) === "overdue");
    return { period, expected_cents: sum(() => true), received_cents: sum((c) => c.status === "paid"), open_cents: sum((c) => state(c) === "open"), overdue_cents: sum((c) => state(c) === "overdue"), charges: cs.length, paid: cs.filter((c) => c.status === "paid").length, students_with_fee: assigned, overdue_total_cents: allOverdue.reduce((s, c) => s + c.amount_cents, 0), overdue_students: new Set(allOverdue.map((c) => c.membership_id)).size, account: account(ctx.params.club_id)?.status ?? "not_connected", generated: cs.some((c) => c.period === period) };
  });

  // ---- fee plans
  const validPlan = (b, partial) => {
    const e = [];
    if ((!partial || "name" in b) && !String(b.name || "").trim()) e.push({ field: "name", message: "Dê um nome ao plano." });
    if ((!partial || "amount_cents" in b) && !(Number.isInteger(b.amount_cents) && b.amount_cents >= 100)) e.push({ field: "amount_cents", message: "Informe um valor a partir de R$ 1,00." });
    if ("interval" in b && !(b.interval in INTERVAL_MONTHS)) e.push({ field: "interval", message: "Periodicidade inválida." });
    if (e.length) h.invalid(e);
  };
  h.get("/v1/clubs/:club_id/fee-plans", (ctx) => {
    ctx.owner(ctx.params.club_id);
    return { items: h.db.fee_plans.filter((f) => f.club_id === ctx.params.club_id && !f.archived_at).map((f) => ({ ...f, students: h.db.student_fees.filter((s) => s.fee_plan_id === f.id).length })), next_cursor: null };
  });
  h.post("/v1/clubs/:club_id/fee-plans", (ctx) => {
    ctx.owner(ctx.params.club_id); validPlan(ctx.body, false);
    const f = { id: h.uuid("fp"), club_id: ctx.params.club_id, name: ctx.body.name.trim(), description: ctx.body.description || null, amount_cents: ctx.body.amount_cents, interval: ctx.body.interval || "month", created_at: h.nowIso(), archived_at: null };
    h.db.fee_plans.push(f);
    return { __status: 201, data: { ...f, students: 0 } };
  });
  h.patch("/v1/clubs/:club_id/fee-plans/:id", (ctx) => {
    ctx.owner(ctx.params.club_id); validPlan(ctx.body, true);
    const f = h.db.fee_plans.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id) || h.fail(404, "fee_plan.not_found", "Plano não encontrado", "Ele pode ter sido arquivado.");
    for (const k of ["name", "description", "amount_cents", "interval"]) if (k in ctx.body) f[k] = ctx.body[k];
    return f; // new amounts apply to charges generated from now on
  });
  h.delete("/v1/clubs/:club_id/fee-plans/:id", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const f = h.db.fee_plans.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!f) h.fail(404, "fee_plan.not_found", "Plano não encontrado", "Ele pode já ter sido arquivado.");
    if (h.db.student_fees.some((s) => s.fee_plan_id === f.id)) h.fail(409, "fee_plan.in_use", "Há alunos neste plano", "Mude os alunos para outro plano antes de arquivar.");
    f.archived_at = h.nowIso();
  });

  // ---- student fees (assignment)
  h.get("/v1/clubs/:club_id/student-fees", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const students = h.db.memberships.filter((m) => m.club_id === ctx.params.club_id && m.role === "student" && m.status === "active");
    return { items: students.map((m) => { const f = h.db.student_fees.find((x) => x.membership_id === m.id) || null; const plan = f && h.db.fee_plans.find((p) => p.id === f.fee_plan_id); return { membership_id: m.id, user: userOfM(m.id), fee: f && { ...f, plan, effective_cents: f.amount_cents ?? plan?.amount_cents }, overdue_cents: h.db.charges.filter((c) => c.membership_id === m.id && state(c) === "overdue").reduce((s, c) => s + c.amount_cents, 0) }; }).sort((a, b) => a.user.name.localeCompare(b.user.name)), next_cursor: null };
  });
  h.put("/v1/clubs/:club_id/student-fees/:membership_id", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const m = h.db.memberships.find((x) => x.id === ctx.params.membership_id && x.club_id === ctx.params.club_id && x.role === "student") || h.fail(404, "member.not_found", "Aluno não encontrado", "Ele pode ter saído do clube.");
    const b = ctx.body, e = [];
    if (!h.db.fee_plans.some((p) => p.id === b.fee_plan_id && p.club_id === m.club_id && !p.archived_at)) e.push({ field: "fee_plan_id", message: "Escolha um plano." });
    if (b.amount_cents != null && !(Number.isInteger(b.amount_cents) && b.amount_cents >= 100)) e.push({ field: "amount_cents", message: "Valor inválido." });
    if (b.due_day != null && !(b.due_day >= 1 && b.due_day <= 28)) e.push({ field: "due_day", message: "Dia entre 1 e 28." });
    if (e.length) h.invalid(e);
    let f = h.db.student_fees.find((x) => x.membership_id === m.id);
    if (!f) { f = { membership_id: m.id, club_id: m.club_id, starts_on: h.today().slice(0, 7) + "-01", created_at: h.nowIso() }; h.db.student_fees.push(f); }
    Object.assign(f, { fee_plan_id: b.fee_plan_id, amount_cents: b.amount_cents ?? null, due_day: b.due_day ?? f.due_day ?? 10 });
    return f;
  });
  h.delete("/v1/clubs/:club_id/student-fees/:membership_id", (ctx) => { ctx.owner(ctx.params.club_id); h.db.student_fees = h.db.student_fees.filter((x) => !(x.membership_id === ctx.params.membership_id && x.club_id === ctx.params.club_id)); });

  // ---- charges
  h.get("/v1/clubs/:club_id/charges", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const { period, state: st, membership_id } = ctx.query;
    const items = h.db.charges.filter((c) => c.club_id === ctx.params.club_id && (!period || c.period === period || (!c.period && c.due_date.startsWith(period))) && (!membership_id || c.membership_id === membership_id) && (!st || state(c) === st))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || userOfM(a.membership_id).name.localeCompare(userOfM(b.membership_id).name));
    return { items: items.map(out), next_cursor: null };
  });
  /** Materialize a period's recurring charges for every assigned student (idempotent; quarterly/yearly plans only on their months). */
  h.post("/v1/clubs/:club_id/charges/generate", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const period = ctx.body.period;
    if (!periodOk(period)) h.invalid([{ field: "period", message: "Informe o mês (AAAA-MM)." }]);
    let created = 0;
    for (const f of h.db.student_fees.filter((x) => x.club_id === ctx.params.club_id)) {
      const m = h.db.memberships.find((x) => x.id === f.membership_id && x.status === "active");
      const plan = h.db.fee_plans.find((p) => p.id === f.fee_plan_id);
      if (!m || !plan || firstOf(period) < f.starts_on.slice(0, 7) + "-01") continue;
      const monthsSince = (+period.slice(0, 4) - +f.starts_on.slice(0, 4)) * 12 + (+period.slice(5, 7) - +f.starts_on.slice(5, 7));
      if (monthsSince % INTERVAL_MONTHS[plan.interval] !== 0) continue;
      if (h.db.charges.some((c) => c.membership_id === m.id && c.period === period)) continue;
      h.db.charges.push({ id: h.uuid("chg"), club_id: m.club_id, membership_id: m.id, fee_plan_id: plan.id, period, description: `${plan.name} · ${MONTHS[+period.slice(5, 7) - 1]}`, amount_cents: f.amount_cents ?? plan.amount_cents, due_date: h.addDays(firstOf(period), f.due_day - 1), status: "open", paid_at: null, method: null, external_ref: null, receipt_number: null, last_reminded_at: null, created_at: h.nowIso() });
      notify(m.id, m.club_id, `Mensalidade de ${MONTHS[+period.slice(5, 7) - 1]} disponível`, `${plan.name} · vence dia ${f.due_day}`);
      created++;
    }
    return { created };
  });
  h.post("/v1/clubs/:club_id/charges", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const b = ctx.body, e = [];
    const m = h.db.memberships.find((x) => x.id === b.membership_id && x.club_id === ctx.params.club_id && x.role === "student" && x.status === "active");
    if (!m) e.push({ field: "membership_id", message: "Escolha o aluno." });
    if (!String(b.description || "").trim()) e.push({ field: "description", message: "Descreva a cobrança." });
    if (!(Number.isInteger(b.amount_cents) && b.amount_cents >= 100)) e.push({ field: "amount_cents", message: "Informe um valor a partir de R$ 1,00." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "")) e.push({ field: "due_date", message: "Informe o vencimento." });
    if (e.length) h.invalid(e);
    const c = { id: h.uuid("chg"), club_id: m.club_id, membership_id: m.id, fee_plan_id: null, period: null, description: b.description.trim(), amount_cents: b.amount_cents, due_date: b.due_date, status: "open", paid_at: null, method: null, external_ref: null, receipt_number: null, last_reminded_at: null, created_at: h.nowIso() };
    h.db.charges.push(c);
    notify(m.id, m.club_id, "Nova cobrança do clube", `${c.description} · vence em ${c.due_date.split("-").reverse().join("/")}`);
    return { __status: 201, data: out(c) };
  });
  h.post("/v1/clubs/:club_id/charges/:id/mark-paid", (ctx) => {
    ctx.owner(ctx.params.club_id); const c = ownCharge(ctx);
    if (c.status !== "open") h.fail(409, "charge.not_open", "Esta cobrança não está em aberto", "Ela já foi paga ou cancelada.");
    if (!METHODS.includes(ctx.body.method)) h.invalid([{ field: "method", message: "Como foi pago?" }]);
    pay(c, ctx.body.method, null);
    return out(c);
  });
  h.post("/v1/clubs/:club_id/charges/:id/void", (ctx) => {
    ctx.owner(ctx.params.club_id); const c = ownCharge(ctx);
    if (c.status === "paid") h.fail(409, "charge.paid", "Cobrança já paga", "Faça o estorno pelo painel de pagamentos.");
    c.status = "void";
    return out(c);
  });
  h.post("/v1/clubs/:club_id/charges/:id/remind", (ctx) => {
    ctx.owner(ctx.params.club_id); const c = ownCharge(ctx);
    if (c.status !== "open") h.fail(409, "charge.not_open", "Esta cobrança não está em aberto", "Ela já foi paga ou cancelada.");
    if (c.last_reminded_at && Date.now() - Date.parse(c.last_reminded_at) < 24 * 3600000) h.fail(429, "charge.reminded_recently", "Lembrete já enviado hoje", "Espere 24 horas para lembrar de novo.");
    c.last_reminded_at = h.nowIso();
    notify(c.membership_id, c.club_id, state(c) === "overdue" ? "Mensalidade em atraso" : "Lembrete de pagamento", `${c.description} · ${(c.amount_cents / 100).toFixed(2).replace(".", ",")} reais`);
    return out(c);
  });

  // ---- student side
  h.get("/v1/clubs/:club_id/my/charges", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    return { items: h.db.charges.filter((c) => c.membership_id === me.id && c.status !== "void").sort((a, b) => b.due_date.localeCompare(a.due_date)).map(out), next_cursor: null, account: account(me.club_id)?.status === "active" };
  });
  h.post("/v1/clubs/:club_id/my/charges/:id/checkout", (ctx) => {
    const me = ctx.member(ctx.params.club_id, ["student"]);
    const c = h.db.charges.find((x) => x.id === ctx.params.id && x.membership_id === me.id) || h.fail(404, "charge.not_found", "Cobrança não encontrada", "Ela pode ter sido cancelada.");
    if (c.status !== "open") h.fail(409, "charge.not_open", "Nada a pagar", "Esta cobrança já foi paga ou cancelada.");
    if (account(me.club_id)?.status !== "active") h.fail(409, "finance.no_account", "Pagamento pelo app indisponível", "Combine o pagamento direto com o clube.");
    return { checkout_url: `/dev/pay/${c.id}?club=${me.club_id}` };
  });
  h.get("/v1/clubs/:club_id/charges/:id/receipt", (ctx) => {
    const me = ctx.member(ctx.params.club_id);
    const c = h.db.charges.find((x) => x.id === ctx.params.id && x.club_id === ctx.params.club_id);
    if (!c || (me.role === "student" && c.membership_id !== me.id) || (me.role === "trainer")) h.fail(404, "charge.not_found", "Recibo não encontrado", "Confira o link.");
    if (c.status !== "paid") h.fail(409, "charge.not_paid", "Ainda não há recibo", "O recibo fica disponível depois do pagamento.");
    const club = h.db.clubs.find((x) => x.id === c.club_id);
    return { charge: out(c), club: { id: club.id, name: club.name, city: club.city, state: club.state }, branding: h.branding(club.id) };
  });

  // ---- mock-only: Stripe/Pix webhook
  h.post("/v1/mock/payments/complete", (ctx) => {
    const u = ctx.user();
    const c = h.db.charges.find((x) => x.id === ctx.body.charge_id);
    const m = c && h.db.memberships.find((x) => x.id === c.membership_id);
    if (!c || m.user_id !== u.id) h.fail(404, "charge.not_found", "Cobrança não encontrada", "Ela pode ter sido cancelada.");
    if (c.status !== "open") h.fail(409, "charge.not_open", "Nada a pagar", "Esta cobrança já foi paga ou cancelada.");
    pay(c, ctx.body.method === "card" ? "card" : "pix", "pi_mock_" + h.uuid("pi").slice(0, 10));
    for (const o of h.db.memberships.filter((x) => x.club_id === c.club_id && x.role === "owner" && x.status === "active")) h.db.notifications.push({ id: h.uuid("n"), user_id: o.user_id, club_id: c.club_id, kind: "billing", title: `Pagamento recebido de ${u.name}`, body: c.description, link: "/club/finances", read_at: null, created_at: h.nowIso() });
    return out(c);
  });
}

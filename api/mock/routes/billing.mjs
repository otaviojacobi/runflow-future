/** Billing (Stripe, D-016) and plans by seats (D-043). The mock replaces Stripe Checkout / Billing Portal with in-app
 * pages under /dev/stripe/*; the plan catalog is api/plans.json (h.catalog). */
export default function register(h) {
  const sub = (clubId) => h.db.club_subscriptions.find((x) => x.club_id === clubId);
  const plusMonth = (iso) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString(); };
  const toFree = { plan: "free", status: "active", past_due_since: null, stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false };
  /** Lazily apply a scheduled cancellation once the period is over (Stripe would send customer.subscription.deleted). */
  const settle = (clubId) => {
    const s = sub(clubId);
    if (s && s.plan !== "free" && s.cancel_at_period_end && s.current_period_end && s.current_period_end <= h.nowIso()) Object.assign(s, toFree, { updated_at: h.nowIso() });
    return s;
  };
  const out = (clubId, role = "owner") => { settle(clubId); return { ...h.subscription(clubId, role), has_billing_account: !!sub(clubId)?.stripe_customer_id }; };
  const paidPlan = (plan) => {
    if (plan !== "pro" && plan !== "max") h.invalid([{ field: "plan", message: "Escolha um plano." }]);
    return h.plan(plan);
  };
  const toOwners = (clubId, title, body) => {
    for (const m of h.db.memberships.filter((x) => x.club_id === clubId && x.is_billing_owner)) h.notify({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind: "billing", title, body, link: "/club/billing", read_at: null, created_at: h.nowIso() });
  };
  /** What a plan holds, for the welcome notice (pt-BR). */
  const holds = (p) => (p.extra ? `${p.students} alunos e ${p.trainers} treinadores incluídos, e vagas extras cobradas por pessoa.` : `até ${p.students} alunos e ${p.trainers === 1 ? "1 treinador" : `${p.trainers} treinadores`}.`);

  h.get("/v1/clubs/:club_id/subscription", (ctx) => { const m = ctx.member(ctx.params.club_id); return out(ctx.params.club_id, m.role); });

  h.post("/v1/clubs/:club_id/subscription/checkout", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const p = paidPlan(ctx.body.plan);
    const s = settle(ctx.params.club_id);
    if (s.plan !== "free" && s.status !== "canceled") h.fail(409, "subscription.exists", `Você já está no ${h.plan(s.plan).name}`, "Para trocar de plano, use “Mudar plano”; para o pagamento, “Gerenciar assinatura”.");
    const session = "cs_mock_" + h.uuid("cs").slice(0, 8);
    return { checkout_url: `/dev/stripe/checkout?club=${ctx.params.club_id}&plan=${p.id}&session=${session}` };
  });

  /** Pro ⇄ Max on a paid plan; never into a plan the club doesn't fit. */
  h.post("/v1/clubs/:club_id/subscription/change", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const p = paidPlan(ctx.body.plan);
    const s = settle(ctx.params.club_id);
    if (s.plan === "free" || !s.stripe_subscription_id) h.fail(409, "billing.no_subscription", "Nenhuma assinatura ativa", "Assine um plano primeiro.");
    if (s.plan === p.id) return out(ctx.params.club_id);
    const students = h.activeStudents(s.club_id), trainers = h.activeTrainers(s.club_id);
    if (!p.extra && (students > p.students || trainers > p.trainers)) {
      h.fail(409, "plan.too_small", `O clube não cabe no ${p.name}`, `O ${p.name} inclui até ${p.students} alunos e ${p.trainers === 1 ? "1 treinador" : `${p.trainers} treinadores`}; hoje o clube tem ${students} alunos e ${trainers === 1 ? "1 treinador" : `${trainers} treinadores`}.`);
    }
    Object.assign(s, { plan: p.id, updated_at: h.nowIso() });
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: s.club_id, actor_user_id: ctx.user().id, action: "subscription.changed", target_type: "club", target_id: s.club_id, data: { plan: p.id }, created_at: h.nowIso() });
    return out(ctx.params.club_id);
  });

  h.post("/v1/clubs/:club_id/subscription/portal", (ctx) => {
    ctx.owner(ctx.params.club_id);
    if (!sub(ctx.params.club_id)?.stripe_customer_id) h.fail(409, "billing.no_account", "Nenhuma assinatura ainda", "Assine um plano para gerenciar pagamentos.");
    return { portal_url: `/dev/stripe/portal?club=${ctx.params.club_id}` };
  });

  h.get("/v1/clubs/:club_id/invoices", (ctx) => {
    ctx.owner(ctx.params.club_id);
    return { items: h.db.invoices.filter((i) => i.club_id === ctx.params.club_id).sort((a, b) => b.created_at.localeCompare(a.created_at)), next_cursor: null };
  });

  // ---- billing simulation: what Stripe's webhooks would do
  h.post("/v1/mock/stripe/complete", (ctx) => {
    const clubId = ctx.body.club_id;
    ctx.owner(clubId);
    const p = paidPlan(ctx.body.plan ?? "pro");
    const s = sub(clubId);
    const now = h.nowIso();
    const end = plusMonth(now);
    const was = s.plan;
    Object.assign(s, { plan: p.id, status: "active", past_due_since: null, stripe_customer_id: s.stripe_customer_id || "cus_mock_" + clubId.slice(0, 8), stripe_subscription_id: "sub_mock_" + h.uuid("sub").slice(0, 8), current_period_end: end, cancel_at_period_end: false, updated_at: now });
    h.db.invoices.push({ id: h.uuid("inv"), club_id: clubId, stripe_invoice_id: "in_mock_" + h.uuid("in").slice(0, 8), amount_cents: h.subscription(clubId).monthly_cents, currency: "BRL", status: "paid", period_start: now, period_end: end, hosted_url: null, created_at: now });
    if (was !== p.id) toOwners(clubId, `Bem-vindo ao ${p.name}!`, `Agora o clube tem ${holds(p)}`);
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: clubId, actor_user_id: ctx.user().id, action: "subscription.upgraded", target_type: "club", target_id: clubId, data: { plan: p.id }, created_at: now });
    return out(clubId);
  });
  h.post("/v1/mock/stripe/portal", (ctx) => {
    const clubId = ctx.body.club_id;
    ctx.owner(clubId);
    const s = sub(clubId);
    if (!s.stripe_subscription_id) h.fail(409, "billing.no_subscription", "Nenhuma assinatura ativa", "Assine um plano primeiro.");
    const action = ctx.body.action;
    const now = h.nowIso();
    if (action === "cancel") s.cancel_at_period_end = true;
    else if (action === "resume") s.cancel_at_period_end = false;
    else if (action === "fail_payment" || action === "freeze") {
      if (s.status !== "past_due") toOwners(clubId, "Não conseguimos cobrar a assinatura", `Atualize o cartão em Plano e cobrança em até ${h.catalog.grace_days} dias para o clube não ser congelado.`);
      s.status = "past_due";
      // freeze: as if the grace period had already run out.
      s.past_due_since = action === "freeze" ? new Date(Date.now() - (h.catalog.grace_days + 1) * 86400000).toISOString() : s.past_due_since || now;
    }
    else if (action === "pay") Object.assign(s, { status: "active", past_due_since: null });
    else if (action === "expire") { s.current_period_end = h.addDays(h.today(), -1) + "T03:00:00.000Z"; s.cancel_at_period_end = true; }
    else h.invalid([{ field: "action", message: "Ação inválida." }]);
    s.updated_at = now;
    return out(clubId);
  });
}

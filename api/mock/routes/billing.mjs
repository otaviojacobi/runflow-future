/** Billing (Stripe). The mock replaces Stripe Checkout / Billing Portal with in-app pages under /dev/stripe/*. */
export const PLANS = {
  free: { student_limit: 10, amount_cents: 0 },
  pro: { student_limit: 100, amount_cents: 2000 },
};

export default function register(h) {
  const sub = (clubId) => h.db.club_subscriptions.find((x) => x.club_id === clubId);
  const plusMonth = (iso) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString(); };
  /** Lazily apply a scheduled cancellation once the period is over (Stripe would send customer.subscription.deleted). */
  const settle = (clubId) => {
    const s = sub(clubId);
    if (s && s.plan !== "free" && s.cancel_at_period_end && s.current_period_end && s.current_period_end <= h.nowIso()) {
      Object.assign(s, { plan: "free", status: "active", student_limit: PLANS.free.student_limit, stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false, updated_at: h.nowIso() });
    }
    return s;
  };
  const out = (clubId) => { settle(clubId); return { ...h.subscription(clubId), has_billing_account: !!sub(clubId)?.stripe_customer_id }; };

  h.get("/v1/clubs/:club_id/subscription", (ctx) => { ctx.member(ctx.params.club_id); return out(ctx.params.club_id); });

  h.post("/v1/clubs/:club_id/subscription/checkout", (ctx) => {
    ctx.owner(ctx.params.club_id);
    const plan = ctx.body.plan;
    if (plan === "max") h.fail(409, "plan.unavailable", "O Max ainda não está à venda", "Fale com a gente se precisar de mais de 100 alunos.");
    if (plan !== "pro") h.invalid([{ field: "plan", message: "Escolha um plano." }]);
    const s = settle(ctx.params.club_id);
    if (s.plan === "pro" && s.status !== "canceled") h.fail(409, "subscription.exists", "Você já está no Pro", "Use “Gerenciar assinatura” para mudar o pagamento ou cancelar.");
    const session = "cs_mock_" + h.uuid("cs").slice(0, 8);
    return { checkout_url: `/dev/stripe/checkout?club=${ctx.params.club_id}&plan=${plan}&session=${session}` };
  });

  h.post("/v1/clubs/:club_id/subscription/portal", (ctx) => {
    ctx.owner(ctx.params.club_id);
    if (!sub(ctx.params.club_id)?.stripe_customer_id) h.fail(409, "billing.no_account", "Nenhuma assinatura ainda", "Assine o Pro para gerenciar pagamentos.");
    return { portal_url: `/dev/stripe/portal?club=${ctx.params.club_id}` };
  });

  h.get("/v1/clubs/:club_id/invoices", (ctx) => {
    ctx.owner(ctx.params.club_id);
    return { items: h.db.invoices.filter((i) => i.club_id === ctx.params.club_id).sort((a, b) => b.created_at.localeCompare(a.created_at)), next_cursor: null };
  });

  // ---- mock-only: what Stripe's webhooks would do
  h.post("/v1/mock/stripe/complete", (ctx) => {
    const clubId = ctx.body.club_id;
    ctx.owner(clubId);
    const s = sub(clubId);
    const now = h.nowIso();
    const end = plusMonth(now);
    Object.assign(s, { plan: "pro", status: "active", student_limit: PLANS.pro.student_limit, stripe_customer_id: s.stripe_customer_id || "cus_mock_" + clubId.slice(0, 8), stripe_subscription_id: "sub_mock_" + h.uuid("sub").slice(0, 8), current_period_end: end, cancel_at_period_end: false, updated_at: now });
    h.db.invoices.push({ id: h.uuid("inv"), club_id: clubId, stripe_invoice_id: "in_mock_" + h.uuid("in").slice(0, 8), amount_cents: PLANS.pro.amount_cents, currency: "BRL", status: "paid", period_start: now, period_end: end, hosted_url: null, created_at: now });
    for (const m of h.db.memberships.filter((x) => x.club_id === clubId && x.is_billing_owner)) h.notify({ id: h.uuid("n"), user_id: m.user_id, club_id: clubId, kind: "billing", title: "Bem-vindo ao Pro!", body: "Agora o clube comporta até 100 alunos e pode ter endereço próprio.", link: "/club/billing", read_at: null, created_at: now });
    h.db.audit_log.push({ id: h.db.audit_log.length + 1, club_id: clubId, actor_user_id: ctx.user().id, action: "subscription.upgraded", target_type: "club", target_id: clubId, data: { plan: "pro" }, created_at: now });
    return out(clubId);
  });
  h.post("/v1/mock/stripe/portal", (ctx) => {
    const clubId = ctx.body.club_id;
    ctx.owner(clubId);
    const s = sub(clubId);
    if (!s.stripe_subscription_id) h.fail(409, "billing.no_subscription", "Nenhuma assinatura ativa", "Assine o Pro primeiro.");
    const action = ctx.body.action;
    if (action === "cancel") s.cancel_at_period_end = true;
    else if (action === "resume") s.cancel_at_period_end = false;
    else if (action === "fail_payment") s.status = "past_due";
    else if (action === "pay") { s.status = "active"; }
    else if (action === "expire") { s.current_period_end = h.addDays(h.today(), -1) + "T03:00:00.000Z"; s.cancel_at_period_end = true; }
    else h.invalid([{ field: "action", message: "Ação inválida." }]);
    s.updated_at = h.nowIso();
    return out(clubId);
  });
}

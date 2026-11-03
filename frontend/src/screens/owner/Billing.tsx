/** O4 · Plano e cobrança: current plan, seats in use, plans (D-043), subscribe (Stripe Checkout), change Pro ⇄ Max,
 * manage (portal), invoices, and the way out of a frozen club. Route: /club/billing */
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRightLeft, Building2, Check, CreditCard, ExternalLink, Receipt, Snowflake, Sparkles, UserCog, Users } from "lucide-react";
import { useEffect } from "react";
import { useChangePlan, useCheckout, useInvoices, usePlans, usePortal, useSubscription } from "@/api/billing";
import type { Invoice, PaidPlan, PlanSpec, Subscription } from "@/api/types";
import { extraText, featuresOf, fits, price, seatsText } from "@/components/billing/plans";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { fullDate, localDate, money } from "@/lib/format";
import { Badge, Button, Card, PageHeader, ProgressBar, Skeleton, cn, toast, type Tone } from "@/ui";

const STATUS: Record<Subscription["status"], { label: string; tone: Tone }> = {
  active: { label: "Ativo", tone: "success" }, trialing: { label: "Em teste", tone: "info" }, past_due: { label: "Pagamento pendente", tone: "danger" }, canceled: { label: "Cancelado", tone: "neutral" },
};
const INVOICE: Record<Invoice["status"], { label: string; tone: Tone }> = {
  paid: { label: "Paga", tone: "success" }, open: { label: "Em aberto", tone: "warning" }, draft: { label: "Rascunho", tone: "neutral" }, void: { label: "Anulada", tone: "neutral" }, uncollectible: { label: "Não paga", tone: "danger" },
};
const day = (iso: string) => fullDate(localDate(iso));

export function BillingScreen() {
  const { club } = useClub();
  const sub = useSubscription(club?.id);
  const plans = usePlans();
  const invoices = useInvoices(club?.id);
  const checkout = useCheckout(club?.id ?? "");
  const change = useChangePlan(club?.id ?? "");
  const portal = usePortal(club?.id ?? "");
  const navigate = useNavigate();

  useEffect(() => {
    const r = new URLSearchParams(location.search).get("checkout");
    if (!r) return;
    if (r === "success") toast.success(t("Assinatura confirmada"), t("O novo plano já está valendo para o clube."));
    else toast.info(t("Assinatura não concluída"), t("Nada foi cobrado. Você pode tentar de novo quando quiser."));
    navigate({ to: "/club/billing", replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!club) return null;
  const s = sub.data;
  const catalog = plans.data;
  // Stripe Checkout / Portal are external pages in production (in-app /dev/stripe/* in the mock).
  const go = (url: string) => location.assign(url);
  const subscribe = (plan: PaidPlan) => checkout.mutate(plan, { onSuccess: (r) => go(r.checkout_url), onError: toast.error });
  const switchTo = (p: PlanSpec) => change.mutate(p.id as PaidPlan, { onSuccess: () => toast.success(t("Plano alterado para o {plan}", { plan: p.name }), t("A diferença é ajustada na próxima fatura.")), onError: toast.error });
  const manage = () => portal.mutate(undefined, { onSuccess: (r) => go(r.portal_url), onError: toast.error });
  const busy = checkout.isPending || change.isPending || portal.isPending;
  const current = catalog?.plans.find((p) => p.id === s?.plan);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Plano e cobrança")} subtitle={t("Cada plano inclui vagas para treinadores e alunos ativos. Membros suspensos não contam.")} />
      {!s || !catalog || !current ? <Skeleton className="h-48" /> : (
        <>
          <Notice s={s} plan={current} onManage={manage} busy={portal.isPending} />
          <CurrentPlan s={s} plan={current} onManage={manage} busy={busy} />
          <section className="grid gap-3" aria-labelledby="plans-h">
            <h2 id="plans-h" className="rf-text-title-md">{t("Planos")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {catalog.plans.map((p) => <PlanCard key={p.id} p={p} s={s} busy={busy} onSubscribe={subscribe} onChange={switchTo} />)}
              <Card className="grid content-start gap-3 p-5">
                <h3 className="font-display text-xl font-bold">{t("Enterprise")}</h3>
                <div className="font-display text-3xl font-bold">{t("Licença anual")}</div>
                <div className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" />{t("Sem limite de vagas")}</div>
                <ul className="grid gap-1.5 text-sm text-fg-muted">{[t("Roda no servidor da sua empresa"), t("Mesmo app, seus dados")].map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" />{f}</li>)}</ul>
                <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-fg-muted"><Building2 className="size-4" />{t("Fale com o time Runflow")}</span>
              </Card>
            </div>
          </section>
          <Invoices items={invoices.data} />
        </>
      )}
    </div>
  );
}

/** A failed payment (grace period) or a frozen club: what happened and the one way out. */
function Notice({ s, plan, onManage, busy }: { s: Subscription; plan: PlanSpec; onManage: () => void; busy: boolean }) {
  if (s.frozen) {
    const unpaid = s.status === "past_due";
    return (
      <Card tone="info" className="flex flex-wrap items-center gap-3 p-4" role="alert">
        <Snowflake className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong className="block">{t("Clube congelado")}</strong>
          {unpaid
            ? t("O pagamento do {plan} está pendente. A equipe só consegue ver o clube até regularizar; os alunos continuam usando normalmente.", { plan: plan.name })
            : t("O clube tem mais membros do que o plano {plan} permite. Assine um plano maior para voltar a usar o clube; os alunos continuam usando normalmente.", { plan: plan.name })}
        </span>
        {unpaid && <Button icon={<CreditCard />} loading={busy} onClick={onManage}>{t("Atualizar cartão")}</Button>}
      </Card>
    );
  }
  if (s.status !== "past_due") return null;
  return (
    <Card tone="danger" className="flex flex-wrap items-center gap-3 p-4">
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{s.grace_until
        ? t("O último pagamento não foi aprovado. Atualize o cartão até {d} para o clube não ser congelado.", { d: day(s.grace_until) })
        : t("O último pagamento não foi aprovado. Atualize o cartão para manter o plano.")}</span>
      <Button variant="danger" icon={<CreditCard />} loading={busy} onClick={onManage}>{t("Atualizar cartão")}</Button>
    </Card>
  );
}

function CurrentPlan({ s, plan, onManage, busy }: { s: Subscription; plan: PlanSpec; onManage: () => void; busy: boolean }) {
  const st = STATUS[s.status];
  return (
    <Card className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:p-6">
      <div className="grid content-start gap-2">
        <div className="text-sm text-fg-muted">{t("Seu plano")}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="font-display text-4xl font-bold [font-stretch:110%]">{plan.name}</span><Badge tone={st.tone}>{t(st.label)}</Badge>{s.frozen && <Badge tone="info">{t("Congelado")}</Badge>}</div>
        <div className="text-fg-muted">{s.plan === "free" ? t("Grátis para sempre") : t("{price} por mês", { price: money(s.monthly_cents) })}</div>
        {s.plan !== "free" && s.current_period_end && (
          s.cancel_at_period_end
            ? <p className="text-sm text-warning-text">{t("Cancelado: o {plan} vale até {d}. Depois o clube volta para o Free; ninguém é removido.", { plan: plan.name, d: day(s.current_period_end) })}</p>
            : <p className="text-sm text-fg-muted">{t("Renova em {d}", { d: day(s.current_period_end) })}</p>
        )}
        {s.plan !== "free" && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" icon={<CreditCard />} loading={busy} onClick={onManage}>{s.cancel_at_period_end ? t("Retomar assinatura") : t("Gerenciar assinatura")}</Button>
          </div>
        )}
      </div>
      <div className="grid content-start gap-4 rounded-lg bg-sunken p-4">
        <Seats label={t("Alunos ativos")} icon={<Users className="size-4" aria-hidden />} used={s.active_students} limit={s.student_limit} included={s.included_students} each={plan.extra?.student_cents} one="Ainda cabe {n} aluno neste plano." other="Ainda cabem {n} alunos neste plano." />
        <Seats label={t("Treinadores")} icon={<UserCog className="size-4" aria-hidden />} used={s.active_trainers} limit={s.trainer_limit} included={s.included_trainers} each={plan.extra?.trainer_cents} one="Ainda cabe {n} treinador neste plano." other="Ainda cabem {n} treinadores neste plano." />
        <p className="text-xs text-fg-muted">{t("O responsável pelo clube não conta. Membros suspensos liberam a vaga.")}</p>
      </div>
    </Card>
  );
}

/** One seat meter: a hard limit (Free, Pro) or included seats with paid extras (Max). */
function Seats({ label, icon, used, limit, included, each, one, other }: { label: string; icon: React.ReactNode; used: number; limit: number | null; included: number; each?: number; one: string; other: string }) {
  const cap = limit ?? included;
  const pct = used / Math.max(1, cap);
  const extra = Math.max(0, used - included);
  const tone: Tone = limit === null ? "brand" : pct >= 1 ? "danger" : pct >= 0.8 ? "warning" : "brand";
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2"><span className="flex items-center gap-2 font-semibold">{icon}{label}</span><span className="font-display text-2xl font-bold tabular-nums">{used}<span className="text-base text-fg-muted">/{cap}</span></span></div>
      <ProgressBar value={Math.min(used, cap)} max={cap} tone={tone} label={label} />
      <p className={cn("text-sm", limit !== null && pct >= 1 ? "text-danger-text" : "text-fg-muted")}>
        {limit === null
          ? extra > 0 && each !== undefined ? t("{n} além das incluídas: {price} por mês", { n: extra, price: money(extra * each) }) : t("{n} incluídas no plano; as próximas são cobradas por pessoa.", { n: included })
          : pct >= 1 ? t("Limite atingido. Ninguém novo entra até liberar uma vaga ou mudar de plano; quem já está continua normalmente.")
          : tn(limit - used, one, other)}
      </p>
    </div>
  );
}

function PlanCard({ p, s, busy, onSubscribe, onChange }: { p: PlanSpec; s: Subscription; busy: boolean; onSubscribe: (plan: PaidPlan) => void; onChange: (p: PlanSpec) => void }) {
  const current = p.id === s.plan;
  const paid = s.plan !== "free" && s.status !== "canceled";
  const fit = fits(p, s);
  const extra = extraText(p);
  return (
    <Card edge={p.id === "pro" ? "brand" : undefined} className={cn("relative grid content-start gap-3 p-5", current && "ring-2 ring-brand-ring")}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-display text-xl font-bold">{p.name}</h3>{current && <Badge tone="brand">{t("Seu plano")}</Badge>}</div>
      <div><span className="font-display text-3xl font-bold tabular-nums">{price(p.price_cents)}</span>{p.price_cents > 0 && <span className="text-fg-muted">{t("/mês")}</span>}</div>
      <div className="flex items-start gap-2 text-sm font-semibold"><Users className="mt-0.5 size-4 shrink-0" />{seatsText(p)}</div>
      {extra && <p className="text-sm text-fg-muted">{extra}</p>}
      <ul className="grid gap-1.5 text-sm text-fg-muted">{featuresOf(p.id).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" />{f}</li>)}</ul>
      {!current && p.id !== "free" && (paid
        ? <Button variant="secondary" icon={<ArrowRightLeft />} loading={busy} disabled={!fit} onClick={() => onChange(p)} className="mt-1">{t("Mudar para o {plan}", { plan: p.name })}</Button>
        : <Button icon={<Sparkles />} loading={busy} disabled={!fit} onClick={() => onSubscribe(p.id as PaidPlan)} className="mt-1">{t("Assinar {plan}", { plan: p.name })}</Button>)}
      {!current && !fit && <p className="text-xs text-fg-muted">{t("O clube tem mais membros do que este plano comporta.")}</p>}
    </Card>
  );
}

function Invoices({ items }: { items?: Invoice[] }) {
  return (
    <section className="grid gap-3" aria-labelledby="inv-h">
      <h2 id="inv-h" className="rf-text-title-md">{t("Faturas")}</h2>
      <Card className="relative min-w-0 overflow-x-auto">
        {!items ? <Skeleton className="m-4 h-20" /> : items.length === 0 ? (
          <p className="flex items-center gap-2 p-5 text-fg-muted"><Receipt className="size-5" />{t("Nenhuma fatura ainda. No plano Free nada é cobrado.")}</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><th className="px-4 py-2.5 font-semibold">{t("Data")}</th><th className="px-4 py-2.5 font-semibold">{t("Período")}</th><th className="px-4 py-2.5 text-right font-semibold">{t("Valor")}</th><th className="px-4 py-2.5 font-semibold">{t("Situação")}</th><th className="px-4 py-2.5"><span className="sr-only">{t("Recibo")}</span></th></tr></thead>
            <tbody className="divide-y divide-line-subtle">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 tabular-nums">{day(i.created_at)}</td>
                  <td className="px-4 py-3 text-fg-muted tabular-nums">{day(i.period_start)} – {day(i.period_end)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(i.amount_cents, i.currency)}</td>
                  <td className="px-4 py-3"><Badge tone={INVOICE[i.status].tone}>{t(INVOICE[i.status].label)}</Badge></td>
                  <td className="px-4 py-3 text-right">{i.hosted_url ? <a href={i.hosted_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-text hover:underline">{t("Recibo")}<ExternalLink className="size-3.5" /></a> : <span className="text-fg-subtle">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}

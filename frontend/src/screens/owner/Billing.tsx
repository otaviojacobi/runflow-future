/** O4 · Plano e cobrança: current plan, usage, plans, upgrade (Stripe Checkout), manage (portal), invoices. Route: /club/billing */
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Building2, Check, CreditCard, ExternalLink, Receipt, Sparkles, Users } from "lucide-react";
import { useEffect } from "react";
import { useCheckout, useInvoices, usePortal, useSubscription } from "@/api/billing";
import type { Invoice, Plan, Subscription } from "@/api/types";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { fullDate, localDate, money } from "@/lib/format";
import { Badge, Button, Card, PageHeader, ProgressBar, Skeleton, cn, toast, type Tone } from "@/ui";

interface PlanInfo { id: Plan | "enterprise"; name: string; price: string; per?: string; students: string; features: string[]; soon?: boolean }
const PLANS: PlanInfo[] = [
  { id: "free", name: "Free", price: "R$ 0", students: "Até 10 alunos", features: ["Todos os recursos", "Club Studio com logo e cores", "Treinadores ilimitados"] },
  { id: "pro", name: "Pro", price: "R$ 20", per: "/mês", students: "Até 100 alunos", features: ["Todos os recursos do plano Free", "Suporte prioritário", "Cancele quando quiser"] },
  { id: "max", name: "Max", price: "A definir", students: "Mais de 100 alunos", features: ["Para assessorias e academias grandes", "Valor fixo + um pequeno valor por aluno"], soon: true },
  { id: "enterprise", name: "Enterprise", price: "Licença anual", students: "Sem limite", features: ["Roda no servidor da sua empresa", "Mesmo app, seus dados"] },
];
const STATUS: Record<Subscription["status"], { label: string; tone: Tone }> = {
  active: { label: "Ativo", tone: "success" }, trialing: { label: "Em teste", tone: "info" }, past_due: { label: "Pagamento pendente", tone: "danger" }, canceled: { label: "Cancelado", tone: "neutral" },
};
const INVOICE: Record<Invoice["status"], { label: string; tone: Tone }> = {
  paid: { label: "Paga", tone: "success" }, open: { label: "Em aberto", tone: "warning" }, draft: { label: "Rascunho", tone: "neutral" }, void: { label: "Anulada", tone: "neutral" }, uncollectible: { label: "Não paga", tone: "danger" },
};
const planName = (p: Plan) => PLANS.find((x) => x.id === p)?.name ?? p;
const day = (iso: string) => fullDate(localDate(iso));

export function BillingScreen() {
  const { club } = useClub();
  const sub = useSubscription(club?.id);
  const invoices = useInvoices(club?.id);
  const checkout = useCheckout(club?.id ?? "");
  const portal = usePortal(club?.id ?? "");
  const navigate = useNavigate();

  useEffect(() => {
    const r = new URLSearchParams(location.search).get("checkout");
    if (!r) return;
    if (r === "success") toast.success(t("Bem-vindo ao Pro!"), t("O clube agora comporta até 100 alunos."));
    else toast.info(t("Assinatura não concluída"), t("Nada foi cobrado. Você pode tentar de novo quando quiser."));
    navigate({ to: "/club/billing", replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!club) return null;
  const s = sub.data;
  // Stripe Checkout / Portal are external pages in production (in-app /dev/stripe/* in the mock).
  const go = (url: string) => location.assign(url);
  const upgrade = () => checkout.mutate("pro", { onSuccess: (r) => go(r.checkout_url), onError: toast.error });
  const manage = () => portal.mutate(undefined, { onSuccess: (r) => go(r.portal_url), onError: toast.error });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Plano e cobrança")} subtitle={t("Só alunos ativos contam. Gestores e treinadores são ilimitados e gratuitos.")} />
      {!s ? <Skeleton className="h-48" /> : (
        <>
          {s.status === "past_due" && (
            <Card tone="danger" className="flex flex-wrap items-center gap-3 p-4">
              <AlertTriangle className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">{t("O último pagamento não foi aprovado. Atualize o cartão para manter o Pro; tentaremos cobrar de novo nos próximos dias.")}</span>
              <Button variant="danger" icon={<CreditCard />} loading={portal.isPending} onClick={manage}>{t("Atualizar cartão")}</Button>
            </Card>
          )}
          <CurrentPlan s={s} onUpgrade={upgrade} onManage={manage} busy={checkout.isPending || portal.isPending} />
          <section className="grid gap-3" aria-labelledby="plans-h">
            <h2 id="plans-h" className="rf-text-title-md">{t("Planos")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PLANS.map((p) => {
                const current = p.id === s.plan;
                return (
                  <Card key={p.id} edge={p.id === "pro" ? "brand" : undefined} className={cn("relative grid content-start gap-3 p-5", current && "ring-2 ring-brand-ring")}>
                    <div className="flex items-center justify-between gap-2"><h3 className="font-display text-xl font-bold">{p.name}</h3>{current ? <Badge tone="brand">{t("Seu plano")}</Badge> : p.soon ? <Badge>{t("Em breve")}</Badge> : null}</div>
                    <div><span className="font-display text-3xl font-bold tabular-nums">{t(p.price)}</span>{p.per && <span className="text-fg-muted">{t(p.per)}</span>}</div>
                    <div className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" />{t(p.students)}</div>
                    <ul className="grid gap-1.5 text-sm text-fg-muted">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" />{t(f)}</li>)}</ul>
                    {p.id === "pro" && s.plan === "free" && <Button icon={<Sparkles />} loading={checkout.isPending} onClick={upgrade} className="mt-1">{t("Assinar Pro")}</Button>}
                    {p.id === "enterprise" && <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-fg-muted"><Building2 className="size-4" />{t("Fale com o time Runflow")}</span>}
                  </Card>
                );
              })}
            </div>
          </section>
          <Invoices items={invoices.data} />
        </>
      )}
    </div>
  );
}

function CurrentPlan({ s, onUpgrade, onManage, busy }: { s: Subscription; onUpgrade: () => void; onManage: () => void; busy: boolean }) {
  const pct = s.active_students / Math.max(1, s.student_limit);
  const tone: Tone = pct >= 1 ? "danger" : pct >= 0.8 ? "warning" : "brand";
  const st = STATUS[s.status];
  return (
    <Card className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:p-6">
      <div className="grid content-start gap-2">
        <div className="text-sm text-fg-muted">{t("Seu plano")}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="font-display text-4xl font-bold [font-stretch:110%]">{planName(s.plan)}</span><Badge tone={st.tone}>{t(st.label)}</Badge></div>
        <div className="text-fg-muted">{s.plan === "pro" ? t("R$ 20 por mês") : t("Grátis para sempre")}</div>
        {s.plan !== "free" && s.current_period_end && (
          s.cancel_at_period_end
            ? <p className="text-sm text-warning-text">{t("Cancelado: o Pro vale até {d}. Depois o clube volta para o Free; ninguém é removido.", { d: day(s.current_period_end) })}</p>
            : <p className="text-sm text-fg-muted">{t("Renova em {d}", { d: day(s.current_period_end) })}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {s.plan === "free" ? <Button icon={<Sparkles />} loading={busy} onClick={onUpgrade}>{t("Assinar Pro · R$ 20/mês")}</Button> : <Button variant="secondary" icon={<CreditCard />} loading={busy} onClick={onManage}>{s.cancel_at_period_end ? t("Retomar assinatura") : t("Gerenciar assinatura")}</Button>}
        </div>
      </div>
      <div className="grid content-start gap-3 rounded-lg bg-sunken p-4">
        <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{t("Alunos ativos")}</span><span className="font-display text-2xl font-bold tabular-nums">{s.active_students}<span className="text-base text-fg-muted">/{s.student_limit}</span></span></div>
        <ProgressBar value={Math.min(s.active_students, s.student_limit)} max={s.student_limit} tone={tone} label={t("Alunos ativos")} />
        <p className={cn("text-sm", pct >= 1 ? "text-danger-text" : "text-fg-muted")}>
          {pct >= 1 ? t("Limite atingido. Novos alunos não conseguem entrar pelo convite; quem já está continua normalmente.")
            : tn(s.student_limit - s.active_students, "Ainda cabe {n} aluno neste plano.", "Ainda cabem {n} alunos neste plano.")}
        </p>
        <p className="text-xs text-fg-muted">{t("Alunos suspensos não contam. Gestores e treinadores nunca contam.")}</p>
      </div>
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

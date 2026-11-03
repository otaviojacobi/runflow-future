/** O5 · Simulated Stripe Checkout and Billing Portal (mock only). Routes: /dev/stripe/checkout, /dev/stripe/portal */
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CreditCard, FlaskConical, Lock, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { useInvoices, useMockCompleteCheckout, useMockPortalAction, usePlans, useSubscription } from "@/api/billing";
import type { PaidPlan } from "@/api/types";
import { extraText, seatsText } from "@/components/billing/plans";
import { useMe } from "@/api/me";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { fullDate, localDate, money } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Skeleton, toast } from "@/ui";

const q = () => new URLSearchParams(location.search);

function TestBanner() {
  return <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-sm font-semibold text-on-warning-soft"><FlaskConical className="size-4 shrink-0" />{t("Ambiente de testes: esta tela simula o pagamento. Nenhum valor é cobrado.")}</div>;
}

export function StripeMockScreen() {
  const { kind } = useParams({ strict: false }) as { kind?: string };
  const me = useMe();
  const clubId = q().get("club") ?? "";
  const club = me.data?.memberships.find((m) => m.club.id === clubId);
  if (me.isPending) return <Skeleton className="m-8 h-64" />;
  if (!club || club.membership.role !== "owner") return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6 text-center"><div className="grid gap-3"><p className="rf-text-title-lg">{t("Sessão de pagamento inválida")}</p><Link to="/clubs" className="font-semibold text-brand-text">{t("Voltar ao Runflow")}</Link></div></div>
  );
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <TestBanner />
      {kind === "portal" ? <Portal clubId={clubId} clubName={club.club.name} /> : <Checkout clubId={clubId} clubName={club.club.name} email={me.data?.user.email ?? ""} />}
    </div>
  );
}

function Checkout({ clubId, clubName, email }: { clubId: string; clubName: string; email: string }) {
  const complete = useMockCompleteCheckout(clubId);
  const plans = usePlans();
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [name, setName] = useState("");
  const planId: PaidPlan = q().get("plan") === "max" ? "max" : "pro";
  const p = plans.data?.plans.find((x) => x.id === planId);
  // Stripe redirects back with a full page load (success_url / cancel_url).
  const back = () => location.assign("/club/billing?checkout=cancelled");
  if (!p) return <Skeleton className="m-8 h-64" />;
  const extra = extraText(p);
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-10 lg:grid-cols-2 lg:py-16">
      <section className="grid content-start gap-6">
        <button type="button" onClick={back} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("Voltar ao Runflow")}</button>
        <RunflowWordmark />
        <div><p className="text-fg-muted">{t("Assinar Runflow {plan}", { plan: p.name })}</p><p className="font-display text-4xl font-bold tabular-nums">{money(p.price_cents)} <span className="text-base font-normal text-fg-muted">{t("por mês")}</span></p></div>
        <dl className="grid gap-3 border-t border-line pt-4 text-sm">
          <div className="flex justify-between gap-4"><dt>{t("Runflow {plan} · {club}", { plan: p.name, club: clubName })}<div className="text-xs text-fg-muted">{seatsText(p)}{extra ? ` · ${extra}` : ""}</div></dt><dd className="tabular-nums">{money(p.price_cents)}</dd></div>
          <div className="flex justify-between gap-4 border-t border-line pt-3 font-semibold"><dt>{t("Total hoje")}</dt><dd className="tabular-nums">{money(p.price_cents)}</dd></div>
        </dl>
      </section>
      <Card className="p-6">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); complete.mutate(planId, { onSuccess: () => location.assign("/club/billing?checkout=success"), onError: toast.error }); }}>
          <Field label={t("E-mail")}>{(id) => <Input id={id} type="email" defaultValue={email} />}</Field>
          <Field label={t("Número do cartão")}>{(id) => <div className="relative"><CreditCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input id={id} value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" className="pl-9 font-mono" /></div>}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Validade")}>{(id) => <Input id={id} defaultValue="12/34" />}</Field>
            <Field label={t("CVC")}>{(id) => <Input id={id} defaultValue="123" inputMode="numeric" />}</Field>
          </div>
          <Field label={t("Nome no cartão")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="cc-name" />}</Field>
          <Button type="submit" size="lg" block icon={<Lock />} loading={complete.isPending}>{t("Assinar")}</Button>
          <p className="text-center text-xs text-fg-muted">{t("Ao assinar, você autoriza a cobrança mensal até cancelar. Cancele quando quiser em Plano e cobrança.")}</p>
        </form>
      </Card>
    </div>
  );
}

function Portal({ clubId, clubName }: { clubId: string; clubName: string }) {
  const sub = useSubscription(clubId);
  const invoices = useInvoices(clubId);
  const act = useMockPortalAction(clubId);
  const s = sub.data;
  const run = (a: Parameters<typeof act.mutate>[0], msg: string) => act.mutate(a, { onSuccess: () => toast.success(msg), onError: toast.error });
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-5 py-10">
      <Link to="/club/billing" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("Voltar ao Runflow")}</Link>
      <div><RunflowWordmark /><h1 className="mt-4 rf-text-display-sm">{t("Assinatura de {club}", { club: clubName })}</h1></div>
      {!s ? <Skeleton className="h-40" /> : (
        <>
          <Card className="grid gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="rf-text-title-md">{t("Runflow {plan}", { plan: s.plan === "max" ? "Max" : s.plan === "pro" ? "Pro" : "Free" })}</span>{s.frozen ? <Badge tone="info">{t("Congelado")}</Badge> : s.status === "past_due" ? <Badge tone="danger">{t("Pagamento pendente")}</Badge> : s.cancel_at_period_end ? <Badge tone="warning">{t("Cancelado")}</Badge> : <Badge tone="success">{t("Ativo")}</Badge>}</div>
            <p className="text-fg-muted">{money(s.monthly_cents)} {t("por mês")}{s.current_period_end ? ` · ${s.cancel_at_period_end ? t("termina em {d}", { d: fullDate(localDate(s.current_period_end)) }) : t("renova em {d}", { d: fullDate(localDate(s.current_period_end)) })}` : ""}</p>
            <div className="flex flex-wrap gap-2">
              {s.plan !== "free" && (s.cancel_at_period_end
                ? <Button icon={<RotateCcw />} loading={act.isPending} onClick={() => run("resume", t("Assinatura retomada"))}>{t("Retomar assinatura")}</Button>
                : <Button variant="secondary" icon={<XCircle />} loading={act.isPending} onClick={() => run("cancel", t("Assinatura cancelada no fim do período"))}>{t("Cancelar assinatura")}</Button>)}
            </div>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="flex items-center gap-2"><CreditCard className="size-5" /><span className="font-mono">Visa •••• 4242</span><span className="text-sm text-fg-muted">12/34</span></span>
            <Button variant="secondary" size="sm" onClick={() => s.status === "past_due" ? run("pay", t("Cartão atualizado e pagamento aprovado")) : toast.success(t("Cartão atualizado"))}>{t("Atualizar cartão")}</Button>
          </Card>
          <Card className="grid gap-2 p-5">
            <h2 className="rf-text-title-sm">{t("Histórico")}</h2>
            {(invoices.data ?? []).map((i) => <div key={i.id} className="flex justify-between gap-3 text-sm"><span className="tabular-nums">{fullDate(localDate(i.created_at))}</span><span className="tabular-nums">{money(i.amount_cents, i.currency)}</span></div>)}
          </Card>
          <Card className="grid gap-3 border-dashed p-5">
            <div><h2 className="flex items-center gap-2 rf-text-title-sm"><FlaskConical className="size-4" />{t("Simular eventos do Stripe")}</h2><p className="text-sm text-fg-muted">{t("Só no ambiente de testes, para ver como o app reage.")}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => run("fail_payment", t("Pagamento recusado (simulado)"))}>{t("Recusar próximo pagamento")}</Button>
              <Button size="sm" variant="ghost" onClick={() => run("freeze", t("Prazo de pagamento esgotado (simulado)"))}>{t("Esgotar o prazo e congelar")}</Button>
              <Button size="sm" variant="ghost" onClick={() => run("pay", t("Pagamento aprovado (simulado)"))}>{t("Aprovar pagamento")}</Button>
              <Button size="sm" variant="ghost" onClick={() => run("expire", t("Período encerrado (simulado)"))}>{t("Encerrar período agora")}</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

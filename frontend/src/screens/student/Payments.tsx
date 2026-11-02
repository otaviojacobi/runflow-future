/** M12 · Pagamentos: open and overdue fees with Pix/card checkout, history with receipts. Route: /payments */
import { Link } from "@tanstack/react-router";
import { CircleCheck, Receipt as ReceiptIcon, Wallet } from "lucide-react";
import { useEffect } from "react";
import { useChargeCheckout, useMyCharges } from "@/api/finances";
import type { Charge } from "@/api/types";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { fullDate, localDate, money } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, cn, toast } from "@/ui";
import { METHOD_LABEL, STATE } from "../owner/Finances";

export function PaymentsScreen() {
  const { club } = useClub();
  const list = useMyCharges(club?.id);
  const checkout = useChargeCheckout(club?.id ?? "");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("paid")) { toast.success(t("Pagamento confirmado!"), t("O recibo já está disponível.")); history.replaceState(null, "", "/payments"); }
  }, []);
  if (!club) return null;
  const items = list.data?.items ?? [];
  const due = items.filter((c) => c.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const paid = items.filter((c) => c.status === "paid");
  const pay = (c: Charge) => checkout.mutate(c.id, { onSuccess: (r) => location.assign(r.checkout_url), onError: toast.error });
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader title={t("Pagamentos")} subtitle={t("Mensalidades e cobranças de {club}", { club: club.name })} />
      {list.isPending ? <Skeleton className="h-48" /> : items.length === 0 ? <Card><EmptyState icon={<Wallet />} title={t("Nenhuma cobrança")}>{t("Quando o clube cobrar uma mensalidade pelo app, ela aparece aqui.")}</EmptyState></Card> : (
        <>
          <section className="grid gap-3" aria-labelledby="due-h">
            <h2 id="due-h" className="rf-text-title-md">{t("Para pagar")}</h2>
            {due.length === 0 ? <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-on-success-soft"><CircleCheck className="size-5" />{t("Tudo em dia. Obrigado!")}</p> : due.map((c) => (
              <Card key={c.id} edge={c.state === "overdue" ? "danger" : undefined} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.description}</span><Badge tone={STATE[c.state].tone}>{t(STATE[c.state].label)}</Badge></div>
                  <div className="text-sm text-fg-muted">{t("Vence em {d}", { d: fullDate(c.due_date) })}</div>
                </div>
                <span className="font-display text-2xl font-bold tabular-nums">{money(c.amount_cents)}</span>
                {list.data?.account ? <Button className="w-full sm:w-auto" loading={checkout.isPending && checkout.variables === c.id} onClick={() => pay(c)}>{t("Pagar com Pix ou cartão")}</Button>
                  : <p className="w-full text-sm text-fg-muted">{t("Combine o pagamento direto com o clube.")}</p>}
              </Card>
            ))}
          </section>
          {paid.length > 0 && (
            <section className="grid gap-3" aria-labelledby="paid-h">
              <h2 id="paid-h" className="rf-text-title-md">{t("Histórico")}</h2>
              <Card className="divide-y divide-line-subtle">
                {paid.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <CircleCheck className="size-5 shrink-0 text-success-text" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{c.description}</div><div className="text-xs text-fg-muted">{t("Pago em {d}", { d: fullDate(localDate(c.paid_at!)) })}{c.method ? ` · ${t(METHOD_LABEL[c.method])}` : ""}</div></div>
                    <span className="text-sm font-semibold tabular-nums">{money(c.amount_cents)}</span>
                    <Link to="/receipts/$id" params={{ id: c.id }} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-brand-text hover:bg-soft")}><ReceiptIcon className="size-4" />{t("Recibo")}</Link>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Printable payment receipt (owner or the student who paid). Route: /receipts/$id */
import { useParams } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useReceipt } from "@/api/finances";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { fullDate, localDate, money, timeOf } from "@/lib/format";
import { Button, Card, EmptyState, Skeleton } from "@/ui";
import { METHOD_LABEL } from "../owner/Finances";

export function ReceiptScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { club } = useClub();
  const r = useReceipt(club?.id, id);
  if (!club) return null;
  const x = r.data;
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div data-print="hide" className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("Voltar")}</button>
        {x && <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>{t("Imprimir ou PDF")}</Button>}
      </div>
      {r.isPending ? <Skeleton className="h-96" /> : !x ? <Card><EmptyState title={r.error instanceof ApiError ? r.error.title : t("Recibo indisponível")}>{r.error instanceof ApiError ? r.error.detail : null}</EmptyState></Card> : (
        <Card className="grid gap-6 p-6 sm:p-8">
          <header className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3"><ClubLogo club={x.club} branding={x.branding} size={44} /><div><div className="font-semibold">{x.club.name}</div>{x.club.city && <div className="text-sm text-fg-muted">{[x.club.city, x.club.state].filter(Boolean).join(" · ")}</div>}</div></div>
            <div className="text-right"><div className="rf-text-overline text-fg-muted">{t("Recibo")}</div><div className="font-display text-xl font-bold tabular-nums">nº {String(x.charge.receipt_number ?? 0).padStart(5, "0")}</div></div>
          </header>
          <p className="text-[15px] leading-relaxed">{t("Recebemos de {name} a quantia de {v}, referente a {d}.", { name: x.charge.athlete.user.name, v: money(x.charge.amount_cents), d: x.charge.description })}</p>
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-sunken p-4 text-sm">
            <div><dt className="text-fg-muted">{t("Valor")}</dt><dd className="font-semibold tabular-nums">{money(x.charge.amount_cents)}</dd></div>
            <div><dt className="text-fg-muted">{t("Forma de pagamento")}</dt><dd className="font-semibold">{x.charge.method ? t(METHOD_LABEL[x.charge.method]) : "–"}</dd></div>
            <div><dt className="text-fg-muted">{t("Pago em")}</dt><dd className="font-semibold tabular-nums">{fullDate(localDate(x.charge.paid_at!))} · {timeOf(x.charge.paid_at!)}</dd></div>
            <div><dt className="text-fg-muted">{t("Vencimento")}</dt><dd className="font-semibold tabular-nums">{fullDate(x.charge.due_date)}</dd></div>
            {x.charge.external_ref && <div className="col-span-2"><dt className="text-fg-muted">{t("Identificador")}</dt><dd className="font-mono text-xs">{x.charge.external_ref}</dd></div>}
          </dl>
          <p className="text-xs text-fg-muted">{t("Recibo emitido pelo Runflow em nome de {club}. Este documento não substitui a nota fiscal.", { club: x.club.name })}</p>
        </Card>
      )}
    </div>
  );
}

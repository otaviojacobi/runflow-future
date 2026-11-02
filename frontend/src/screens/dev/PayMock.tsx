/** Simulated Stripe Checkout for a student fee (Pix + card). Mock only. Route: /dev/pay/$id?club=<club id> */
import { useParams } from "@tanstack/react-router";
import { ArrowLeft, Copy, CreditCard, FlaskConical, Lock, QrCode as QrIcon } from "lucide-react";
import { useState } from "react";
import { useMockPay, useMyCharges } from "@/api/finances";
import { useMe } from "@/api/me";
import { QrCode } from "@/components/club/InviteShare";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { fullDate, money } from "@/lib/format";
import { Button, Card, Field, Input, Segmented, Skeleton, toast } from "@/ui";

export function PayMockScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const clubId = new URLSearchParams(location.search).get("club") ?? "";
  const me = useMe();
  const list = useMyCharges(clubId || undefined);
  const pay = useMockPay(clubId);
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const c = list.data?.items.find((x) => x.id === id);
  const club = me.data?.memberships.find((m) => m.club.id === clubId)?.club;
  const pixCode = c ? `00020126580014BR.GOV.BCB.PIX0136runflow-mock-${c.id.slice(0, 8)}5204000053039865406${(c.amount_cents / 100).toFixed(2)}5802BR6009SAO PAULO62070503***6304ABCD` : "";
  const done = () => pay.mutate({ charge_id: id, method }, { onSuccess: () => location.assign("/payments?paid=1"), onError: toast.error });
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-sm font-semibold text-on-warning-soft"><FlaskConical className="size-4 shrink-0" />{t("Ambiente de testes: esta tela simula o pagamento. Nenhum valor é cobrado.")}</div>
      <div className="mx-auto grid max-w-lg gap-6 px-5 py-10">
        <a href="/payments" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("Voltar")}</a>
        <RunflowWordmark />
        {!c ? (list.isPending ? <Skeleton className="h-64" /> : <p className="text-fg-muted">{t("Cobrança não encontrada ou já paga.")}</p>) : (
          <>
            <div><p className="text-fg-muted">{club?.name} · {c.description}</p><p className="font-display text-4xl font-bold tabular-nums">{money(c.amount_cents)}</p><p className="text-sm text-fg-muted">{t("Vence em {d}", { d: fullDate(c.due_date) })}</p></div>
            <Segmented label={t("Forma de pagamento")} value={method} onChange={setMethod} className="w-fit" options={[{ value: "pix", label: t("Pix"), icon: <QrIcon /> }, { value: "card", label: t("Cartão"), icon: <CreditCard /> }]} />
            {method === "pix" ? (
              <Card className="grid justify-items-center gap-4 p-5 text-center">
                <QrCode value={pixCode} size={200} label={t("QR code Pix")} />
                <p className="text-sm text-fg-muted">{t("Abra o app do seu banco, escolha Pix e escaneie o código. Ou copie o código abaixo.")}</p>
                <Button variant="secondary" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(pixCode).then(() => toast.success(t("Código Pix copiado")))}>{t("Copiar código Pix")}</Button>
                <Button block icon={<Lock />} loading={pay.isPending} onClick={done}>{t("Simular pagamento Pix")}</Button>
              </Card>
            ) : (
              <Card className="grid gap-4 p-5">
                <Field label={t("Número do cartão")}>{(fid) => <Input id={fid} defaultValue="4242 4242 4242 4242" className="font-mono" />}</Field>
                <div className="grid grid-cols-2 gap-3"><Field label={t("Validade")}>{(fid) => <Input id={fid} defaultValue="12/34" />}</Field><Field label={t("CVC")}>{(fid) => <Input id={fid} defaultValue="123" />}</Field></div>
                <Button block icon={<Lock />} loading={pay.isPending} onClick={done}>{t("Pagar {v}", { v: money(c.amount_cents) })}</Button>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

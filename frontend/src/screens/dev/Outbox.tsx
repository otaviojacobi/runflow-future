/** Dev only: the e-mails the backend would send (mock outbox), rendered like an inbox. Route: /dev/outbox */
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Inbox, Mail, RotateCcw } from "lucide-react";
import { useState } from "react";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { Button, Card, EmptyState, Input, Skeleton, buttonClass } from "@/ui";

interface Mail { id: string; created_at: string; kind: string; to: string; subject: string; text: string; action?: { label: string; url: string } }

export function OutboxScreen() {
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: ["mock-outbox", to], refetchInterval: 5000, queryFn: () => api.get<{ items: Mail[] }>(`/mock/outbox${to ? `?to=${encodeURIComponent(to)}` : ""}`).then((r) => r.items) });
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm font-semibold text-on-warning-soft"><FlaskConical className="size-4" />{t("Ambiente de testes: estes e-mails não saem daqui. Em produção, chegam na caixa de entrada de cada pessoa.")}</div>
      <main className="mx-auto grid max-w-2xl gap-5 px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><RunflowWordmark /><h1 className="flex items-center gap-2 rf-text-title-lg"><Inbox className="size-5" />{t("Caixa de saída")}</h1></div>
        <div className="flex gap-2"><Input aria-label={t("Filtrar por destinatário")} placeholder={t("Filtrar por e-mail do destinatário")} value={to} onChange={(e) => setTo(e.target.value.trim())} /><Button variant="secondary" icon={<RotateCcw />} onClick={() => q.refetch()}>{t("Atualizar")}</Button></div>
        {q.isPending ? <Skeleton className="h-48" /> : !q.data?.length ? <Card><EmptyState icon={<Mail />} title={t("Nenhum e-mail enviado ainda")}>{t("Convide alguém em Membros e convites: o e-mail aparece aqui.")}</EmptyState></Card> : q.data.map((m) => (
          <Card key={m.id} className="grid gap-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-fg-muted"><span>{t("Para")}: <b className="text-fg">{m.to}</b></span><span>{ago(m.created_at)}</span></div>
            <h2 className="rf-text-title-md">{m.subject}</h2>
            <p className="whitespace-pre-line text-[15px]">{m.text}</p>
            {m.action && <a href={m.action.url} className={buttonClass("primary") + " w-fit"}>{m.action.label}</a>}
          </Card>
        ))}
      </main>
    </div>
  );
}

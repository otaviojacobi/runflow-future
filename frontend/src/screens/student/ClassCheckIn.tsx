/**
 * M6 · Check-in from the venue's QR (D-052). Route: /classes/check-in?session=<id>&code=<code>, the `checkin_url` staff
 * show at the venue. The link names only the session, so the page looks for it in the student's clubs (the active one
 * first) and switches to that club. Errors are the API's (pt-BR): wrong code, outside the window, full, cancelled.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { CalendarX, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { useCheckIn } from "@/api/classes";
import type { ClassSession } from "@/api/types";
import { t } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { Button, Card, EmptyState, Input, PageHeader, Skeleton } from "@/ui";
import { CheckinDone, SessionSummary } from "./Classes";

export function ClassCheckInScreen() {
  const { me, club } = useClub();
  const search = useSearch({ strict: false }) as { session?: string; code?: string };
  const id = search.session ?? null;
  const studentClubs = (me?.memberships ?? []).filter((m) => m.membership.role === "student" && m.membership.status === "active");
  const ordered = [...studentClubs].sort((a, b) => Number(b.club.id === club?.id) - Number(a.club.id === club?.id));
  const found = useQuery({
    queryKey: ["classes", "checkin-lookup", id, ordered.map((m) => m.club.id)], enabled: !!id && ordered.length > 0, retry: false,
    queryFn: async () => {
      for (const m of ordered) {
        try { return { m, s: await api.get<ClassSession>(`/clubs/${m.club.id}/class-sessions/${id}`) }; }
        catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 403)) continue; throw e; }
      }
      return null;
    },
  });
  const go = useCheckIn();
  const [code, setCode] = useState((search.code ?? "").toUpperCase());
  const at = found.data?.m;
  // The class belongs to another of the student's clubs: switch to it (its colors, its Aulas).
  useEffect(() => { if (at && at.club.id !== club?.id) selectClub(at); }, [at, club?.id]);

  const fromQr = !!search.code;
  let body;
  if (!id) body = <EmptyState icon={<QrCode />} title={t("Link de check-in incompleto")}>{t("Aponte a câmera para o QR code do local de novo ou digite o código em Aulas.")}</EmptyState>;
  else if (!studentClubs.length) body = <EmptyState icon={<QrCode />} title={t("O check-in é para alunos")}>{t("Entre com a conta de aluno do clube para registrar a presença.")}</EmptyState>;
  else if (found.isPending) body = <Skeleton className="h-40" />;
  else if (!found.data) body = <EmptyState icon={<CalendarX />} title={t("Não encontramos esta aula")}>{t("Ela não é de um clube em que você treina, ou foi removida.")}</EmptyState>;
  else if (go.isSuccess) body = <div className="grid gap-4"><CheckinDone /><Link to="/classes" search={{}} className="justify-self-center text-sm font-semibold text-brand-text underline">{t("Ver minhas aulas")}</Link></div>;
  else {
    const { m, s } = found.data;
    body = (
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); go.mutate({ club_id: m.club.id, session_id: s.id, checkin_code: code }); }}>
        <p className="text-sm text-fg-muted">{m.club.name}</p>
        <SessionSummary club={m.club} s={s} />
        {s.status === "cancelled" ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-on-danger-soft">{s.cancel_reason ? t("Esta aula foi cancelada: {r}", { r: s.cancel_reason }) : t("Esta aula foi cancelada.")}</p> : fromQr ? (
          <p className="text-sm text-fg-muted">{t("Você escaneou o QR do local. Confirme para registrar sua presença.")}</p>
        ) : (
          <label className="grid gap-1.5"><span className="rf-text-label-sm">{t("Código mostrado no local")}</span>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6))} placeholder="A1B2C3" autoFocus autoComplete="off" className="text-center font-mono text-2xl tracking-[0.3em]" /></label>
        )}
        {go.error && <p role="alert" className="text-sm text-danger-text">{go.error instanceof ApiError ? `${go.error.title}. ${go.error.detail}` : t("Algo deu errado")}</p>}
        {s.status !== "cancelled" && <Button type="submit" block size="lg" loading={go.isPending} disabled={code.length !== 6}>{t("Confirmar check-in")}</Button>}
      </form>
    );
  }
  return (
    <div className="mx-auto grid max-w-md gap-5">
      <PageHeader title={t("Check-in")} />
      <Card className="p-5">{body}</Card>
    </div>
  );
}

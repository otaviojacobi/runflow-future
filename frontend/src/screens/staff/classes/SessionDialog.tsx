/** W9 · session detail: roster, attendance, waitlist, QR check-in, capacity, cancel. */
import { Ban, Check, Maximize2, MapPin, QrCode as QrIcon, UserPlus, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { useBook, useCancelBooking, useMarkAttendance, useSession, useUpdateSession } from "@/api/classes";
import { useAthletes } from "@/api/members";
import type { ClassSessionDetail, Club, RosterEntry } from "@/api/types";
import { BookingBadge, CHECKIN_LEAD_MS, checkinUrl, isPast, timeRange } from "@/components/classes";
import { QrCode } from "@/components/club/InviteShare";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { localDate, longDate, timeOf } from "@/lib/format";
import { Avatar, Badge, Button, Dialog, IconButton, Input, Select, Skeleton, Textarea, cn, toast } from "@/ui";

export function SessionDialog({ club, id, onClose }: { club: Club; id: string | null; onClose: () => void }) {
  const s = useSession(club.id, id);
  const x = s.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} size="lg"
      title={x ? x.class_type.name : t("Aula")}
      description={x ? <span className="first-letter:uppercase">{longDate(localDate(x.starts_at, club.timezone))} · {timeRange(x, club.timezone)}</span> : undefined}>
      {!x ? <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-48" /></div> : <Body club={club} s={x} key={x.id} />}
    </Dialog>
  );
}

type Mode = "roster" | "qr" | "cancel" | "capacity";

function Body({ club, s }: { club: Club; s: ClassSessionDetail }) {
  const [mode, setMode] = useState<Mode>("roster");
  const roster = s.roster ?? [];
  const confirmed = roster.filter((r) => r.status !== "waitlisted");
  const queue = roster.filter((r) => r.status === "waitlisted");
  const present = roster.filter((r) => r.status === "attended").length;
  const cancelled = s.status === "cancelled";
  const past = isPast(s);
  const started = Date.now() >= Date.parse(s.starts_at) - CHECKIN_LEAD_MS;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <SportChip sport={s.class_type.sport} size="sm" />
        {s.location && <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{s.location.name}</span>}
        {s.instructor && <span className="inline-flex items-center gap-1.5"><Avatar name={s.instructor.name} src={s.instructor.avatar_url} size={20} />{s.instructor.name}</span>}
        {cancelled && <Badge tone="danger" icon={<Ban />}>{t("Cancelada")}</Badge>}
      </div>
      {s.notes && <p className="rounded-md bg-sunken px-3 py-2 text-sm">{s.notes}</p>}

      <dl className="grid grid-cols-3 gap-2">
        {[
          { k: t("Reservas"), v: `${confirmed.length}/${s.capacity}` },
          { k: t("Na fila"), v: String(queue.length) },
          { k: t("Presentes"), v: started ? String(present) : "–" },
        ].map((x) => <div key={x.k} className="rounded-lg bg-sunken px-3 py-2.5"><dt className="text-xs text-fg-muted">{x.k}</dt><dd className="font-display text-2xl font-bold tabular-nums">{x.v}</dd></div>)}
      </dl>

      {!cancelled && !past && (
        <div className="flex flex-wrap gap-2">
          <Button variant={mode === "qr" ? "primary" : "secondary"} size="sm" icon={<QrIcon />} onClick={() => setMode(mode === "qr" ? "roster" : "qr")}>{t("QR de check-in")}</Button>
          <Button variant={mode === "capacity" ? "primary" : "secondary"} size="sm" icon={<Users />} onClick={() => setMode(mode === "capacity" ? "roster" : "capacity")}>{t("Alterar vagas")}</Button>
          <Button variant="ghost" size="sm" icon={<Ban />} className="text-danger-text" onClick={() => setMode("cancel")}>{t("Cancelar aula")}</Button>
        </div>
      )}

      {mode === "qr" && <CheckinPanel s={s} />}
      {mode === "capacity" && <CapacityPanel club={club} s={s} onDone={() => setMode("roster")} />}
      {mode === "cancel" && <CancelPanel club={club} s={s} affected={roster.length} onDone={() => setMode("roster")} />}

      <section className="grid gap-2" aria-label={t("Lista de presença")}>
        <div className="flex items-center justify-between gap-3"><h3 className="rf-text-title-sm">{t("Confirmados")}</h3>{started && !cancelled && confirmed.length > 0 && <span className="text-xs text-fg-muted">{t("Marque quem veio")}</span>}</div>
        {confirmed.length === 0 ? <p className="text-sm text-fg-muted">{t("Ninguém reservou ainda.")}</p> : <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">{confirmed.map((r) => <Row key={r.id} club={club} r={r} s={s} started={started} />)}</ul>}
        {queue.length > 0 && <>
          <h3 className="mt-2 rf-text-title-sm">{t("Lista de espera")}</h3>
          <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">{queue.map((r) => <Row key={r.id} club={club} r={r} s={s} started={started} />)}</ul>
          <p className="text-xs text-fg-muted">{t("Quando alguém cancela, o primeiro da fila entra e recebe um aviso.")}</p>
        </>}
      </section>
      {!cancelled && !past && <AddStudent club={club} s={s} />}
    </div>
  );
}

function Row({ club, r, s, started }: { club: Club; r: RosterEntry; s: ClassSessionDetail; started: boolean }) {
  const mark = useMarkAttendance(club.id);
  const cancel = useCancelBooking(club.id);
  const cancelled = s.status === "cancelled";
  const set = (status: "attended" | "no_show" | "booked") => mark.mutate({ id: r.id, status }, { onError: toast.error });
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Avatar name={r.athlete.user.name} src={r.athlete.user.avatar_url} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{r.athlete.user.name}</div>
        <div className="text-xs text-fg-muted">{r.checked_in_at && r.status === "attended" ? t("Check-in às {h}", { h: timeOf(r.checked_in_at, club.timezone) }) : r.status === "waitlisted" ? t("Entrou na fila às {h}", { h: timeOf(r.created_at, club.timezone) }) : t("Reservou às {h}", { h: timeOf(r.created_at, club.timezone) })}</div>
      </div>
      {started && !cancelled && r.status !== "waitlisted" ? (
        <div className="flex gap-1" role="group" aria-label={t("Presença de {name}", { name: r.athlete.user.name })}>
          <button type="button" aria-pressed={r.status === "attended"} onClick={() => set(r.status === "attended" ? "booked" : "attended")} disabled={mark.isPending}
            className={cn("inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold", r.status === "attended" ? "border-success-edge bg-success-soft text-on-success-soft" : "border-line text-fg-muted hover:bg-soft")}><Check className="size-4" />{t("Veio")}</button>
          <button type="button" aria-pressed={r.status === "no_show"} onClick={() => set(r.status === "no_show" ? "booked" : "no_show")} disabled={mark.isPending}
            className={cn("inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold", r.status === "no_show" ? "border-danger-edge bg-danger-soft text-on-danger-soft" : "border-line text-fg-muted hover:bg-soft")}><X className="size-4" />{t("Faltou")}</button>
        </div>
      ) : (
        <BookingBadge status={r.status} position={r.waitlist_position} />
      )}
      {!started && !cancelled && <IconButton size="sm" label={t("Remover {name}", { name: r.athlete.user.name })} onClick={() => cancel.mutate(r.id, { onSuccess: () => toast.success(t("Reserva removida")), onError: toast.error })}><X /></IconButton>}
    </li>
  );
}

function AddStudent({ club, s }: { club: Club; s: ClassSessionDetail }) {
  const athletes = useAthletes(club.id);
  const book = useBook(club.id);
  const [pick, setPick] = useState("");
  const inRoster = new Set((s.roster ?? []).map((r) => r.membership_id));
  const options = (athletes.data ?? []).filter((a) => !inRoster.has(a.membership.id));
  return (
    <form className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-4" onSubmit={(e) => { e.preventDefault(); book.mutate({ session_id: s.id, membership_id: pick }, { onSuccess: (b) => { toast.success(b.status === "waitlisted" ? t("Adicionado à lista de espera") : t("Reserva feita")); setPick(""); }, onError: toast.error }); }}>
      <Select aria-label={t("Aluno para adicionar")} value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
        <option value="">{t("Adicionar aluno…")}</option>
        {options.map((a) => <option key={a.membership.id} value={a.membership.id}>{a.user.name}</option>)}
      </Select>
      <Button type="submit" variant="secondary" icon={<UserPlus />} disabled={!pick} loading={book.isPending}>{t("Adicionar")}</Button>
    </form>
  );
}

function CheckinPanel({ s }: { s: ClassSessionDetail }) {
  const ref = useRef<HTMLDivElement>(null);
  const code = s.checkin_code ?? "";
  return (
    <div ref={ref} className="grid justify-items-center gap-3 rounded-xl border border-line bg-surface p-5 text-center [&:fullscreen]:content-center [&:fullscreen]:bg-canvas">
      <QrCode value={checkinUrl(s, code)} size={200} label={t("QR code de check-in")} />
      <div><div className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">{t("Código")}</div><div className="font-mono text-4xl font-bold tracking-[0.2em]" data-testid="checkin-code">{code}</div></div>
      <p className="max-w-sm text-sm text-fg-muted">{t("Mostre esta tela ou imprima no local. O aluno escaneia com o celular ou digita o código. O check-in abre 45 minutos antes da aula.")}</p>
      {document.fullscreenEnabled && <Button variant="secondary" size="sm" icon={<Maximize2 />} onClick={() => ref.current?.requestFullscreen()}>{t("Tela cheia")}</Button>}
    </div>
  );
}

function CapacityPanel({ club, s, onDone }: { club: Club; s: ClassSessionDetail; onDone: () => void }) {
  const update = useUpdateSession(club.id);
  const [cap, setCap] = useState(s.capacity);
  const confirmed = (s.roster ?? []).filter((r) => r.status !== "waitlisted").length;
  const queue = (s.roster ?? []).filter((r) => r.status === "waitlisted").length;
  const promoted = Math.max(0, Math.min(queue, cap - confirmed));
  return (
    <form className="grid gap-2 rounded-xl border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); update.mutate({ id: s.id, capacity: cap }, { onSuccess: () => { toast.success(t("Vagas atualizadas"), promoted ? tn(promoted, "{n} aluno saiu da fila e foi avisado.", "{n} alunos saíram da fila e foram avisados.") : undefined); onDone(); }, onError: toast.error }); }}>
      <label className="rf-text-label-sm" htmlFor="cap">{t("Vagas nesta aula")}</label>
      <div className="flex gap-2"><Input id="cap" type="number" min={1} max={500} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="w-28" /><Button type="submit" loading={update.isPending}>{t("Salvar")}</Button></div>
      {promoted > 0 && <p className="text-sm text-fg-muted">{tn(promoted, "{n} aluno da fila vai ganhar a vaga.", "{n} alunos da fila vão ganhar a vaga.")}</p>}
      {cap < confirmed && <p className="text-sm text-warning-text">{t("Já há {n} reservas. Ninguém perde a vaga, mas novas reservas vão para a fila.", { n: confirmed })}</p>}
    </form>
  );
}

function CancelPanel({ club, s, affected, onDone }: { club: Club; s: ClassSessionDetail; affected: number; onDone: () => void }) {
  const update = useUpdateSession(club.id);
  const [reason, setReason] = useState("");
  return (
    <form className="grid gap-3 rounded-xl border border-danger-edge bg-danger-soft/40 p-4" onSubmit={(e) => { e.preventDefault(); update.mutate({ id: s.id, status: "cancelled", reason: reason || undefined }, { onSuccess: () => { toast.success(t("Aula cancelada"), affected ? tn(affected, "Avisamos {n} aluno.", "Avisamos {n} alunos.") : undefined); onDone(); }, onError: toast.error }); }}>
      <p className="font-semibold">{affected ? tn(affected, "Cancelar e avisar {n} aluno?", "Cancelar e avisar {n} alunos?") : t("Cancelar esta aula?")}</p>
      <Textarea aria-label={t("Motivo")} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Motivo (vai na notificação). Ex.: chuva forte")} />
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onDone}>{t("Voltar")}</Button><Button type="submit" variant="danger" loading={update.isPending}>{t("Cancelar aula")}</Button></div>
    </form>
  );
}

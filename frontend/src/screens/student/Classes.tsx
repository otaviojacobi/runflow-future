/** M6 · Aulas: weekly agenda, book / waitlist / cancel, QR check-in, history. Route: /classes (?club&checkin&code from the venue QR) */
import { useNavigate } from "@tanstack/react-router";
import { CalendarCheck, CalendarClock, Check, CircleCheck, MapPin, QrCode, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBook, useCancelBooking, useCheckIn, useSession, useSessions } from "@/api/classes";
import type { ClassSession, Club } from "@/api/types";
import { BookingBadge, Occupancy, checkinOpen, isPast, spotsLeft, timeRange } from "@/components/classes";
import { SportChip, sportBar } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { addDays, dayMonth, localDate, longDate, shortDate, today as todayFn, weekdayShort } from "@/lib/format";
import { Avatar, Button, Card, Dialog, EmptyState, Input, PageHeader, Skeleton, cn, toast } from "@/ui";

const AHEAD = 14;

/** Reads the venue QR parameters once; switches to the QR's club when the student belongs to it. */
function useQrCheckin() {
  const { me, club } = useClub();
  const navigate = useNavigate();
  const [qr, setQr] = useState<{ session: string; code: string } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const session = p.get("checkin"), code = p.get("code"), clubId = p.get("club");
    if (!session) return;
    if (clubId && clubId !== club?.id) { const m = me?.memberships.find((x) => x.club.id === clubId); if (m) selectClub(m); }
    setQr({ session, code: code ?? "" });
    navigate({ to: "/classes", replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [qr, setQr] as const;
}

export function ClassesScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [picked, setDay] = useState<string | null>(null);
  const [allMine, setAllMine] = useState(false);
  const [type, setType] = useState("all");
  const [checkin, setCheckin] = useQrCheckin();
  const agenda = useSessions(club?.id, today, addDays(today, AHEAD - 1));
  const history = useSessions(club?.id, addDays(today, -56), today);
  const days = Array.from({ length: AHEAD }, (_, i) => addDays(today, i));
  const all = agenda.data ?? [];
  const byDay = useMemo(() => {
    const m = new Map<string, ClassSession[]>();
    for (const s of all) { const d = localDate(s.starts_at, club?.timezone); m.set(d, [...(m.get(d) ?? []), s]); }
    return m;
  }, [all, club?.timezone]);
  const types = useMemo(() => [...new Map(all.map((s) => [s.class_type.id, s.class_type])).values()], [all]);
  if (!club) return null;
  const mine = all.filter((s) => s.my_booking && !isPast(s) && s.my_booking.status !== "attended");
  const now = mine.find((s) => s.my_booking?.status === "booked" && checkinOpen(s));
  // Open on the first day that has classes, unless the student picked one.
  const day = picked ?? days.find((d) => byDay.has(d)) ?? today;
  const list = (byDay.get(day) ?? []).filter((s) => type === "all" || s.class_type.id === type);
  const noClasses = agenda.isSuccess && all.length === 0 && !(history.data ?? []).length;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={t("Aulas")} subtitle={t("Reserve sua vaga e faça check-in no local")} />
      {now && (
        <Card className="flex flex-wrap items-center gap-4 border-brand-line bg-brand-soft p-4 text-on-brand-soft">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand"><ScanLine className="size-5" /></span>
          <div className="min-w-0 flex-1"><div className="font-semibold">{t("Sua aula começa às {h}", { h: timeRange(now, club.timezone).split("–")[0] })}</div><div className="text-sm">{now.class_type.name}{now.location ? ` · ${now.location.name}` : ""}</div></div>
          <Button icon={<QrCode />} onClick={() => setCheckin({ session: now.id, code: "" })}>{t("Fazer check-in")}</Button>
        </Card>
      )}
      {agenda.isPending ? <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div> : noClasses ? (
        <Card><EmptyState icon={<CalendarClock />} title={t("Nenhuma aula com reserva por aqui")}>{t("Quando {club} abrir aulas com vagas, elas aparecem nesta tela.", { club: club.name })}</EmptyState></Card>
      ) : (
        <>
          {mine.length > 0 && (
            <section className="grid gap-2" aria-labelledby="mine-h">
              <h2 id="mine-h" className="rf-text-title-md">{t("Minhas reservas")}</h2>
              <ul className="grid gap-2">{(allMine ? mine : mine.slice(0, 3)).map((s) => <li key={s.id}><SessionRow club={club} s={s} showDate onCheckin={() => setCheckin({ session: s.id, code: "" })} /></li>)}</ul>
              {mine.length > 3 && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setAllMine(!allMine)}>{allMine ? t("Mostrar menos") : t("Ver todas ({n})", { n: mine.length })}</Button>}
            </section>
          )}
          <section className="grid gap-3" aria-labelledby="agenda-h">
            <h2 id="agenda-h" className="rf-text-title-md">{t("Agenda")}</h2>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label={t("Dias")}>
              {days.map((d) => {
                const n = byDay.get(d)?.length ?? 0, booked = byDay.get(d)?.some((s) => s.my_booking && s.my_booking.status !== "cancelled");
                return (
                  <button key={d} role="tab" aria-selected={d === day} onClick={() => setDay(d)} aria-label={`${weekdayShort(d)}, ${dayMonth(d)}: ${tn(n, "{n} aula", "{n} aulas")}`}
                    className={cn("grid min-w-[52px] shrink-0 justify-items-center gap-0.5 rounded-lg border px-2 py-2", d === day ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:bg-soft", !n && d !== day && "text-fg-subtle")}>
                    <span className="text-[11px] font-bold uppercase">{d === today ? t("Hoje") : weekdayShort(d)}</span>
                    <span className="text-lg font-bold tabular-nums leading-none">{Number(d.slice(8))}</span>
                    <span aria-hidden className={cn("size-1.5 rounded-full", booked ? (d === day ? "bg-on-brand" : "bg-brand") : n ? (d === day ? "bg-on-brand/50" : "bg-line-strong") : "bg-transparent")} />
                  </button>
                );
              })}
            </div>
            {types.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por aula")}>
                {[{ id: "all", name: t("Todas") }, ...types].map((ct) => <button key={ct.id} onClick={() => setType(ct.id)} aria-pressed={type === ct.id} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", type === ct.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{ct.name}</button>)}
              </div>
            )}
            <h3 className="text-sm font-semibold text-fg-muted first-letter:uppercase">{longDate(day)}</h3>
            {list.length === 0 ? <p className="rounded-lg bg-sunken px-4 py-6 text-center text-fg-muted">{t("Nenhuma aula neste dia.")}</p> : <ul className="grid gap-2">{list.map((s) => <li key={s.id}><SessionRow club={club} s={s} onCheckin={() => setCheckin({ session: s.id, code: "" })} /></li>)}</ul>}
          </section>
          <History club={club} sessions={history.data ?? []} />
        </>
      )}
      <CheckinDialog club={club} value={checkin} onClose={() => setCheckin(null)} />
    </div>
  );
}

function SessionRow({ club, s, showDate, onCheckin }: { club: Club; s: ClassSession; showDate?: boolean; onCheckin: () => void }) {
  const book = useBook(club.id);
  const cancel = useCancelBooking(club.id);
  const b = s.my_booking;
  const past = isPast(s);
  const full = spotsLeft(s) === 0;
  const doBook = () => book.mutate({ session_id: s.id }, {
    onSuccess: (r) => r.status === "waitlisted" ? toast.info(t("Você entrou na fila"), t("Posição {n}. Avisamos se abrir uma vaga.", { n: r.waitlist_position ?? 1 })) : toast.success(t("Vaga garantida!"), `${s.class_type.name} · ${shortDate(localDate(s.starts_at, club.timezone))}, ${timeRange(s, club.timezone)}`),
    onError: toast.error,
  });
  const doCancel = () => b && cancel.mutate(b.id, { onSuccess: () => toast.success(b.status === "waitlisted" ? t("Você saiu da fila") : t("Reserva cancelada"), b.status === "booked" ? t("Sua vaga foi liberada para outra pessoa.") : undefined), onError: toast.error });
  return (
    <article className={cn("relative flex flex-wrap items-center gap-x-4 gap-y-3 overflow-hidden rounded-xl border border-line bg-surface py-3 pl-4 pr-3 shadow-sm", past && "opacity-60")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", sportBar[s.class_type.sport])} />
      <div className="w-16 shrink-0">
        {showDate && <div className="text-[11px] font-bold uppercase text-fg-muted">{shortDate(localDate(s.starts_at, club.timezone)).split(",")[0]} {dayMonth(localDate(s.starts_at, club.timezone))}</div>}
        <div className="font-display text-xl font-bold tabular-nums">{timeRange(s, club.timezone).split("–")[0]}</div>
        <div className="text-xs text-fg-muted tabular-nums">{t("até {h}", { h: timeRange(s, club.timezone).split("–")[1] })}</div>
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{s.class_type.name}</h4><SportChip sport={s.class_type.sport} size="sm" /></div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          {s.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{s.location.name}</span>}
          {s.instructor && <span className="inline-flex items-center gap-1.5"><Avatar name={s.instructor.name} src={s.instructor.avatar_url} size={18} />{s.instructor.name.split(" ")[0]}</span>}
        </div>
        {s.notes && <p className="mt-1 text-sm">{s.notes}</p>}
        {!b && !past && <Occupancy s={s} className="mt-2 max-w-56" />}
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {b ? (
          <>
            <BookingBadge status={b.status} position={b.waitlist_position} />
            {b.status === "booked" && checkinOpen(s) && <Button size="sm" icon={<QrCode />} onClick={onCheckin}>{t("Check-in")}</Button>}
            {(b.status === "booked" || b.status === "waitlisted") && !past && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={doCancel}>{b.status === "waitlisted" ? t("Sair da fila") : t("Cancelar")}</Button>}
          </>
        ) : past ? <span className="text-sm text-fg-muted">{t("Encerrada")}</span> : (
          <Button size="sm" variant={full ? "secondary" : "primary"} loading={book.isPending} onClick={doBook}>{full ? t("Entrar na fila") : tn(spotsLeft(s), "Reservar · {n} vaga", "Reservar · {n} vagas")}</Button>
        )}
      </div>
    </article>
  );
}

function History({ club, sessions }: { club: Club; sessions: ClassSession[] }) {
  const done = sessions.filter((s) => s.my_booking && isPast(s) && ["attended", "no_show", "booked"].includes(s.my_booking.status)).reverse();
  if (!done.length) return null;
  const attended = done.filter((s) => s.my_booking?.status === "attended").length;
  return (
    <section className="grid gap-3" aria-labelledby="hist-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="hist-h" className="rf-text-title-md">{t("Histórico")}</h2><span className="text-sm text-fg-muted">{t("{a} de {n} aulas nas últimas 8 semanas", { a: attended, n: done.length })}</span></div>
      <Card className="divide-y divide-line-subtle">
        {done.slice(0, 12).map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            {s.my_booking?.status === "attended" ? <CircleCheck className="size-5 shrink-0 text-success-text" /> : <CalendarCheck className="size-5 shrink-0 text-fg-subtle" />}
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{s.class_type.name}</div><div className="text-xs text-fg-muted">{shortDate(localDate(s.starts_at, club.timezone))} · {timeRange(s, club.timezone)}</div></div>
            <BookingBadge status={s.my_booking!.status} />
          </div>
        ))}
      </Card>
    </section>
  );
}

function CheckinDialog({ club, value, onClose }: { club: Club; value: { session: string; code: string } | null; onClose: () => void }) {
  return <Dialog open={!!value} onOpenChange={(v) => !v && onClose()} size="sm" title={t("Check-in")}>{value && <CheckinBody club={club} value={value} onClose={onClose} key={value.session} />}</Dialog>;
}
function CheckinBody({ club, value, onClose }: { club: Club; value: { session: string; code: string }; onClose: () => void }) {
  const s = useSession(club.id, value.session);
  const go = useCheckIn(club.id);
  const [code, setCode] = useState(value.code);
  const fromQr = !!value.code;
  if (go.isSuccess) return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-success-soft text-on-success-soft"><Check className="size-8 stroke-[3]" /></span>
      <p className="rf-text-title-lg">{t("Check-in feito!")}</p>
      <p className="text-fg-muted">{t("Bom treino. Sua presença já aparece para o treinador.")}</p>
      <Button onClick={onClose}>{t("Fechar")}</Button>
    </div>
  );
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); go.mutate({ session_id: value.session, checkin_code: code }); }}>
      {s.isPending ? <Skeleton className="h-14" /> : s.data ? (
        <div className="flex items-center gap-3 rounded-lg bg-sunken p-3">
          <span className={cn("h-10 w-1 rounded-full", sportBar[s.data.class_type.sport])} />
          <div><div className="font-semibold">{s.data.class_type.name}</div><div className="text-sm text-fg-muted">{shortDate(localDate(s.data.starts_at, club.timezone))} · {timeRange(s.data, club.timezone)}{s.data.location ? ` · ${s.data.location.name}` : ""}</div></div>
        </div>
      ) : <p className="text-sm text-danger-text">{t("Não encontramos esta aula no seu clube.")}</p>}
      {fromQr ? <p className="text-sm text-fg-muted">{t("Você escaneou o QR do local. Confirme para registrar sua presença.")}</p> : (
        <label className="grid gap-1.5"><span className="rf-text-label-sm">{t("Código mostrado no local")}</span>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6))} placeholder="A1B2C3" autoFocus inputMode="text" autoComplete="off" className="text-center font-mono text-2xl tracking-[0.3em]" />
          <span className="rf-text-caption text-fg-muted">{t("Ou escaneie o QR code com a câmera do celular.")}</span></label>
      )}
      {go.error && <p role="alert" className="text-sm text-danger-text">{go.error instanceof ApiError ? `${go.error.title}. ${go.error.detail}` : t("Algo deu errado")}</p>}
      <Button type="submit" block size="lg" loading={go.isPending} disabled={code.length !== 6 || !s.data}>{t("Confirmar check-in")}</Button>
    </form>
  );
}

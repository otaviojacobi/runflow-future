/**
 * M6 · Aulas (D-052): the next two weeks by day with seats left, book / join the waitlist / cancel (until the start),
 * my bookings, check-in by code, history. Route: /classes (`?session=<id>`: the notification's link opens that class).
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarCheck, CalendarClock, CalendarX, Check, CircleCheck, MapPin, QrCode, ScanLine } from "lucide-react";
import { useMemo, useState } from "react";
import { useBook, useCancelBooking, useCheckIn, useSession, useSessions } from "@/api/classes";
import type { ClassSession, Club } from "@/api/types";
import { BookingBadge, Occupancy, checkinOpen, hasStarted, isPast, spotsLeft, timeRange } from "@/components/classes";
import { SportChip, sportBar } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, localDate, longDate, shortDate, today as todayFn, weekdayShort } from "@/lib/format";
import { Avatar, Button, Card, Dialog, EmptyState, Input, PageHeader, Skeleton, cn, toast } from "@/ui";

const AHEAD = 14;

export function ClassesScreen() {
  const { club } = useClub();
  const navigate = useNavigate();
  const { session: linked } = useSearch({ strict: false }) as { session?: string };
  const today = todayFn(club?.timezone);
  const [picked, setDay] = useState<string | null>(null);
  const [allMine, setAllMine] = useState(false);
  const [type, setType] = useState("all");
  const [checkin, setCheckin] = useState<string | null>(null);
  const agenda = useSessions(club?.id, today, addDays(today, AHEAD - 1));
  const history = useSessions(club?.id, addDays(today, -56), addDays(today, -1));
  const days = Array.from({ length: AHEAD }, (_, i) => addDays(today, i));
  const all = useMemo(() => agenda.data ?? [], [agenda.data]);
  const byDay = useMemo(() => {
    const m = new Map<string, ClassSession[]>();
    for (const s of all) { const d = localDate(s.starts_at, club?.timezone); m.set(d, [...(m.get(d) ?? []), s]); }
    return m;
  }, [all, club?.timezone]);
  const types = useMemo(() => [...new Map(all.map((s) => [s.class_type.id, s.class_type])).values()], [all]);
  if (!club) return null;
  const mine = all.filter((s) => s.my_booking && !isPast(s) && s.my_booking.status !== "attended" && s.my_booking.status !== "cancelled");
  const now = mine.find((s) => s.my_booking?.status === "booked" && checkinOpen(s));
  // Open on the first day that has classes, unless the student picked one.
  const day = picked ?? days.find((d) => byDay.has(d)) ?? today;
  const list = (byDay.get(day) ?? []).filter((s) => type === "all" || s.class_type.id === type);
  const noClasses = agenda.isSuccess && all.length === 0 && !(history.data ?? []).length;
  const closeLinked = () => navigate({ to: "/classes", search: {}, replace: true });

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={t("Aulas")} subtitle={t("Reserve sua vaga e faça check-in no local")} />
      {now && (
        <Card tone="brand" className="flex flex-wrap items-center gap-4 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand"><ScanLine className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1"><div className="font-semibold">{t("Sua aula começa às {h}", { h: timeRange(now, club.timezone).split("–")[0] })}</div><div className="text-sm">{now.class_type.name}{now.location ? ` · ${now.location.name}` : ""}</div></div>
          <Button icon={<QrCode />} onClick={() => setCheckin(now.id)}>{t("Fazer check-in")}</Button>
        </Card>
      )}
      {agenda.isPending ? <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div> : noClasses ? (
        <Card><EmptyState icon={<CalendarClock />} title={t("Nenhuma aula com reserva por aqui")}>{t("Quando {club} abrir aulas com vagas, elas aparecem nesta tela.", { club: club.name })}</EmptyState></Card>
      ) : (
        <>
          {mine.length > 0 && (
            <section className="grid gap-2" aria-labelledby="mine-h">
              <h2 id="mine-h" className="rf-text-title-md">{t("Minhas reservas")}</h2>
              <ul className="grid gap-2">{(allMine ? mine : mine.slice(0, 3)).map((s) => <li key={s.id}><SessionRow club={club} s={s} showDate onCheckin={() => setCheckin(s.id)} /></li>)}</ul>
              {mine.length > 3 && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setAllMine(!allMine)}>{allMine ? t("Mostrar menos") : t("Ver todas ({n})", { n: mine.length })}</Button>}
            </section>
          )}
          <section className="grid gap-3" aria-labelledby="agenda-h">
            <h2 id="agenda-h" className="rf-text-title-md">{t("Próximas aulas")}</h2>
            <div className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label={t("Dias")}>
              {days.map((d) => {
                const n = byDay.get(d)?.length ?? 0, booked = byDay.get(d)?.some((s) => s.my_booking && s.my_booking.status !== "cancelled");
                return (
                  <button key={d} type="button" aria-pressed={d === day} onClick={() => setDay(d)}
                    className={cn("relative grid min-w-[52px] shrink-0 justify-items-center gap-0.5 rounded-lg border px-2 py-2", d === day ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:bg-soft", !n && d !== day && "text-fg-subtle")}>
                    <span className="text-[11px] font-bold uppercase">{d === today ? t("Hoje") : weekdayShort(d)}</span>
                    <span className="text-lg font-bold tabular-nums leading-none">{Number(d.slice(8))}</span>
                    <span className="sr-only">{dayMonth(d)}, {tn(n, "{n} aula", "{n} aulas")}</span>
                    <span aria-hidden className={cn("size-1.5 rounded-full", booked ? (d === day ? "bg-on-brand" : "bg-brand") : n ? (d === day ? "bg-on-brand/50" : "bg-line-strong") : "bg-transparent")} />
                  </button>
                );
              })}
            </div>
            {types.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por aula")}>
                {[{ id: "all", name: t("Todas") }, ...types].map((ct) => <button key={ct.id} type="button" onClick={() => setType(ct.id)} aria-pressed={type === ct.id} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", type === ct.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{ct.name}</button>)}
              </div>
            )}
            <h3 className="text-sm font-semibold text-fg-muted first-letter:uppercase">{longDate(day)}</h3>
            {list.length === 0 ? <p className="rounded-lg bg-sunken px-4 py-6 text-center text-fg-muted">{t("Nenhuma aula neste dia.")}</p> : <ul className="grid gap-2">{list.map((s) => <li key={s.id}><SessionRow club={club} s={s} onCheckin={() => setCheckin(s.id)} /></li>)}</ul>}
          </section>
          <History club={club} sessions={history.data ?? []} />
        </>
      )}
      <CheckinDialog club={club} session={checkin} onClose={() => setCheckin(null)} />
      <LinkedSession club={club} id={linked ?? null} onClose={closeLinked} onCheckin={(id) => { closeLinked(); setCheckin(id); }} />
    </div>
  );
}

/** Book / waitlist / cancel for one session (used in lists and in the linked session's dialog). */
function useSessionActions(club: Club, s: ClassSession) {
  const book = useBook(club.id);
  const cancel = useCancelBooking(club.id);
  const b = s.my_booking;
  const doBook = () => book.mutate({ session_id: s.id }, {
    onSuccess: (r) => r.status === "waitlisted"
      ? toast.info(t("Você entrou na fila"), t("Posição {n}. Avisamos se abrir uma vaga.", { n: r.waitlist_position ?? 1 }))
      : toast.success(t("Vaga garantida!"), `${s.class_type.name} · ${shortDate(localDate(s.starts_at, club.timezone))}, ${timeRange(s, club.timezone)}`),
    onError: toast.error,
  });
  const doCancel = () => b && cancel.mutate(b.id, {
    onSuccess: () => toast.success(b.status === "waitlisted" ? t("Você saiu da fila") : t("Reserva cancelada"), b.status === "booked" ? t("Sua vaga foi liberada para outra pessoa.") : undefined),
    onError: toast.error,
  });
  return { book, cancel, doBook, doCancel };
}

function Actions({ club, s, onCheckin }: { club: Club; s: ClassSession; onCheckin: () => void }) {
  const { book, cancel, doBook, doCancel } = useSessionActions(club, s);
  const b = s.my_booking && s.my_booking.status !== "cancelled" ? s.my_booking : null;
  const past = isPast(s);
  const full = spotsLeft(s) === 0;
  if (s.status === "cancelled") return <span className="text-sm font-semibold text-danger-text">{t("Aula cancelada")}</span>;
  if (b) return (
    <>
      <BookingBadge status={b.status} position={b.waitlist_position} />
      {b.status === "booked" && checkinOpen(s) && <Button size="sm" icon={<QrCode />} onClick={onCheckin}>{t("Check-in")}</Button>}
      {(b.status === "booked" || b.status === "waitlisted") && !hasStarted(s) && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={doCancel}>{b.status === "waitlisted" ? t("Sair da fila") : t("Cancelar reserva")}</Button>}
    </>
  );
  if (past) return <span className="text-sm text-fg-muted">{t("Encerrada")}</span>;
  return <Button size="sm" variant={full ? "secondary" : "primary"} loading={book.isPending} onClick={doBook}>{full ? t("Entrar na fila") : tn(spotsLeft(s), "Reservar · {n} vaga", "Reservar · {n} vagas")}</Button>;
}

function SessionRow({ club, s, showDate, onCheckin }: { club: Club; s: ClassSession; showDate?: boolean; onCheckin: () => void }) {
  const past = isPast(s);
  const b = s.my_booking && s.my_booking.status !== "cancelled" ? s.my_booking : null;
  const [from, to] = timeRange(s, club.timezone).split("–");
  return (
    <article className={cn("relative flex flex-wrap items-center gap-x-4 gap-y-3 overflow-hidden rounded-xl border py-3 pl-4 pr-3", past ? "border-line-subtle bg-sunken" : "border-line bg-surface shadow-sm")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", sportBar[s.class_type.sport])} />
      <div className="w-16 shrink-0">
        {showDate && <div className="text-[11px] font-bold uppercase text-fg-muted">{weekdayShort(localDate(s.starts_at, club.timezone))} {dayMonth(localDate(s.starts_at, club.timezone))}</div>}
        <div className="font-display text-xl font-bold tabular-nums">{from}</div>
        <div className="text-xs text-fg-muted tabular-nums">{t("até {h}", { h: to })}</div>
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{s.class_type.name}</h4><SportChip sport={s.class_type.sport} size="sm" /></div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          {s.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{s.location.name}</span>}
          {s.instructor && <span className="inline-flex items-center gap-1.5"><Avatar name={s.instructor.name} src={s.instructor.avatar_url} size={18} />{s.instructor.name.split(" ")[0]}</span>}
        </div>
        {s.notes && <p className="mt-1 text-sm">{s.notes}</p>}
        {!b && !past && <Occupancy s={s} className="mt-2 max-w-56" />}
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto"><Actions club={club} s={s} onCheckin={onCheckin} /></div>
    </article>
  );
}

/** The class a notification links to (`?session=`): a cancelled one says so and why. */
function LinkedSession({ club, id, onClose, onCheckin }: { club: Club; id: string | null; onClose: () => void; onCheckin: (id: string) => void }) {
  const s = useSession(club.id, id);
  const x = s.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={x ? x.class_type.name : t("Aula")}
      description={x ? <span className="first-letter:uppercase">{longDate(localDate(x.starts_at, club.timezone))} · {timeRange(x, club.timezone)}</span> : undefined}>
      {s.isError ? <p role="alert" className="text-sm text-danger-text">{t("Não encontramos esta aula. Ela pode ter sido removida.")}</p> : !x ? <Skeleton className="h-24" /> : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <SportChip sport={x.class_type.sport} size="sm" />
            {x.location && <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{x.location.name}</span>}
          </div>
          {x.status === "cancelled" ? (
            <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-on-danger-soft"><CalendarX className="mt-0.5 size-4 shrink-0" aria-hidden />{x.cancel_reason ? t("Esta aula foi cancelada: {r}", { r: x.cancel_reason }) : t("Esta aula foi cancelada.")}</p>
          ) : (
            <>
              {!isPast(x) && !x.my_booking && <Occupancy s={x} />}
              <div className="flex flex-wrap items-center justify-end gap-2"><Actions club={club} s={x} onCheckin={() => onCheckin(x.id)} /></div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function History({ club, sessions }: { club: Club; sessions: ClassSession[] }) {
  const done = sessions.filter((s) => s.my_booking && ["attended", "no_show", "booked"].includes(s.my_booking.status)).reverse();
  if (!done.length) return null;
  const attended = done.filter((s) => s.my_booking?.status === "attended").length;
  return (
    <section className="grid gap-3" aria-labelledby="hist-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="hist-h" className="rf-text-title-md">{t("Histórico")}</h2><span className="text-sm text-fg-muted">{t("{a} de {n} aulas nas últimas 8 semanas", { a: attended, n: done.length })}</span></div>
      <Card className="divide-y divide-line-subtle">
        {done.slice(0, 12).map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            {s.my_booking?.status === "attended" ? <CircleCheck className="size-5 shrink-0 text-success-text" aria-hidden /> : <CalendarCheck className="size-5 shrink-0 text-fg-subtle" aria-hidden />}
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{s.class_type.name}</div><div className="text-xs text-fg-muted">{shortDate(localDate(s.starts_at, club.timezone))} · {timeRange(s, club.timezone)}</div></div>
            <BookingBadge status={s.my_booking!.status} />
          </div>
        ))}
      </Card>
    </section>
  );
}

/** Check-in by typing the code shown at the venue (the QR opens /classes/check-in instead). */
function CheckinDialog({ club, session, onClose }: { club: Club; session: string | null; onClose: () => void }) {
  return <Dialog open={!!session} onOpenChange={(v) => !v && onClose()} size="sm" title={t("Check-in")}>{session && <CheckinBody club={club} session={session} onClose={onClose} key={session} />}</Dialog>;
}
function CheckinBody({ club, session, onClose }: { club: Club; session: string; onClose: () => void }) {
  const s = useSession(club.id, session);
  const go = useCheckIn();
  const [code, setCode] = useState("");
  if (go.isSuccess) return <CheckinDone onClose={onClose} />;
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); go.mutate({ club_id: club.id, session_id: session, checkin_code: code }); }}>
      {s.isPending ? <Skeleton className="h-14" /> : s.data ? <SessionSummary club={club} s={s.data} /> : <p className="text-sm text-danger-text">{t("Não encontramos esta aula no seu clube.")}</p>}
      <label className="grid gap-1.5"><span className="rf-text-label-sm">{t("Código mostrado no local")}</span>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6))} placeholder="A1B2C3" autoFocus autoComplete="off" className="text-center font-mono text-2xl tracking-[0.3em]" />
        <span className="rf-text-caption text-fg-muted">{t("Ou aponte a câmera do celular para o QR code do local.")}</span></label>
      {go.error && <p role="alert" className="text-sm text-danger-text">{go.error instanceof ApiError ? `${go.error.title}. ${go.error.detail}` : t("Algo deu errado")}</p>}
      <Button type="submit" block size="lg" loading={go.isPending} disabled={code.length !== 6 || !s.data}>{t("Confirmar check-in")}</Button>
    </form>
  );
}

export function SessionSummary({ club, s }: { club: Pick<Club, "timezone">; s: ClassSession }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-sunken p-3">
      <span aria-hidden className={cn("h-10 w-1 shrink-0 rounded-full", sportBar[s.class_type.sport])} />
      <div className="min-w-0"><div className="font-semibold">{s.class_type.name}</div><div className="text-sm text-fg-muted">{shortDate(localDate(s.starts_at, club.timezone))} · {timeRange(s, club.timezone)}{s.location ? ` · ${s.location.name}` : ""}</div></div>
    </div>
  );
}

export function CheckinDone({ onClose }: { onClose?: () => void }) {
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-success-soft text-on-success-soft"><Check className="size-8 stroke-[3]" aria-hidden /></span>
      <p className="rf-text-title-lg">{t("Check-in feito!")}</p>
      <p className="text-fg-muted">{t("Bom treino. Sua presença já aparece para a equipe.")}</p>
      {onClose && <Button onClick={onClose}>{t("Fechar")}</Button>}
    </div>
  );
}

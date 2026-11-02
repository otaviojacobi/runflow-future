/** M1 · Hoje (student home). Route: /today */
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, CircleCheck, Coffee, Flame, MapPin, MessageSquare, QrCode, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useSessions } from "@/api/classes";
import { useMySummary, useMyWorkouts } from "@/api/my";
import type { ClassSession, PlannedWorkout } from "@/api/types";
import { BookingBadge, checkinOpen, timeRange } from "@/components/classes";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { SportChip, sportBar } from "@/components/sport";
import { IntensityProfile, Stat, StatusBadge } from "@/components/workout";
import { WeekStrip, type DayState } from "@/components/week";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, distance, duration, km, longDate, mondayOf, pace, shortDate, timeOf, today as todayFn } from "@/lib/format";
import { Button, ButtonLink, Card, Skeleton, cn } from "@/ui";
import { FEELING } from "../staff/planning/WorkoutDialogs";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };
export const dayState = (ws: PlannedWorkout[], date: string, today: string): DayState | undefined => {
  if (!ws.length) return undefined;
  const st = ws.map((w) => w.completion?.status);
  if (st.every((s) => s === "completed")) return "done";
  if (st.some((s) => s === "completed" || s === "partial")) return "partial";
  if (date < today && st.every((s) => !s || s === "missed" || s === "skipped")) return "missed";
  return "planned";
};

export function WorkoutCard({ w, clubId, onFeedback }: { w: PlannedWorkout; clubId: string; onFeedback: () => void }) {
  void clubId;
  const c = w.completion;
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2"><SportChip sport={w.sport} /><span className="text-sm text-fg-muted">{[w.est_duration_s && `≈ ${duration(w.est_duration_s)}`, w.est_distance_m && distance(w.est_distance_m, { swim: w.sport === "swim" })].filter(Boolean).join(" · ")}</span></div>
      <Link to="/workouts/$id" params={{ id: w.id }} className="rf-text-title-lg hover:underline">{w.title}</Link>
      <IntensityProfile structure={w.structure} sport={w.sport} height={52} />
      {w.notes && <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-on-brand-soft">{w.notes}</p>}
      {c ? (
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} />{c.feeling && <span className="text-sm text-fg-muted">{t(FEELING[c.feeling])}</span>}{c.rpe && <span className="text-sm text-fg-muted">· {t("PSE {n}", { n: c.rpe })}</span>}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onFeedback}>{t("Editar")}</Button></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink to="/workouts/$id" params={{ id: w.id }} variant="secondary" size="lg">{t("Ver treino")}</ButtonLink>
          <Button size="lg" icon={<CircleCheck />} onClick={onFeedback}>{t("Concluir")}</Button>
        </div>
      )}
      {w.comments_count > 0 && <Link to="/workouts/$id" params={{ id: w.id }} className="flex items-center gap-1.5 text-sm font-semibold text-brand-text"><MessageSquare className="size-4" />{w.unread_count ? tn(w.unread_count, "{n} mensagem nova do treinador", "{n} mensagens novas do treinador") : tn(w.comments_count, "{n} mensagem", "{n} mensagens")}</Link>}
    </Card>
  );
}

/** A booked class on the selected day (M6 data on M1). */
function ClassCard({ s, tz }: { s: ClassSession; tz: string }) {
  const b = s.my_booking!;
  const open = b.status === "booked" && checkinOpen(s);
  return (
    <Link to="/classes" className="relative flex items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface p-4 pl-5 shadow-sm hover:bg-soft">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", sportBar[s.class_type.sport])} />
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-soft"><CalendarClock className="size-5 text-fg-muted" /></span>
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-fg-muted">{t("Aula")} · {timeRange(s, tz)}</span><span className="block truncate font-semibold">{s.class_type.name}</span>{s.location && <span className="block truncate text-sm text-fg-muted">{s.location.name}</span>}</span>
      {open ? <span className="inline-flex h-8 items-center gap-1 rounded-md bg-brand px-3 text-sm font-semibold text-on-brand"><QrCode className="size-4" />{t("Check-in")}</span> : <BookingBadge status={b.status} position={b.waitlist_position} />}
    </Link>
  );
}

export function TodayScreen() {
  const { me, club } = useClub();
  const today = todayFn(club?.timezone);
  const monday = mondayOf(today);
  const [selected, setSelected] = useState(today);
  const [feedback, setFeedback] = useState<PlannedWorkout | null>(null);
  const week = useMyWorkouts(club?.id, monday, addDays(monday, 6));
  const summary = useMySummary(club?.id);
  const classes = useSessions(club?.id, selected, selected);
  if (!club || !me) return null;
  const myClasses = (classes.data ?? []).filter((c) => c.my_booking && c.my_booking.status !== "cancelled");
  const byDay = (d: string) => (week.data ?? []).filter((w) => w.date === d);
  const states = Object.fromEntries(Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return [d, dayState(byDay(d), d, today)]; }));
  const list = byDay(selected);
  const s = summary.data;
  const last = s?.last_activity;

  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <header className="flex items-end justify-between gap-3">
        <div><p className="text-sm text-fg-muted first-letter:uppercase">{longDate(today)}</p><h1 className="rf-text-display-sm">{t(greet())}, {me.user.name.split(" ")[0]}</h1></div>
        {s && s.streak_weeks > 0 && <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-sm font-bold text-on-accent-soft ring-1 ring-inset ring-accent-line"><Flame className="size-4" />{tn(s.streak_weeks, "{n} semana", "{n} semanas")}</span>}
      </header>
      {s && !s.shares_data && <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-on-warning-soft"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{t("Você não está compartilhando seus treinos com o clube. O treinador não vê seu progresso.")} <Link to="/account" className="font-semibold underline">{t("Ajustar")}</Link></p>}
      <WeekStrip monday={monday} states={states} selected={selected} onSelect={setSelected} />
      <section className="grid gap-3">
        <h2 className="rf-text-overline text-fg-muted">{selected === today ? t("Hoje") : shortDate(selected)}</h2>
        {week.isPending ? <Skeleton className="h-56" /> : list.length ? list.map((w) => <WorkoutCard key={w.id} w={w} clubId={club.id} onFeedback={() => setFeedback(w)} />) : (
          <Card className="flex items-center gap-4 p-5"><span className="grid size-12 place-items-center rounded-full bg-soft"><Coffee className="size-6 text-fg-muted" /></span><div><div className="font-semibold">{t("Dia de descanso")}</div><p className="text-sm text-fg-muted">{selected >= today ? t("Recuperar também é treino. Aproveite!") : t("Nenhum treino neste dia.")}</p></div></Card>
        )}
        {myClasses.map((c) => <ClassCard key={c.id} s={c} tz={club.timezone} />)}
      </section>
      {s && s.week.planned > 0 && (
        <Card className="grid gap-3 p-4">
          <div className="flex items-center justify-between"><h2 className="rf-text-title-sm">{t("Sua semana")}</h2><Link to="/schedule" className="flex items-center text-sm font-semibold text-brand-text">{t("Agenda")}<ChevronRight className="size-4" /></Link></div>
          <div className="grid grid-cols-3 gap-3">
            <Stat value={`${s.week.done}/${s.week.planned}`} label={t("Treinos feitos")} />
            <Stat value={duration(s.week.duration_s)} label={t("Tempo planejado")} />
            <Stat value={s.week.distance_m ? km(s.week.distance_m) : "–"} unit={s.week.distance_m ? "km" : undefined} label={t("Distância")} />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-brand" style={{ width: `${(s.week.done / s.week.planned) * 100}%` }} /></div>
        </Card>
      )}
      {s?.next_class && (
        <Card className="flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-on-brand-soft"><CalendarClock className="size-5" /></span>
          <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-fg-muted">{t("Próxima aula")}</div><div className="truncate font-semibold">{s.next_class.class_type.name}</div><div className="flex items-center gap-1 text-sm text-fg-muted">{shortDate(s.next_class.session.starts_at.slice(0, 10))} · {timeOf(s.next_class.session.starts_at)}{s.next_class.location && <><MapPin className="ml-1 size-3.5" />{s.next_class.location.name}</>}</div></div>
          {s.next_class.booking.status === "waitlisted" && <span className="rounded-full bg-warning-soft px-2 py-1 text-xs font-bold text-on-warning-soft">{t("Fila: {n}º", { n: s.next_class.booking.waitlist_position ?? 0 })}</span>}
        </Card>
      )}
      {last && (
        <Card className="grid gap-3 p-4">
          <div className="flex items-center justify-between"><h2 className="rf-text-title-sm">{t("Última atividade")}</h2><span className="text-xs font-semibold text-fg-muted">{last.source === "strava" ? t("via Strava") : t("manual")}</span></div>
          <div className="text-sm text-fg-muted">{last.name} · {shortDate(last.started_at.slice(0, 10))}</div>
          <div className="grid grid-cols-3 gap-3">
            {last.distance_m ? <Stat value={km(last.distance_m)} unit="km" label={t("Distância")} /> : <Stat value={duration(last.duration_s)} label={t("Tempo")} />}
            {last.avg_pace_s_per_km ? <Stat value={pace(last.avg_pace_s_per_km)} unit="/km" label={t("Pace médio")} /> : <Stat value={duration(last.duration_s)} label={t("Tempo")} />}
            {last.avg_hr ? <Stat value={String(last.avg_hr)} unit="bpm" label={t("FC média")} /> : <span />}
          </div>
        </Card>
      )}
      {feedback && <FeedbackDialog clubId={club.id} workout={feedback} open={!!feedback} onOpenChange={(v) => !v && setFeedback(null)} />}
    </div>
  );
}

/** M1 · Hoje (student home). Route: /today */
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, CircleCheck, Coffee, Flame, MapPin, MessageSquare, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { usePendingMatches } from "@/api/activities";
import { useMySummary, useMyWorkouts } from "@/api/my";
import type { Club, MySummary, PlannedWorkout } from "@/api/types";
import { BookingBadge, checkinOpen } from "@/components/classes";
import { PoweredByStrava } from "@/components/strava";
import { MatchQuestion } from "@/components/ActivityMatch";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { SportChip } from "@/components/sport";
import { IntensityProfile, Stat, StatusBadge } from "@/components/workout";
import { WeekStrip, type DayState } from "@/components/week";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { addDays, distance, duration, km, localDate, longDate, mondayOf, pace, shortDate, timeOf, today as todayFn } from "@/lib/format";
import { Button, ButtonLink, Card, Skeleton } from "@/ui";
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
      {c && !c.reported_at ? (
        // Completed by the activity matching (D-049): the PSE and how it felt are still the student's to say.
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /><span className="text-sm text-fg-muted">{t("pela sua atividade")}{c.compliance_pct != null ? ` · ${c.compliance_pct}%` : ""}</span>
          <Button size="sm" className="ml-auto" icon={<MessageSquare />} onClick={onFeedback}>{t("Conte como foi")}</Button></div>
      ) : c ? (
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} />{c.feeling && <span className="text-sm text-fg-muted">{t(FEELING[c.feeling])}</span>}{c.rpe && <span className="text-sm text-fg-muted">· {t("PSE {n}", { n: c.rpe })}</span>}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onFeedback}>{t("Editar")}</Button></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink to="/workouts/$id" params={{ id: w.id }} variant="secondary" size="lg">{t("Ver treino")}</ButtonLink>
          <Button size="lg" icon={<CircleCheck />} onClick={onFeedback}>{t("Concluir")}</Button>
        </div>
      )}
      {w.comments_count > 0 && <Link to="/workouts/$id" params={{ id: w.id }} hash="conversa" className="flex items-center gap-1.5 text-sm font-semibold text-brand-text"><MessageSquare className="size-4" />{w.unread_count ? tn(w.unread_count, "{n} mensagem nova do treinador", "{n} mensagens novas do treinador") : tn(w.comments_count, "{n} mensagem", "{n} mensagens")}</Link>}
    </Card>
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
  const pending = usePendingMatches();
  if (!club || !me) return null;
  const byDay = (d: string) => (week.data ?? []).filter((w) => w.date === d);
  const states = Object.fromEntries(Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return [d, dayState(byDay(d), d, today)]; }));
  const list = byDay(selected);
  const s = summary.data;
  // Activities, their matching questions and the last-activity card belong to the endurance modalities (D-052).
  const strava = has(club, "strava");
  const last = strava ? s?.last_activity : null;

  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <header className="flex items-end justify-between gap-3">
        <div><p className="text-sm text-fg-muted first-letter:uppercase">{longDate(today)}</p><h1 className="rf-text-display-sm">{t(greet())}, {me.user.name.split(" ")[0]}</h1></div>
        {s && s.streak_weeks > 0 && <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-sm font-bold text-on-accent-soft ring-1 ring-inset ring-accent-line"><Flame className="size-4" />{tn(s.streak_weeks, "{n} semana", "{n} semanas")}</span>}
      </header>
      {s && !s.shares_data && <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-on-warning-soft"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{t("Você não está compartilhando seus treinos com o clube. O treinador não vê seu progresso.")} <Link to="/account" className="font-semibold underline">{t("Ajustar")}</Link></p>}
      {strava && pending.data?.map((a) => <MatchQuestion key={a.id} a={a} />)}
      <WeekStrip monday={monday} states={states} selected={selected} onSelect={setSelected} />
      <section className="grid gap-3">
        <h2 className="rf-text-overline text-fg-muted">{selected === today ? t("Hoje") : shortDate(selected)}</h2>
        {week.isPending ? <Skeleton className="h-56" /> : list.length ? list.map((w) => <WorkoutCard key={w.id} w={w} clubId={club.id} onFeedback={() => setFeedback(w)} />) : (
          <Card className="flex items-center gap-4 p-5"><span className="grid size-12 place-items-center rounded-full bg-soft"><Coffee className="size-6 text-fg-muted" /></span><div><div className="font-semibold">{t("Dia de descanso")}</div><p className="text-sm text-fg-muted">{selected >= today ? t("Recuperar também é treino. Aproveite!") : t("Nenhum treino neste dia.")}</p></div></Card>
        )}
      </section>
      {has(club, "classes") && s?.next_class && <NextClass club={club} c={s.next_class} />}
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
      {last && (
        <Card className="grid gap-3 p-4">
          <div className="flex items-center justify-between"><h2 className="rf-text-title-sm">{t("Última atividade")}</h2>{last.source === "strava" ? <PoweredByStrava /> : <span className="text-xs font-semibold text-fg-muted">{t("manual")}</span>}</div>
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

/** Hoje's next class (Aulas, D-052): when, where, the booking (or waitlist place), and the check-in when it's open. */
function NextClass({ club, c }: { club: Club; c: NonNullable<MySummary["next_class"]> }) {
  const open = c.booking.status === "booked" && checkinOpen(c.session);
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between"><h2 className="rf-text-title-sm">{t("Próxima aula")}</h2><Link to="/classes" search={{}} className="flex items-center text-sm font-semibold text-brand-text">{t("Aulas")}<ChevronRight className="size-4" aria-hidden /></Link></div>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-soft"><CalendarClock className="size-5 text-fg-muted" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.class_type.name}</div>
          <div className="text-sm text-fg-muted first-letter:uppercase">{shortDate(localDate(c.session.starts_at, club.timezone))} · {timeOf(c.session.starts_at, club.timezone)}–{timeOf(c.session.ends_at, club.timezone)}</div>
          {c.location && <div className="mt-0.5 flex items-center gap-1 text-sm text-fg-muted"><MapPin className="size-3.5" aria-hidden />{c.location.name}</div>}
        </div>
        <BookingBadge status={c.booking.status} position={c.booking.waitlist_position} />
      </div>
      {open && <ButtonLink to="/classes" search={{}} block>{t("Fazer check-in")}</ButtonLink>}
    </Card>
  );
}

/** M2 · Treino (student): personal targets, notes, feedback, thread. Route: /workouts/$id */
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CircleCheck, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useMyWorkout } from "@/api/my";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { FitButton } from "@/components/FitExport";
import { SportChip } from "@/components/sport";
import { Thread } from "@/components/Thread";
import { IntensityProfile, Stat, StatusBadge } from "@/components/workout";
import { WorkoutSteps } from "@/components/WorkoutSteps";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { distance, duration, km, longDate, pace } from "@/lib/format";
import { Avatar, Button, ButtonLink, Card, Skeleton } from "@/ui";
import { FEELING } from "../staff/planning/WorkoutDialogs";

export function WorkoutScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { club, ctx } = useClub();
  const q = useMyWorkout(club?.id, id);
  const [fb, setFb] = useState(false);
  if (!club || !ctx) return null;
  const w = q.data;
  if (q.isPending) return <div className="mx-auto grid max-w-2xl gap-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64" /></div>;
  if (!w) return <p className="text-fg-muted">{t("Treino não encontrado.")}</p>;
  const c = w.completion;
  const a = w.activity;
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <ButtonLink to="/today" variant="ghost" size="sm" icon={<ArrowLeft />} className="w-fit">{t("Hoje")}</ButtonLink>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2"><SportChip sport={w.sport} /><span className="text-sm text-fg-muted first-letter:uppercase">{longDate(w.date)}</span>{c && <StatusBadge status={c.status} />}</div>
        <h1 className="rf-text-display-sm">{w.title}</h1>
        <p className="text-fg-muted">{[w.est_duration_s && `≈ ${duration(w.est_duration_s)}`, w.est_distance_m && distance(w.est_distance_m, { swim: w.sport === "swim" })].filter(Boolean).join(" · ")}</p>
      </header>
      <Card className="grid gap-4 p-4">
        <IntensityProfile structure={w.structure} sport={w.sport} height={64} />
        <WorkoutSteps structure={w.structure} sport={w.sport} />
        <p className="text-xs text-fg-muted">{t("Os ritmos e faixas de FC já são os seus, calculados pelas suas zonas.")}</p>
      </Card>
      {w.notes && (
        <Card className="flex gap-3 p-4">{w.coach && <Avatar name={w.coach.name} src={w.coach.avatar_url} size={36} />}<div><div className="text-sm font-semibold">{w.coach ? w.coach.name : t("Treinador")}</div><p className="text-fg">{w.notes}</p></div></Card>
      )}
      {c && !c.reported_at && (
        // Completed by the activity matching (D-049): the student still tells how it went.
        <Card tone="brand" className="flex flex-wrap items-center gap-3 p-4">
          <CircleCheck className="size-6 shrink-0" />
          <div className="min-w-48 flex-1"><div className="font-semibold">{a?.source === "strava" ? t("Concluído com sua atividade do Strava") : t("Concluído com sua atividade registrada")}</div><p className="text-sm">{t("Conte como foi: o esforço (PSE) e como você se sentiu ajudam seu treinador.")}</p></div>
        </Card>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="lg" icon={c && !c.reported_at ? <MessageSquare /> : <CircleCheck />} onClick={() => setFb(true)}>{!c ? t("Concluir treino") : c.reported_at ? t("Editar feedback") : t("Conte como foi")}</Button>
        <FitButton size="lg" name={w.title} sport={w.sport} structure={w.structure} />
      </div>
      {c && (c.feeling || c.comment || c.rpe) && (
        <Card className="grid gap-2 p-4"><h2 className="rf-text-title-sm">{t("Seu feedback")}</h2><div className="flex flex-wrap gap-6">{c.rpe && <Stat value={String(c.rpe)} unit="/10" label={t("Esforço (PSE)")} size="sm" />}{c.feeling && <Stat value={t(FEELING[c.feeling])} label={t("Sensação")} size="sm" />}{c.compliance_pct != null && <Stat value={`${c.compliance_pct}%`} label={t("Cumprido")} size="sm" />}</div>{c.comment && <p className="text-fg-muted">“{c.comment}”</p>}</Card>
      )}
      {a && (
        <Card className="grid gap-3 p-4"><div className="flex items-center justify-between gap-3"><h2 className="rf-text-title-sm">{t("Atividade")}</h2><span className="text-xs text-fg-muted">{a.source === "strava" ? "Strava" : t("manual")}</span><Link to="/activities/$id" params={{ id: a.id }} className="ml-auto text-sm font-semibold text-brand-text hover:underline">{t("Ver atividade")}</Link></div>
          <div className="grid grid-cols-3 gap-3">{a.distance_m ? <Stat value={km(a.distance_m)} unit="km" label={t("Distância")} /> : null}<Stat value={duration(a.duration_s)} label={t("Tempo")} />{a.avg_pace_s_per_km ? <Stat value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace")} /> : null}{a.avg_hr ? <Stat value={String(a.avg_hr)} unit="bpm" label={t("FC média")} /> : null}</div>
        </Card>
      )}
      <Card className="grid gap-3 p-4"><h2 className="rf-text-title-sm">{t("Conversa com o treinador")}</h2><Thread clubId={club.id} workoutId={w.id} meMembershipId={ctx.membership.id} placeholder={t("Dúvida sobre o treino? Escreva aqui")} /></Card>
      <FeedbackDialog clubId={club.id} workout={w} activities={w.candidate_activities} open={fb} onOpenChange={setFb} />
    </div>
  );
}

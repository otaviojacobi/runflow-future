/** M4 · Atividade (detail): stats, the matched workout, then the analysis (D-055: heart rate, per-km splits or the
 * named laps of a "tiros" session, the route). Route: /activities/$id */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Shuffle, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDeleteActivity, useMyActivity } from "@/api/activities";
import { ChangeMatchDialog, MatchQuestion } from "@/components/ActivityMatch";
import { ActivityAnalysis } from "@/components/activity/ActivityAnalysis";
import { SportChip } from "@/components/sport";
import { StravaAttribution } from "@/components/strava";
import { Stat } from "@/components/workout";
import { t } from "@/i18n";
import { distance, duration, km, localDate, longDate, pace, shortDate, timeOf } from "@/lib/format";
import { Button, ButtonLink, Card, Skeleton, toast } from "@/ui";

export function ActivityDetailScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useMyActivity(id);
  const del = useDeleteActivity();
  const navigate = useNavigate();
  const [change, setChange] = useState(false);
  const a = q.data;
  if (q.isPending) return <Skeleton className="mx-auto h-80 max-w-2xl" />;
  if (!a) return <p className="text-fg-muted">{t("Atividade não encontrada.")}</p>;
  const m = a.matched_workout;
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <ButtonLink to="/activities" variant="ghost" size="sm" icon={<ArrowLeft />} className="w-fit">{t("Atividades")}</ButtonLink>
      <header className="grid gap-2"><div className="flex flex-wrap items-center gap-2"><SportChip sport={a.sport} /><span className="text-sm text-fg-muted first-letter:uppercase">{longDate(localDate(a.started_at))} · {timeOf(a.started_at)}</span></div><h1 className="rf-text-display-sm">{a.name}</h1><p className="text-sm text-fg-muted">{a.source === "strava" ? t("Sincronizada do Strava") : t("Registrada manualmente")}</p></header>
      <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        {a.distance_m ? <Stat size="lg" value={a.sport === "swim" ? String(a.distance_m) : km(a.distance_m)} unit={a.sport === "swim" ? "m" : "km"} label={t("Distância")} /> : null}
        <Stat size="lg" value={duration(a.moving_time_s ?? a.duration_s)} label={t("Tempo em movimento")} />
        {a.avg_pace_s_per_km ? <Stat size="lg" value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace médio")} /> : null}
        {a.avg_hr ? <Stat size="lg" value={String(a.avg_hr)} unit="bpm" label={t("FC média")} /> : null}
        {a.max_hr ? <Stat value={String(a.max_hr)} unit="bpm" label={t("FC máxima")} /> : null}
        {a.elevation_gain_m ? <Stat value={String(a.elevation_gain_m)} unit="m" label={t("Ganho de elevação")} /> : null}
        {a.calories ? <Stat value={String(a.calories)} unit="kcal" label={t("Calorias")} /> : null}
      </Card>
      {a.match_state === "pending" && a.match_options.length ? <MatchQuestion a={a} withActivity={false} /> : m ? (
        <div className="grid gap-2">
          <Link to="/workouts/$id" params={{ id: m.id }} className="flex items-center gap-4 rounded-lg border border-brand-line bg-brand-soft p-4">
            <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-on-brand-soft">{t("Treino planejado")} · {shortDate(m.date)}</div><div className="truncate font-semibold text-on-brand-soft">{m.title}</div><div className="text-sm text-on-brand-soft">{t("Planejado: {x}", { x: [m.est_distance_m && distance(m.est_distance_m), m.est_duration_s && duration(m.est_duration_s)].filter(Boolean).join(" · ") })}</div></div>
            {m.compliance_pct != null && <div className="text-right"><div className="font-display text-2xl font-bold tabular-nums text-on-brand-soft">{m.compliance_pct}%</div><div className="text-xs text-on-brand-soft">{t("cumprido")}</div></div>}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
            <span className="flex-1 text-sm text-fg-muted">{m.matched_by === "student" ? t("Você escolheu este treino.") : t("Ligada automaticamente pelo dia e pelo tamanho do treino.")}</span>
            <Button variant="ghost" size="sm" icon={<Shuffle />} onClick={() => setChange(true)}>{t("Trocar treino")}</Button>
          </div>
        </div>
      ) : (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-48 flex-1 text-sm text-fg-muted">{a.match_state === "dismissed" ? t("Marcada como treino extra, fora do planejado.") : t("Nenhum treino planejado ligado a esta atividade.")}</p>
          {a.match_options.length > 0 && <Button variant="secondary" size="sm" onClick={() => setChange(true)}>{t("Escolher treino")}</Button>}
        </Card>
      )}
      <ChangeMatchDialog a={a} open={change} onOpenChange={setChange} />
      <ActivityAnalysis a={a} />
      {a.source === "strava" && <StravaAttribution externalId={a.external_id} />}
      {a.source === "manual" && <Button variant="ghost" icon={<Trash2 />} className="w-fit" loading={del.isPending} onClick={() => del.mutate(a.id, { onSuccess: () => { toast.success(t("Atividade removida")); navigate({ to: "/activities" }); }, onError: toast.error })}>{t("Remover atividade")}</Button>}
    </div>
  );
}

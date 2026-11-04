/** M4 · Atividades (list) + manual log. Route: /activities */
import { Link } from "@tanstack/react-router";
import { Activity, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useConnections } from "@/api/account";
import { useLogActivity, useMyActivities } from "@/api/activities";
import type { ActivityItem, Sport } from "@/api/types";
import { MatchQuestion } from "@/components/ActivityMatch";
import { StravaConnectPanel } from "@/components/account/StravaConnect";
import { StravaAttribution } from "@/components/strava";
import { SPORT_ICON, SPORT_LABEL, SPORTS } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { dayMonth, distance, duration, km, mondayOf, pace, shortDate, timeOf, today as todayFn, localDate, addDays } from "@/lib/format";
import { Button, Card, DateInput, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, cn, toast } from "@/ui";
import { parseClock } from "@/components/builder/BlockEditor";

const SOLID: Record<Sport, string> = { run: "bg-run text-on-run", swim: "bg-swim text-on-swim", bike: "bg-bike text-on-bike", strength: "bg-strength text-on-strength", mobility: "bg-mobility text-on-mobility", other: "bg-other text-on-other" };

export function ActivityRow({ a, to = true }: { a: ActivityItem; to?: boolean }) {
  const I = SPORT_ICON[a.sport];
  const body = (
    <>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", SOLID[a.sport])}><I className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{a.name}</span><span className="block truncate text-xs text-fg-muted">{shortDate(localDate(a.started_at))} · {timeOf(a.started_at)} · {a.source === "strava" ? "Strava" : t("manual")}{a.matched_workout ? ` · ${t("treino: {x}", { x: a.matched_workout.title })}` : ""}</span></span>
      <span className="grid shrink-0 justify-items-end text-sm tabular-nums"><b>{a.distance_m ? distance(a.distance_m, { swim: a.sport === "swim" }) : duration(a.duration_s)}</b><span className="text-xs text-fg-muted">{a.avg_pace_s_per_km && a.sport === "run" ? `${pace(a.avg_pace_s_per_km)} /km` : a.distance_m ? duration(a.duration_s) : ""}</span></span>
    </>
  );
  return to ? <Link to="/activities/$id" params={{ id: a.id }} className="flex items-center gap-3 rounded-md p-2 hover:bg-soft">{body}</Link> : <div className="flex items-center gap-3 p-2">{body}</div>;
}

function LogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const log = useLogActivity();
  const [sport, setSport] = useState<Sport>("run");
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayFn());
  const [time, setTime] = useState("06:30");
  const [dur, setDur] = useState("");
  const [dist, setDist] = useState("");
  const [hr, setHr] = useState("");
  const err = log.error instanceof ApiError ? log.error : null;
  const submit = () => {
    const s = parseClock(dur);
    const m = dist ? Math.round(Number(dist.replace(",", ".")) * (sport === "swim" ? 1 : 1000)) : null;
    log.mutate({ sport, name: name || t(SPORT_LABEL[sport]), started_at: new Date(`${date}T${time}:00-03:00`).toISOString(), duration_s: s ?? 0, distance_m: m, avg_hr: hr ? Number(hr) : null }, {
      onSuccess: () => { toast.success(t("Atividade registrada")); onOpenChange(false); setDur(""); setDist(""); setName(""); setHr(""); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Registrar atividade")} description={t("Para treinos sem relógio ou fora do Strava.")}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button loading={log.isPending} onClick={submit}>{t("Salvar")}</Button></>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Modalidade")}>{(id) => <Select id={id} value={sport} onChange={(e) => setSport(e.target.value as Sport)}>{SPORTS.map((s) => <option key={s} value={s}>{t(SPORT_LABEL[s])}</option>)}</Select>}</Field>
          <Field label={t("Nome")} optional>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Corrida no parque")} />}</Field>
          <Field label={t("Data")} error={err?.fieldError("started_at")}>{(id) => <DateInput id={id} value={date} onChange={setDate} />}</Field>
          <Field label={t("Hora")}>{(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
          <Field label={t("Duração")} error={err?.fieldError("duration_s")} hint={t("Minutos ou h:mm:ss")}>{(id, d) => <Input id={id} aria-describedby={d} value={dur} onChange={(e) => setDur(e.target.value)} placeholder="45" inputMode="numeric" />}</Field>
          <Field label={sport === "swim" ? t("Distância (m)") : t("Distância (km)")} optional>{(id) => <Input id={id} value={dist} onChange={(e) => setDist(e.target.value)} placeholder={sport === "swim" ? "1500" : "8,5"} inputMode="decimal" />}</Field>
          <Field label={t("FC média (bpm)")} optional>{(id) => <Input id={id} value={hr} onChange={(e) => setHr(e.target.value)} inputMode="numeric" />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

export function ActivitiesScreen() {
  const list = useMyActivities();
  const conns = useConnections();
  const [log, setLog] = useState(false);
  const strava = conns.data?.find((c) => c.provider === "strava")?.connection;
  const weeks = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const a of list.data ?? []) { const k = mondayOf(localDate(a.started_at)); m.set(k, [...(m.get(k) ?? []), a]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [list.data]);
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <PageHeader title={t("Atividades")} actions={<Button icon={<Plus />} onClick={() => setLog(true)}>{t("Registrar")}</Button>} />
      {conns.data && !strava && (
        <Card className="grid gap-4 p-4"><div className="flex items-center gap-3"><Activity className="size-6 shrink-0 text-fg-muted" /><p className="min-w-0 flex-1 text-sm">{t("Conecte o Strava e suas atividades chegam sozinhas, já ligadas aos treinos.")}</p></div><StravaConnectPanel /></Card>
      )}
      {list.isPending ? <Skeleton className="h-64" /> : weeks.length === 0 ? (
        <Card><EmptyState icon={<Activity />} title={t("Nenhuma atividade ainda")} action={<Button icon={<Plus />} onClick={() => setLog(true)}>{t("Registrar atividade")}</Button>}>{t("Quando você treinar com o Strava conectado, elas aparecem aqui.")}</EmptyState></Card>
      ) : weeks.map(([mon, acts]) => {
        const dm = acts.reduce((s, a) => s + (a.distance_m && a.sport !== "swim" ? a.distance_m : 0), 0);
        const ds = acts.reduce((s, a) => s + a.duration_s, 0);
        return (
          <section key={mon} className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1"><h2 className="text-sm font-bold">{mon === mondayOf(todayFn()) ? t("Esta semana") : `${dayMonth(mon)} – ${dayMonth(addDays(mon, 6))}`}</h2><span className="text-xs text-fg-muted tabular-nums">{tn(acts.length, "{n} atividade", "{n} atividades")} · {duration(ds)}{dm ? ` · ${km(dm)} km` : ""}</span></div>
            <Card className="divide-y divide-line-subtle p-1">{acts.map((a) => a.match_state === "pending" && a.match_options.length ? (
              <div key={a.id}><ActivityRow a={a} /><MatchQuestion a={a} embedded withActivity={false} heading="h3" /></div>
            ) : <ActivityRow key={a.id} a={a} />)}</Card>
          </section>
        );
      })}
      {list.data?.some((a) => a.source === "strava") && <StravaAttribution className="px-1" />}
      <LogDialog open={log} onOpenChange={setLog} />
    </div>
  );
}

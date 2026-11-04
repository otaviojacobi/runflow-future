/** W3 · Aluno (trainer view): overview, month calendar, zones, profile + private notes. Route: /students/$id */
import { useParams } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, MessageCircle, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAthlete, useSaveAthleteProfile, useSetZones } from "@/api/activities";
import type { AthleteDetail, Goal, Level } from "@/api/types";
import { usePlanned } from "@/api/workouts";
import { StudentGroups } from "@/components/club/GroupPicker";
import { StravaAttribution } from "@/components/strava";
import { sportBar } from "@/components/sport";
import { ComplianceBar, Stat, ZoneTable } from "@/components/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { addDays, brDate, dayMonth, duration, km, mondayOf, pace, today as todayFn } from "@/lib/format";
import { Avatar, Badge, Button, ButtonLink, Card, DateInput, Field, IconButton, Input, Select, Skeleton, Tabs, Textarea, cn, toast } from "@/ui";
import { GOALS, LEVELS, parseTime } from "../onboarding/Welcome";
import { ActivityRow } from "../student/Activities";
import { AssignDialog } from "./planning/AssignDialog";
import { DetailDialog, EditDialog } from "./planning/WorkoutDialogs";
import { goalLabel } from "./Students";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Weekly volume: done (solid) vs planned (outline). Two series → legend present. */
function VolumeChart({ weeks }: { weeks: AthleteDetail["weekly"] }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.done_s, w.planned_s)));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure className="grid gap-2">
      <div className="flex gap-4 text-xs text-fg-muted"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-brand-text" />{t("Feito")}</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] border-2 border-line-strong" />{t("Planejado")}</span></div>
      <div className="flex h-36 items-end gap-[2px]" aria-hidden>
        {weeks.map((w, i) => (
          <div key={w.week_start} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="absolute bottom-0 w-full max-w-7 rounded-t-[4px] border-2 border-b-0 border-line-strong" style={{ height: `${(w.planned_s / max) * 100}%` }} />
            <div className={cn("relative w-full max-w-7 rounded-t-[4px] bg-brand-text", w.current && "opacity-60")} style={{ height: `${Math.max(1, (w.done_s / max) * 100)}%` }} />
            {hover === i && <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md bg-inverse px-2.5 py-1.5 text-xs text-fg-inverse shadow-md"><div className="font-semibold">{t("Semana de {d}", { d: dayMonth(w.week_start) })}</div><div className="tabular-nums">{t("Feito: {a} · Planejado: {b}", { a: duration(w.done_s), b: duration(w.planned_s) })}</div>{w.distance_m > 0 && <div className="tabular-nums opacity-80">{km(w.distance_m)} km · {w.sessions} {t("sessões")}</div>}</div>}
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] text-[10px] text-fg-subtle" aria-hidden>{weeks.map((w) => <span key={w.week_start} className="flex-1 text-center tabular-nums">{w.week_start.slice(8)}/{w.week_start.slice(5, 7)}</span>)}</div>
      <table className="sr-only"><caption>{t("Volume semanal")}</caption><tbody>{weeks.map((w) => <tr key={w.week_start}><td>{brDate(w.week_start)}</td><td>{duration(w.done_s)}</td><td>{duration(w.planned_s)}</td></tr>)}</tbody></table>
    </figure>
  );
}

function MonthCalendar({ clubId, athleteId, onOpen }: { clubId: string; athleteId: string; onOpen: (id: string) => void }) {
  const today = todayFn();
  const [anchor, setAnchor] = useState(today.slice(0, 8) + "01");
  const first = mondayOf(anchor);
  const last = addDays(mondayOf(addDays(anchor.slice(0, 8) + "28", 7)), 6);
  const q = usePlanned(clubId, { from: first, to: last, athlete_id: athleteId });
  const days = Array.from({ length: Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1 }, (_, i) => addDays(first, i));
  const move = (dir: number) => { const [y, m] = anchor.split("-").map(Number); setAnchor(new Date(Date.UTC(y!, m! - 1 + dir, 1)).toISOString().slice(0, 10)); };
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2"><IconButton variant="secondary" label={t("Mês anterior")} onClick={() => move(-1)}><ChevronLeft /></IconButton><span className="min-w-36 text-center font-semibold first-letter:uppercase">{MONTHS[Number(anchor.slice(5, 7)) - 1]} {anchor.slice(0, 4)}</span><IconButton variant="secondary" label={t("Próximo mês")} onClick={() => move(1)}><ChevronRight /></IconButton></div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 bg-sunken text-center text-[11px] font-bold uppercase text-fg-muted">{["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => <span key={d} className="py-2">{t(d)}</span>)}</div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const ws = (q.data ?? []).filter((w) => w.date === d);
            return (
              <div key={d} className={cn("min-h-24 border-t border-l border-line-subtle p-1 [&:nth-child(7n+1)]:border-l-0", d.slice(5, 7) !== anchor.slice(5, 7) && "bg-sunken/60", d === today && "bg-brand-soft")}>
                <div className="px-1 text-xs font-bold tabular-nums text-fg-muted">{Number(d.slice(8))}</div>
                <div className="grid gap-1">{ws.map((w) => (
                  <button key={w.id} onClick={() => onOpen(w.id)} title={w.title} className={cn("relative truncate rounded-[6px] bg-soft py-0.5 pl-2 pr-1 text-left text-[10.5px] font-semibold hover:bg-line", w.completion?.status === "missed" && "text-danger-text line-through", w.completion?.status === "completed" && "text-success-text")}>
                    <span className={cn("absolute inset-y-0 left-0 w-[3px] rounded-l-[6px]", sportBar[w.sport])} />{w.title}
                  </button>
                ))}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function ZonesTab({ a, clubId }: { a: AthleteDetail; clubId: string }) {
  const set = useSetZones(clubId, a.membership.id);
  const [thr, setThr] = useState(a.profile.threshold_pace_s_per_km ? pace(a.profile.threshold_pace_s_per_km) : "");
  const [race, setRace] = useState({ m: 10000, time: "" });
  const [maxHr, setMaxHr] = useState(String(a.profile.max_hr ?? ""));
  const paceZ = a.zones.find((z) => z.kind === "pace");
  const hrZ = a.zones.find((z) => z.kind === "hr");
  const err = set.error instanceof ApiError ? set.error : null;
  const savePace = (body: Parameters<typeof set.mutate>[0]) => set.mutate(body, { onSuccess: () => toast.success(t("Zonas atualizadas"), t("Os treinos do aluno já usam os novos ritmos.")), onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="grid content-start gap-4 p-5">
        <div><h3 className="rf-text-title-md">{t("Zonas de pace")}</h3><p className="text-sm text-fg-muted">{paceZ ? t("Fonte: {s} · desde {d}", { s: t({ race: "prova", test: "teste", manual: "manual", estimated: "estimativa" }[paceZ.source]), d: dayMonth(paceZ.valid_from) }) : t("Ainda sem zonas.")}</p></div>
        {paceZ && <ZoneTable z={paceZ} unit="pace" />}
        <div className="grid gap-3 border-t border-line-subtle pt-4">
          <div className="flex items-end gap-2"><Field label={t("Pace de limiar (/km)")} error={err?.fieldError("threshold_pace_s_per_km")} className="flex-1">{(id) => <Input id={id} value={thr} onChange={(e) => setThr(e.target.value)} placeholder="4:30" />}</Field>
            <Button variant="secondary" loading={set.isPending} onClick={() => { const m = thr.match(/^(\d{1,2}):(\d{2})$/); if (m) savePace({ kind: "pace", threshold_pace_s_per_km: Number(m[1]) * 60 + Number(m[2]) }); }}>{t("Calcular")}</Button></div>
          <div className="flex items-end gap-2">
            <Field label={t("Ou a partir de uma prova")} className="w-28">{(id) => <Select id={id} value={race.m} onChange={(e) => setRace({ ...race, m: Number(e.target.value) })}>{[5000, 10000, 21097, 42195].map((m) => <option key={m} value={m}>{m === 21097 ? "21 km" : m === 42195 ? "42 km" : `${m / 1000} km`}</option>)}</Select>}</Field>
            <Input aria-label={t("Tempo da prova")} placeholder="52:30" value={race.time} onChange={(e) => setRace({ ...race, time: e.target.value })} className="flex-1" />
            <Button variant="secondary" loading={set.isPending} onClick={() => { const s = parseTime(race.time); if (s) savePace({ kind: "pace", race: { distance_m: race.m, time_s: s } }); }}>{t("Calcular")}</Button>
          </div>
        </div>
      </Card>
      <Card className="grid content-start gap-4 p-5">
        <div><h3 className="rf-text-title-md">{t("Zonas de frequência cardíaca")}</h3><p className="text-sm text-fg-muted">{hrZ ? t("Pela FC máxima de {n} bpm", { n: hrZ.bounds[4]!.max }) : t("Ainda sem zonas.")}</p></div>
        {hrZ && <ZoneTable z={hrZ} unit="hr" />}
        <div className="flex items-end gap-2 border-t border-line-subtle pt-4"><Field label={t("FC máxima (bpm)")} error={err?.fieldError("max_hr")} className="flex-1">{(id) => <Input id={id} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} inputMode="numeric" />}</Field>
          <Button variant="secondary" loading={set.isPending} onClick={() => savePace({ kind: "hr", max_hr: Number(maxHr) })}>{t("Calcular")}</Button></div>
      </Card>
    </div>
  );
}

/** `races`/`zones`: the race date and heart rate only for the club's modalities (D-052). */
function ProfileTab({ a, clubId, races, zones }: { a: AthleteDetail; clubId: string; races: boolean; zones: boolean }) {
  const save = useSaveAthleteProfile(clubId, a.membership.id);
  const [p, setP] = useState(a.profile);
  useEffect(() => setP(a.profile), [a.profile]);
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP({ ...p, [k]: v });
  return (
    <Card className="grid gap-4 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Objetivo")}>{(id) => <Select id={id} value={p.goal ?? ""} onChange={(e) => set("goal", (e.target.value || null) as Goal | null)}><option value="">–</option>{GOALS.map((g) => <option key={g.value} value={g.value}>{t(g.label)}</option>)}</Select>}</Field>
        {races && <Field label={t("Data da prova-alvo")} optional>{(id) => <DateInput id={id} value={p.goal_date ?? ""} onChange={(v) => set("goal_date", v || null)} />}</Field>}
        <Field label={t("Nível")}>{(id) => <Select id={id} value={p.level ?? ""} onChange={(e) => set("level", (e.target.value || null) as Level | null)}><option value="">–</option>{LEVELS.map((l) => <option key={l.value} value={l.value}>{t(l.label)}</option>)}</Select>}</Field>
        <Field label={t("Treinos por semana")}>{(id) => <Input id={id} type="number" min={0} max={14} value={p.weekly_sessions ?? ""} onChange={(e) => set("weekly_sessions", e.target.value ? Number(e.target.value) : null)} />}</Field>
        {zones && <>
          <Field label={t("FC de repouso")} optional>{(id) => <Input id={id} type="number" value={p.resting_hr ?? ""} onChange={(e) => set("resting_hr", e.target.value ? Number(e.target.value) : null)} />}</Field>
          <Field label={t("FC máxima")} optional>{(id) => <Input id={id} type="number" value={p.max_hr ?? ""} onChange={(e) => set("max_hr", e.target.value ? Number(e.target.value) : null)} />}</Field>
        </>}
      </div>
      <Field label={<span className="inline-flex items-center gap-1.5">{t("Notas do treinador")}<Lock className="size-3.5 text-fg-muted" /></span>} hint={t("Só a equipe do clube vê. O aluno não tem acesso.")}>
        {(id, d) => <Textarea id={id} aria-describedby={d} value={p.trainer_notes ?? ""} onChange={(e) => set("trainer_notes", e.target.value)} placeholder={t("Ex.: lesão no joelho em 2025, prefere treinar cedo")} />}
      </Field>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate(p, { onSuccess: () => toast.success(t("Perfil salvo")), onError: toast.error })}>{t("Salvar perfil")}</Button></div>
    </Card>
  );
}

export function StudentScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { club } = useClub();
  const q = useAthlete(club?.id, id);
  const [assign, setAssign] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const a = q.data;
  const last4 = useMemo(() => (a?.weekly ?? []).slice(-5, -1), [a]);
  if (!club) return null;
  if (q.isPending) return <div className="mx-auto grid max-w-6xl gap-4"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>;
  if (!a) return <p className="text-fg-muted">{t("Aluno não encontrado.")}</p>;
  const phone = a.user.phone?.replace(/\D/g, "");
  const avgWeek = last4.length ? last4.reduce((s, w) => s + w.done_s, 0) / last4.length : 0;
  // Activities (volume, recent list, Strava state) and zones only where the club's modalities use them (D-052).
  const strava = has(club, "strava"), zones = has(club, "zones");
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <ButtonLink to="/students" variant="ghost" size="sm" icon={<ArrowLeft />} className="w-fit">{t("Alunos")}</ButtonLink>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={a.user.name} src={a.user.avatar_url} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="rf-text-display-sm">{a.user.name}</h1>
          <p className="text-fg-muted">{[a.goal === "other" && a.profile.goal_note ? a.profile.goal_note : goalLabel(a.goal), has(club, "races") && a.profile.goal_date && t("prova em {d}", { d: dayMonth(a.profile.goal_date) }), a.level && t({ beginner: "Iniciante", intermediate: "Intermediário", advanced: "Avançado" }[a.level])].filter(Boolean).join(" · ") || t("Sem objetivo definido")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.consents.training_data ? <Badge tone="success" icon={<ShieldCheck />}>{t("Compartilha dados")}</Badge> : <Badge tone="warning" icon={<ShieldOff />}>{t("Não compartilha os treinos")}</Badge>}
            {strava && a.strava !== "none" && <Badge tone={a.strava === "shared" ? "info" : "neutral"}>{a.strava === "shared" ? t("Strava compartilhado") : t("Não compartilha o Strava")}</Badge>}
          </div>
          <div className="mt-3"><StudentGroups clubId={club.id} membershipId={a.membership.id} studentName={a.user.name.split(" ")[0]} groups={a.groups} /></div>
        </div>
        <div className="flex gap-2">
          {phone && <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-[15px] font-semibold shadow-sm hover:bg-soft"><MessageCircle className="size-[18px]" />WhatsApp</a>}
          <Button icon={<Plus />} onClick={() => setAssign(true)}>{t("Atribuir treino")}</Button>
        </div>
      </header>
      <Tabs.Root defaultValue="overview">
        <Tabs.List><Tabs.Trigger value="overview">{t("Visão geral")}</Tabs.Trigger><Tabs.Trigger value="calendar">{t("Calendário")}</Tabs.Trigger>{zones && <Tabs.Trigger value="zones">{t("Zonas")}</Tabs.Trigger>}<Tabs.Trigger value="profile">{t("Perfil e notas")}</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="overview">
          <div className={cn("grid gap-5", strava && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
            <div className="grid content-start gap-5">
              <div className={cn("grid grid-cols-2 gap-3", strava && zones ? "sm:grid-cols-4" : strava || zones ? "sm:grid-cols-3" : "")}>
                <Card className="p-4"><div className="mb-2 text-sm text-fg-muted">{t("Aderência 28 dias")}</div><ComplianceBar pct={a.compliance_pct} /></Card>
                <Card className="p-4"><Stat value={`${a.week.done}/${a.week.planned}`} label={t("Nesta semana")} /></Card>
                {strava && <Card className="p-4"><Stat value={duration(avgWeek)} label={t("Média semanal (4 sem.)")} /></Card>}
                {zones && <Card className="p-4"><Stat value={a.profile.threshold_pace_s_per_km ? pace(a.profile.threshold_pace_s_per_km) : "–"} unit={a.profile.threshold_pace_s_per_km ? "/km" : undefined} label={t("Pace de limiar")} /></Card>}
              </div>
              {strava && <Card className="grid gap-3 p-5"><h2 className="rf-text-title-md">{t("Volume semanal")}</h2><VolumeChart weeks={a.weekly} /></Card>}
            </div>
            {strava && <Card className="grid content-start gap-2 p-4">
              <h2 className="px-2 rf-text-title-md">{t("Atividades recentes")}</h2>
              {!a.consents.training_data ? <p className="px-2 text-sm text-fg-muted">{t("O aluno não compartilha os dados de treino com o clube.")}</p> : a.recent_activities.length ? <>{a.recent_activities.map((x) => <ActivityRow key={x.id} a={x} to={false} />)}{a.recent_activities.some((x) => x.source === "strava") && <StravaAttribution className="px-2 pt-2" />}</> : <p className="px-2 text-sm text-fg-muted">{t("Nenhuma atividade sincronizada.")}</p>}
            </Card>}
          </div>
        </Tabs.Content>
        <Tabs.Content value="calendar"><MonthCalendar clubId={club.id} athleteId={a.membership.id} onOpen={setDetail} /></Tabs.Content>
        {zones && <Tabs.Content value="zones"><ZonesTab a={a} clubId={club.id} /></Tabs.Content>}
        <Tabs.Content value="profile"><ProfileTab a={a} clubId={club.id} races={has(club, "races")} zones={zones} /></Tabs.Content>
      </Tabs.Root>
      <AssignDialog club={club} monday={mondayOf(todayFn())} open={assign} onOpenChange={setAssign} prefill={{ athleteIds: [a.membership.id] }} />
      <DetailDialog club={club} id={detail} onClose={() => setDetail(null)} onEdit={(x) => { setDetail(null); setEdit(x); }} />
      <EditDialog club={club} id={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

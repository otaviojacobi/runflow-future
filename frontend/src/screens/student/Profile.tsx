/** M7 · Perfil de atleta: goal, level, availability, recent race, heart rate; zones (read-only, set by the trainer). Route: /account/profile */
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Gauge, HeartPulse, Info } from "lucide-react";
import { useState } from "react";
import { useMyProfile, useSaveMyProfile } from "@/api/account";
import { useMyAssessments } from "@/api/assessments";
import { ASSESSMENT_NAME, headline } from "@/components/assessments";
import type { AthleteProfile, Goal, Level } from "@/api/types";
import { ZoneTable } from "@/components/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { clock, fullDate, pace } from "@/lib/format";
import { Button, Card, Field, Input, PageHeader, Select, Skeleton, toast } from "@/ui";
import { GOALS, LEVELS, parseTime } from "../onboarding/Welcome";

const RACES = [{ m: 5000, label: "5 km" }, { m: 10000, label: "10 km" }, { m: 21097, label: "Meia maratona" }, { m: 42195, label: "Maratona" }];

export function ProfileScreen() {
  const { club } = useClub();
  const p = useMyProfile(club?.id);
  if (!club) return null;
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link to="/account" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("Minha conta")}</Link>
      <PageHeader title={t("Perfil de atleta")} subtitle={t("Ajuda {who} a montar treinos do seu jeito em {club}.", { who: club.trainer_label === "professor" ? t("seu professor") : t("seu treinador"), club: club.name })} />
      {!p.data ? <Skeleton className="h-96" /> : <><Form clubId={club.id} p={p.data} key={p.data.updated_at} /><Zones p={p.data} label={club.trainer_label} /><MyAssessments clubId={club.id} /></>}
    </div>
  );
}

function Form({ clubId, p }: { clubId: string; p: AthleteProfile }) {
  const save = useSaveMyProfile(clubId);
  const [v, setV] = useState({
    goal: p.goal ?? "", goal_note: p.goal_note ?? "", goal_date: p.goal_date ?? "", level: p.level ?? "", weekly_sessions: p.weekly_sessions?.toString() ?? "",
    race_m: p.recent_race?.distance_m ?? 10000, race_time: p.recent_race ? clock(p.recent_race.time_s) : "", max_hr: p.max_hr?.toString() ?? "", resting_hr: p.resting_hr?.toString() ?? "",
  });
  const set = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const err = save.error instanceof ApiError ? save.error : null;
  const raceS = v.race_time ? parseTime(v.race_time) : null;
  const submit = () => save.mutate({
    goal: (v.goal || null) as Goal | null, goal_note: v.goal === "other" ? v.goal_note.trim() || null : null, goal_date: v.goal_date || null, level: (v.level || null) as Level | null,
    weekly_sessions: v.weekly_sessions ? Number(v.weekly_sessions) : null,
    recent_race: raceS ? { distance_m: v.race_m, time_s: raceS } : null,
    max_hr: v.max_hr ? Number(v.max_hr) : null, resting_hr: v.resting_hr ? Number(v.resting_hr) : null,
  }, { onSuccess: () => toast.success(t("Perfil salvo"), t("Seu treinador já vê as mudanças.")) });
  return (
    <Card className="p-5 sm:p-6">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="rf-text-title-md sm:col-span-2">{t("Objetivo e rotina")}</h2>
        <Field label={t("Objetivo")} error={err?.fieldError("goal")}>{(id) => <Select id={id} value={v.goal} onChange={(e) => set({ goal: e.target.value })}><option value="">{t("Escolha…")}</option>{GOALS.map((g) => <option key={g.value} value={g.value}>{t(g.label)}</option>)}</Select>}</Field>
        {v.goal === "other" && (
          <Field label={t("Qual é o seu objetivo?")} error={err?.fieldError("goal_note")} className="sm:col-span-2">{(id) => <Input id={id} value={v.goal_note} onChange={(e) => set({ goal_note: e.target.value })} maxLength={120} placeholder={t("Ex.: voltar a correr depois de uma lesão")} />}</Field>
        )}
        <Field label={t("Data da prova")} optional error={err?.fieldError("goal_date")}>{(id) => <Input id={id} type="date" value={v.goal_date} onChange={(e) => set({ goal_date: e.target.value })} />}</Field>
        <Field label={t("Nível")} error={err?.fieldError("level")}>{(id) => <Select id={id} value={v.level} onChange={(e) => set({ level: e.target.value })}><option value="">{t("Escolha…")}</option>{LEVELS.map((l) => <option key={l.value} value={l.value}>{t(l.label)}</option>)}</Select>}</Field>
        <Field label={t("Treinos por semana")} error={err?.fieldError("weekly_sessions")}>{(id) => <Input id={id} type="number" min={0} max={14} value={v.weekly_sessions} onChange={(e) => set({ weekly_sessions: e.target.value })} />}</Field>

        <h2 className="mt-2 rf-text-title-md sm:col-span-2">{t("Prova recente")}</h2>
        <Field label={t("Distância")}>{(id) => <Select id={id} value={v.race_m} onChange={(e) => set({ race_m: Number(e.target.value) })}>{RACES.map((r) => <option key={r.m} value={r.m}>{t(r.label)}</option>)}</Select>}</Field>
        <Field label={t("Tempo")} optional error={err?.fieldError("recent_race") ?? (v.race_time && !raceS ? t("Use o formato 52:30 ou 1:45:10.") : null)} hint={t("Usamos para estimar seu ritmo de limiar.")}>{(id, d) => <Input id={id} aria-describedby={d} value={v.race_time} onChange={(e) => set({ race_time: e.target.value })} placeholder="52:30" inputMode="numeric" />}</Field>

        <h2 className="mt-2 rf-text-title-md sm:col-span-2">{t("Frequência cardíaca")}</h2>
        <Field label={t("FC máxima (bpm)")} optional>{(id) => <Input id={id} type="number" min={120} max={230} value={v.max_hr} onChange={(e) => set({ max_hr: e.target.value })} />}</Field>
        <Field label={t("FC de repouso (bpm)")} optional>{(id) => <Input id={id} type="number" min={30} max={110} value={v.resting_hr} onChange={(e) => set({ resting_hr: e.target.value })} />}</Field>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={save.isPending} disabled={!!v.race_time && !raceS}>{t("Salvar perfil")}</Button></div>
      </form>
    </Card>
  );
}

function Zones({ p, label }: { p: AthleteProfile; label: "treinador" | "professor" }) {
  const paceZ = p.zones?.find((z) => z.kind === "pace"), hrZ = p.zones?.find((z) => z.kind === "hr");
  const who = label === "professor" ? t("seu professor") : t("seu treinador");
  return (
    <section className="grid gap-3" aria-labelledby="zones-h">
      <div><h2 id="zones-h" className="rf-text-title-md">{t("Suas zonas")}</h2><p className="flex items-center gap-1.5 text-sm text-fg-muted"><Info className="size-4 shrink-0" />{t("Definidas por {who}. Os treinos usam esses valores para mostrar seus ritmos.", { who })}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="grid content-start gap-2 p-5">
          <h3 className="flex items-center gap-2 font-semibold"><Gauge className="size-4" />{t("Ritmo")}</h3>
          {paceZ ? <><p className="text-xs text-fg-muted">{t("Desde {d}", { d: fullDate(paceZ.valid_from) })}{p.threshold_pace_s_per_km ? ` · ${t("limiar {p} /km", { p: pace(p.threshold_pace_s_per_km) })}` : ""}</p><ZoneTable z={paceZ} unit="pace" /></> : <p className="text-sm text-fg-muted">{t("Ainda sem zonas de ritmo. Informe uma prova recente para {who} calcular.", { who })}</p>}
        </Card>
        <Card className="grid content-start gap-2 p-5">
          <h3 className="flex items-center gap-2 font-semibold"><HeartPulse className="size-4" />{t("Frequência cardíaca")}</h3>
          {hrZ ? <><p className="text-xs text-fg-muted">{t("Desde {d}", { d: fullDate(hrZ.valid_from) })}</p><ZoneTable z={hrZ} unit="hr" /></> : <p className="text-sm text-fg-muted">{t("Ainda sem zonas de FC. Informe sua FC máxima.")}</p>}
        </Card>
      </div>
    </section>
  );
}

function MyAssessments({ clubId }: { clubId: string }) {
  const list = useMyAssessments(clubId);
  if (!list.data?.length) return null;
  return (
    <section className="grid gap-3" aria-labelledby="as-h">
      <h2 id="as-h" className="rf-text-title-md">{t("Suas avaliações")}</h2>
      <Card className="divide-y divide-line-subtle">
        {list.data.map((a) => (
          <div key={a.id} className="grid gap-0.5 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{t(ASSESSMENT_NAME[a.kind])}</span><span className="text-xs text-fg-muted">{fullDate(a.date)}</span></div>
            <span className="text-sm tabular-nums">{headline(a.kind, a.result, a.data).text}</span>
          </div>
        ))}
      </Card>
    </section>
  );
}

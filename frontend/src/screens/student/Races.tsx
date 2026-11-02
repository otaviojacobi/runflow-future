/** M9 · Provas: goal race countdown, my entries, club calendar sign-up, results. Route: /races */
import { ExternalLink, Flag, MapPin, Pencil, Star, Trophy } from "lucide-react";
import { useState } from "react";
import { useJoinRace, useLeaveRace, useRaces, useUpdateEntry } from "@/api/races";
import type { Club, Race, RaceEntry } from "@/api/types";
import { DateTile, EntryBadge, RACE_SPORT_LABEL, countdown, distanceLabel, racePace, raceWhere } from "@/components/races";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { clock, daysBetween, longDate, today as todayFn } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, toast } from "@/ui";
import { parseTime } from "../onboarding/Welcome";

export function RacesScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const races = useRaces(club?.id);
  const [join, setJoin] = useState<Race | null>(null);
  const [result, setResult] = useState<Race | null>(null);
  if (!club) return null;
  const all = races.data ?? [];
  const upcoming = all.filter((r) => r.date >= today);
  const mine = upcoming.filter((r) => r.my_entry);
  const open = upcoming.filter((r) => !r.my_entry);
  const past = all.filter((r) => r.date < today && r.my_entry).reverse();
  const goal = mine.find((r) => r.my_entry?.is_goal);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={t("Provas")} subtitle={t("O calendário da equipe, suas inscrições e seus resultados")} />
      {races.isPending ? <Skeleton className="h-64" /> : (
        <>
          {goal && <GoalHero race={goal} today={today} onEdit={() => setJoin(goal)} />}
          <section className="grid gap-3" aria-labelledby="mine-h">
            <h2 id="mine-h" className="rf-text-title-md">{t("Minhas inscrições")}</h2>
            {mine.length === 0 ? <p className="rounded-lg bg-sunken px-4 py-5 text-center text-fg-muted">{t("Você ainda não está inscrito em nenhuma prova.")}</p> : (
              <ul className="grid gap-2">{mine.map((r) => <li key={r.id}><RaceRow r={r} today={today} action={<Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setJoin(r)}>{t("Editar")}</Button>} /></li>)}</ul>
            )}
          </section>
          <section className="grid gap-3" aria-labelledby="cal-h">
            <h2 id="cal-h" className="rf-text-title-md">{t("Calendário do clube")}</h2>
            {open.length === 0 ? <Card><EmptyState icon={<Flag />} title={t("Nenhuma outra prova marcada")}>{t("Quando {club} adicionar provas, elas aparecem aqui.", { club: club.name })}</EmptyState></Card> : (
              <ul className="grid gap-2">{open.map((r) => <li key={r.id}><RaceRow r={r} today={today} action={<Button size="sm" onClick={() => setJoin(r)}>{t("Quero participar")}</Button>} /></li>)}</ul>
            )}
          </section>
          {past.length > 0 && (
            <section className="grid gap-3" aria-labelledby="res-h">
              <h2 id="res-h" className="rf-text-title-md">{t("Resultados")}</h2>
              <ul className="grid gap-2">{past.map((r) => <li key={r.id}><RaceRow r={r} today={today} action={r.my_entry!.status === "registered" ? <Button size="sm" variant="secondary" icon={<Trophy />} onClick={() => setResult(r)}>{t("Registrar resultado")}</Button> : <Button size="sm" variant="ghost" onClick={() => setResult(r)}>{t("Editar")}</Button>} /></li>)}</ul>
            </section>
          )}
        </>
      )}
      <JoinDialog club={club} race={join} onClose={() => setJoin(null)} />
      <ResultDialog club={club} race={result} onClose={() => setResult(null)} />
    </div>
  );
}

function GoalHero({ race, today, onEdit }: { race: Race; today: string; onEdit: () => void }) {
  const e = race.my_entry!;
  const days = daysBetween(today, race.date);
  const p = racePace(e.goal_time_s, e.distance_m, race.sport);
  return (
    <Card tone="accent" className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
      <div className="grid justify-items-center rounded-xl bg-surface px-5 py-3 text-fg shadow-sm">
        <span className="font-display text-4xl font-bold tabular-nums leading-none [font-stretch:110%]">{days}</span>
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">{days === 1 ? t("dia") : t("dias")}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold"><Star className="size-4 fill-current" />{t("Sua prova principal")}</div>
        <div className="rf-text-title-lg">{race.name}</div>
        <div className="text-sm"><span className="first-letter:uppercase">{longDate(race.date)}</span> · {distanceLabel(e.distance_m, race.sport)}{e.goal_time_s ? ` · ${t("meta {t}", { t: clock(e.goal_time_s) })}` : ""}{p ? ` (${p})` : ""}</div>
      </div>
      <Button variant="secondary" size="sm" icon={<Pencil />} onClick={onEdit}>{t("Ajustar")}</Button>
    </Card>
  );
}

function RaceRow({ r, today, action }: { r: Race; today: string; action: React.ReactNode }) {
  const e = r.my_entry;
  return (
    <article className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-3.5 shadow-sm">
      <DateTile date={r.date} accent={e?.is_goal} />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{r.name}</h3>{e?.is_goal && <Badge tone="accent" icon={<Star />}>{t("Principal")}</Badge>}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
          <span className="first-letter:uppercase">{countdown(r.date, today)}</span>
          {raceWhere(r) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{raceWhere(r)}</span>}
          <span>{e ? distanceLabel(e.distance_m, r.sport) : r.distances_m.map((d) => distanceLabel(d, r.sport)).join(" · ")}</span>
          {!e && r.entries_count > 0 && <span>{tn(r.entries_count, "{n} da equipe vai", "{n} da equipe vão")}</span>}
        </div>
        {r.notes && e && <p className="mt-1 text-sm">{r.notes}</p>}
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {e && r.date < today && <EntryBadge e={e} />}
        {r.url && <a href={r.url} target="_blank" rel="noreferrer" aria-label={t("Site da prova")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-soft"><ExternalLink className="size-4" /></a>}
        {action}
      </div>
    </article>
  );
}

function JoinDialog({ club, race, onClose }: { club: Club; race: Race | null; onClose: () => void }) {
  return <Dialog open={!!race} onOpenChange={(v) => !v && onClose()} title={race?.my_entry ? t("Sua inscrição") : t("Participar da prova")} description={race ? `${race.name} · ${t(RACE_SPORT_LABEL[race.sport])}` : undefined}>{race && <JoinBody club={club} race={race} onClose={onClose} key={race.id} />}</Dialog>;
}
function JoinBody({ club, race, onClose }: { club: Club; race: Race; onClose: () => void }) {
  const join = useJoinRace(club.id);
  const leave = useLeaveRace(club.id);
  const e = race.my_entry;
  const [dist, setDist] = useState(e?.distance_m ?? race.distances_m[0]!);
  const [goal, setGoal] = useState(e?.goal_time_s ? clock(e.goal_time_s) : "");
  const [isGoal, setIsGoal] = useState(e?.is_goal ?? false);
  const secs = goal ? parseTime(goal) : null;
  const p = racePace(secs, dist, race.sport);
  const submit = () => join.mutate({ race_id: race.id, distance_m: dist, goal_time_s: secs, is_goal: isGoal }, {
    onSuccess: () => { toast.success(e ? t("Inscrição atualizada") : t("Inscrição feita!"), isGoal ? t("Seu treinador já vê essa prova como objetivo.") : undefined); onClose(); }, onError: toast.error,
  });
  return (
    <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
      <p className="text-sm text-fg-muted">{t("A inscrição oficial é feita no site da prova. Aqui você avisa a equipe e organiza seus treinos.")}</p>
      <Field label={t("Distância")}>{(id) => <Select id={id} value={dist} onChange={(ev) => setDist(Number(ev.target.value))}>{race.distances_m.map((d) => <option key={d} value={d}>{distanceLabel(d, race.sport)}</option>)}</Select>}</Field>
      <Field label={t("Meta de tempo")} optional hint={p ? t("Ritmo alvo: {p}", { p }) : t("Ex.: 52:30 ou 1:45:00")} error={goal && !secs ? t("Use o formato 52:30 ou 1:45:00.") : null}>{(id, d) => <Input id={id} aria-describedby={d} value={goal} onChange={(ev) => setGoal(ev.target.value)} placeholder="52:30" inputMode="numeric" />}</Field>
      <Switch checked={isGoal} onCheckedChange={setIsGoal} label={t("É minha prova principal")} description={t("Vira o objetivo do seu perfil e guia o planejamento até lá.")} />
      <div className="flex flex-wrap justify-between gap-2">
        {e ? <Button variant="ghost" className="text-danger-text" loading={leave.isPending} onClick={() => leave.mutate(e.id, { onSuccess: () => { toast.success(t("Inscrição cancelada")); onClose(); } })}>{t("Cancelar inscrição")}</Button> : <span />}
        <Button type="submit" loading={join.isPending} disabled={!!goal && !secs}>{e ? t("Salvar") : t("Confirmar participação")}</Button>
      </div>
    </form>
  );
}

function ResultDialog({ club, race, onClose }: { club: Club; race: Race | null; onClose: () => void }) {
  return <Dialog open={!!race} onOpenChange={(v) => !v && onClose()} size="sm" title={t("Seu resultado")} description={race?.name}>{race?.my_entry && <ResultBody club={club} race={race} e={race.my_entry} onClose={onClose} key={race.id} />}</Dialog>;
}
function ResultBody({ club, race, e, onClose }: { club: Club; race: Race; e: RaceEntry; onClose: () => void }) {
  const update = useUpdateEntry(club.id);
  const [status, setStatus] = useState<RaceEntry["status"]>(e.status === "registered" ? "finished" : e.status);
  const [time, setTime] = useState(e.result_time_s ? clock(e.result_time_s) : "");
  const [pos, setPos] = useState(e.result_position?.toString() ?? "");
  const secs = parseTime(time);
  const p = racePace(secs, e.distance_m, race.sport);
  return (
    <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); update.mutate({ id: e.id, status, result_time_s: status === "finished" ? secs : null, result_position: status === "finished" && pos ? Number(pos) : null }, { onSuccess: () => { toast.success(status === "finished" ? t("Parabéns pela prova!") : t("Resultado salvo"), status === "finished" && race.sport === "run" ? t("Seu treinador pode atualizar suas zonas com esse tempo.") : undefined); onClose(); }, onError: toast.error }); }}>
      <Field label={t("Como foi")}>{(id) => <Select id={id} value={status} onChange={(ev) => setStatus(ev.target.value as RaceEntry["status"])}><option value="finished">{t("Completei")}</option><option value="dnf">{t("Não completei")}</option><option value="dns">{t("Não larguei")}</option></Select>}</Field>
      {status === "finished" && <>
        <Field label={t("Tempo oficial")} hint={p ? t("Ritmo médio: {p}", { p }) : undefined} error={time && !secs ? t("Use o formato 52:30 ou 1:45:00.") : null}>{(id, d) => <Input id={id} aria-describedby={d} value={time} onChange={(ev) => setTime(ev.target.value)} placeholder="52:30" autoFocus />}</Field>
        <Field label={t("Colocação")} optional>{(id) => <Input id={id} type="number" min={1} value={pos} onChange={(ev) => setPos(ev.target.value)} />}</Field>
      </>}
      <Button type="submit" block loading={update.isPending} disabled={status === "finished" && !secs}>{t("Salvar resultado")}</Button>
    </form>
  );
}

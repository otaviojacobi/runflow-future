/** W12 · Provas e eventos: club race calendar, entries, goal races, results (→ zones). Route: /races/manage */
import { Archive, ExternalLink, Flag, Gauge, MapPin, MoreHorizontal, Pencil, Plus, Star, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useSetZones } from "@/api/activities";
import { useAthletes } from "@/api/members";
import { type RaceInput, useJoinRace, useLeaveRace, useRaces, useRemoveRace, useSaveRace, useUpdateEntry } from "@/api/races";
import type { Club, Race, RaceEntry, RaceSport } from "@/api/types";
import { DISTANCE_PRESETS, DateTile, EntryBadge, RACE_SPORTS, RACE_SPORT_LABEL, countdown, distanceLabel, racePace, raceWhere } from "@/components/races";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { clock, longDate, today as todayFn } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Segmented, Select, Skeleton, Textarea, cn, toast } from "@/ui";
import { parseTime } from "../onboarding/Welcome";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function RacesManageScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [tab, setTab] = useState<"next" | "past">("next");
  const [form, setForm] = useState<Race | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const races = useRaces(club?.id);
  if (!club) return null;
  const all = races.data ?? [];
  const list = tab === "next" ? all.filter((r) => r.date >= today) : all.filter((r) => r.date < today).reverse();
  const current = all.find((r) => r.id === open) ?? null;
  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <PageHeader title={t("Provas e eventos")} subtitle={t("O calendário de provas do clube. A prova principal de cada aluno vira o objetivo do planejamento.")}
        actions={<Button icon={<Plus />} onClick={() => setForm(null)}>{t("Nova prova")}</Button>} />
      <Segmented label={t("Período")} value={tab} onChange={setTab} className="w-fit" options={[{ value: "next", label: t("Próximas") }, { value: "past", label: t("Passadas") }]} />
      {races.isPending ? <Skeleton className="h-64" /> : list.length === 0 ? (
        <Card><EmptyState icon={<Flag />} title={tab === "next" ? t("Nenhuma prova marcada") : t("Nenhuma prova passada")} action={tab === "next" ? <Button icon={<Plus />} onClick={() => setForm(null)}>{t("Nova prova")}</Button> : undefined}>{t("Cadastre as provas que a equipe vai correr. Os alunos se inscrevem pelo app.")}</EmptyState></Card>
      ) : (
        <ul className="grid gap-3">
          {list.map((r) => {
            const goals = (r.entries ?? []).filter((e) => e.is_goal).length;
            const finished = (r.entries ?? []).filter((e) => e.status === "finished").length;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="flex w-full flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4 text-left shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-ring">
                  <DateTile date={r.date} accent={goals > 0 && r.date >= today} />
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span><Badge>{t(RACE_SPORT_LABEL[r.sport])}</Badge></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
                      <span className="first-letter:uppercase">{countdown(r.date, today)}</span>
                      {raceWhere(r) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{raceWhere(r)}</span>}
                      <span>{r.distances_m.map((d) => distanceLabel(d, r.sport)).join(" · ")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold"><Users className="size-4 text-fg-muted" />{tn(r.entries_count, "{n} aluno", "{n} alunos")}</span>
                    {goals > 0 && <Badge tone="accent" icon={<Star />}>{tn(goals, "{n} prova principal", "{n} provas principais")}</Badge>}
                    {tab === "past" && <Badge tone={finished ? "success" : "neutral"}>{tn(finished, "{n} resultado", "{n} resultados")}</Badge>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <RaceForm club={club} value={form} onClose={() => setForm(undefined)} />
      <RaceDialog club={club} race={current} today={today} onClose={() => setOpen(null)} onEdit={(r) => { setOpen(null); setForm(r); }} />
    </div>
  );
}

// ---------------------------------------------------------------- create / edit
function RaceForm({ club, value, onClose }: { club: Club; value: Race | null | undefined; onClose: () => void }) {
  return <Dialog open={value !== undefined} onOpenChange={(v) => !v && onClose()} size="lg" title={value ? t("Editar prova") : t("Nova prova")}>{value !== undefined && <RaceFormBody club={club} value={value} onClose={onClose} />}</Dialog>;
}
function RaceFormBody({ club, value, onClose }: { club: Club; value: Race | null; onClose: () => void }) {
  const save = useSaveRace(club.id);
  const [v, setV] = useState<RaceInput>({ name: value?.name ?? "", sport: value?.sport ?? "run", date: value?.date ?? "", start_time: value?.start_time?.slice(0, 5) ?? "07:00", city: value?.city ?? club.city ?? "", state: value?.state ?? club.state ?? "", url: value?.url ?? "", notes: value?.notes ?? "", distances_m: value?.distances_m ?? [] });
  const [custom, setCustom] = useState("");
  const set = (p: Partial<RaceInput>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  const sport = v.sport ?? "run";
  const toggle = (m: number) => set({ distances_m: v.distances_m.includes(m) ? v.distances_m.filter((x) => x !== m) : [...v.distances_m, m].sort((a, b) => a - b) });
  const addCustom = () => { const n = Number(custom.replace(",", ".")); if (n > 0) { const m = Math.round(sport === "swim" ? n : n * 1000); if (!v.distances_m.includes(m)) toggle(m); setCustom(""); } };
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, id: value?.id, url: v.url || null, notes: v.notes || null, city: v.city || null, state: v.state || null, start_time: v.start_time || null }, { onSuccess: () => { toast.success(value ? t("Prova atualizada") : t("Prova adicionada ao calendário"), value ? undefined : t("Os alunos já podem se inscrever.")); onClose(); }, onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } }); }}>
      <Field label={t("Nome da prova")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Ex.: Meia Maratona de Santos")} autoFocus />}</Field>
      <Field label={t("Modalidade")}>{(id) => <Select id={id} value={sport} onChange={(e) => set({ sport: e.target.value as RaceSport, distances_m: [] })}>{RACE_SPORTS.map((s) => <option key={s} value={s}>{t(RACE_SPORT_LABEL[s])}</option>)}</Select>}</Field>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label={t("Data")} error={err?.fieldError("date")}>{(id) => <Input id={id} type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
        <Field label={t("Largada")} optional>{(id) => <Input id={id} type="time" value={v.start_time ?? ""} onChange={(e) => set({ start_time: e.target.value })} className="w-28" />}</Field>
      </div>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="mb-2 rf-text-label-sm">{t("Distâncias")}</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[...new Set([...DISTANCE_PRESETS[sport], ...v.distances_m])].sort((a, b) => a - b).map((m) => (
            <button key={m} type="button" aria-pressed={v.distances_m.includes(m)} onClick={() => toggle(m)} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", v.distances_m.includes(m) ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{distanceLabel(m, sport)}</button>
          ))}
          <span className="flex items-center gap-1"><Input aria-label={sport === "swim" ? t("Outra distância em metros") : t("Outra distância em km")} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} placeholder={sport === "swim" ? t("metros") : t("km")} className="h-9 w-20" inputMode="decimal" /><Button size="sm" variant="ghost" onClick={addCustom}>{t("Adicionar")}</Button></span>
        </div>
        {err?.fieldError("distances_m") && <p className="rf-text-caption text-danger-text">{err.fieldError("distances_m")}</p>}
      </fieldset>
      <Field label={t("Cidade")} optional>{(id) => <Input id={id} value={v.city ?? ""} onChange={(e) => set({ city: e.target.value })} />}</Field>
      <Field label={t("Estado")} optional>{(id) => <Select id={id} value={v.state ?? ""} onChange={(e) => set({ state: e.target.value })}><option value="">–</option>{UF.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
      <Field label={t("Site da prova")} optional className="sm:col-span-2">{(id) => <Input id={id} type="url" value={v.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />}</Field>
      <Field label={t("Recado para a equipe")} optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder={t("Ex.: concentração às 6h no portão 3")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{value ? t("Salvar") : t("Adicionar prova")}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------- detail: entries + results
function RaceDialog({ club, race, today, onClose, onEdit }: { club: Club; race: Race | null; today: string; onClose: () => void; onEdit: (r: Race) => void }) {
  const remove = useRemoveRace(club.id);
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog open={!!race} onOpenChange={(v) => { if (!v) { onClose(); setConfirm(false); } }} size="xl" title={race?.name ?? ""}
      description={race ? <span className="first-letter:uppercase">{longDate(race.date)}{race.start_time ? ` · ${race.start_time.slice(0, 5)}` : ""}{raceWhere(race) ? ` · ${raceWhere(race)}` : ""}</span> : undefined}>
      {race && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(RACE_SPORT_LABEL[race.sport])}</Badge>
            {race.distances_m.map((d) => <Badge key={d} tone="info">{distanceLabel(d, race.sport)}</Badge>)}
            {race.url && <a href={race.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-text hover:underline">{t("Site da prova")}<ExternalLink className="size-3.5" /></a>}
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => onEdit(race)}>{t("Editar")}</Button>
              <Menu trigger={<IconButton size="sm" variant="secondary" label={t("Mais ações")}><MoreHorizontal /></IconButton>} items={[{ label: t("Remover do calendário"), icon: <Archive />, danger: true, onSelect: () => setConfirm(true) }]} />
            </span>
          </div>
          {confirm && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft p-3 text-on-danger-soft">
              <span className="flex-1 text-sm">{race.entries_count ? tn(race.entries_count, "Remover a prova e a inscrição de {n} aluno?", "Remover a prova e as inscrições de {n} alunos?") : t("Remover a prova do calendário?")}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t("Voltar")}</Button>
              <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(race.id, { onSuccess: () => { toast.success(t("Prova removida")); onClose(); setConfirm(false); } })}>{t("Remover")}</Button>
            </div>
          )}
          {race.notes && <p className="rounded-md bg-sunken px-3 py-2 text-sm">{race.notes}</p>}
          <Entries club={club} race={race} past={race.date < today} />
        </div>
      )}
    </Dialog>
  );
}

function Entries({ club, race, past }: { club: Club; race: Race; past: boolean }) {
  const entries = race.entries ?? [];
  const athletes = useAthletes(club.id);
  const join = useJoinRace(club.id);
  const [pick, setPick] = useState(""), [dist, setDist] = useState(race.distances_m[0]!);
  const inRace = new Set(entries.map((e) => e.membership_id));
  const options = (athletes.data ?? []).filter((a) => !inRace.has(a.membership.id));
  const byDistance = useMemo(() => race.distances_m.map((d) => ({ d, list: entries.filter((e) => e.distance_m === d) })).filter((g) => g.list.length), [race, entries]);
  return (
    <section className="grid gap-3" aria-label={t("Inscritos")}>
      <h3 className="rf-text-title-sm">{t("Inscritos")} <span className="font-normal text-fg-muted">({entries.length})</span></h3>
      {entries.length === 0 ? <p className="text-sm text-fg-muted">{t("Ninguém inscrito ainda.")}</p> : byDistance.map(({ d, list }) => (
        <div key={d} className="grid gap-1">
          <div className="rf-text-overline text-fg-muted">{distanceLabel(d, race.sport)}</div>
          <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">{list.map((e) => <EntryRow key={e.id} club={club} race={race} e={e} past={past} />)}</ul>
        </div>
      ))}
      <form className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-4" onSubmit={(e) => { e.preventDefault(); join.mutate({ race_id: race.id, membership_id: pick, distance_m: dist }, { onSuccess: () => { toast.success(t("Aluno inscrito")); setPick(""); }, onError: toast.error }); }}>
        <Select aria-label={t("Aluno para inscrever")} value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1"><option value="">{t("Inscrever aluno…")}</option>{options.map((a) => <option key={a.membership.id} value={a.membership.id}>{a.user.name}</option>)}</Select>
        <Select aria-label={t("Distância")} value={dist} onChange={(e) => setDist(Number(e.target.value))} className="w-32">{race.distances_m.map((d) => <option key={d} value={d}>{distanceLabel(d, race.sport)}</option>)}</Select>
        <Button type="submit" variant="secondary" icon={<UserPlus />} disabled={!pick} loading={join.isPending}>{t("Inscrever")}</Button>
      </form>
    </section>
  );
}

function EntryRow({ club, race, e, past }: { club: Club; race: Race; e: NonNullable<Race["entries"]>[number]; past: boolean }) {
  const update = useUpdateEntry(club.id);
  const leave = useLeaveRace(club.id);
  const zones = useSetZones(club.id, e.membership_id);
  const [time, setTime] = useState(e.result_time_s ? clock(e.result_time_s) : "");
  const [status, setStatus] = useState<RaceEntry["status"]>(e.status === "registered" ? "finished" : e.status);
  const secs = parseTime(time);
  const goalPace = racePace(e.goal_time_s, e.distance_m, race.sport);
  const saveResult = () => update.mutate({ id: e.id, status, result_time_s: status === "finished" ? secs : e.result_time_s }, { onSuccess: () => toast.success(t("Resultado salvo")), onError: toast.error });
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Avatar name={e.athlete.user.name} src={e.athlete.user.avatar_url} size={32} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-1.5 text-sm font-semibold">{e.athlete.user.name}{e.is_goal && <Star className="size-3.5 fill-current text-accent-text" aria-label={t("Prova principal")} />}</div>
        <div className="text-xs text-fg-muted">{e.goal_time_s ? t("Meta {t}", { t: clock(e.goal_time_s) }) + (goalPace ? ` · ${goalPace}` : "") : t("Sem meta de tempo")}</div>
      </div>
      {past ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("Situação de {name}", { name: e.athlete.user.name })} value={status} onChange={(ev) => setStatus(ev.target.value as RaceEntry["status"])} className="h-9 w-36"><option value="finished">{t("Concluiu")}</option><option value="dnf">{t("Não completou")}</option><option value="dns">{t("Não largou")}</option></Select>
          {status === "finished" && <Input aria-label={t("Tempo de {name}", { name: e.athlete.user.name })} value={time} onChange={(ev) => setTime(ev.target.value)} placeholder="52:30" className="h-9 w-24 font-mono" />}
          <Button size="sm" variant="secondary" disabled={status === "finished" && !secs} loading={update.isPending} onClick={saveResult}>{t("Salvar")}</Button>
          {e.status === "finished" && e.result_time_s && race.sport === "run" && (
            <IconButton size="sm" label={t("Atualizar zonas de {name} com este tempo", { name: e.athlete.user.name })} disabled={zones.isPending}
              onClick={() => zones.mutate({ kind: "pace", race: { distance_m: e.distance_m, time_s: e.result_time_s! } }, { onSuccess: () => toast.success(t("Zonas atualizadas"), t("Os treinos de {name} já usam os novos ritmos.", { name: e.athlete.user.name.split(" ")[0] })), onError: toast.error })}><Gauge /></IconButton>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <EntryBadge e={e} />
          <IconButton size="sm" label={t("Cancelar inscrição de {name}", { name: e.athlete.user.name })} onClick={() => leave.mutate(e.id, { onSuccess: () => toast.success(t("Inscrição cancelada")) })}><Trash2 /></IconButton>
        </div>
      )}
    </li>
  );
}

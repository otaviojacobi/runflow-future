/**
 * W12 · Provas e eventos (staff, from Mais; the web's screens/staff/Races.tsx): the club's race calendar (next / past),
 * adding and editing races, and per race its entries by distance: sign a student up, cancel an entry, record results
 * after the race and turn a run's result into the student's pace zones. A student's goal race drives their planning.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAthletes, useSetZones } from "@/api/staff";
import { type RaceInput, useJoinRace, useLeaveRace, useRaces, useRemoveRace, useSaveRace, useUpdateEntry } from "@/api/races";
import type { Club, Race, RaceEntry, RaceSport } from "@/api/types";
import { brToIso, isoToBr, maskDate } from "@/components/account/inputs";
import { DISTANCE_PRESETS, DateTile, EntryBadge, RACE_SPORTS, RACE_SPORT_LABEL, countdown, distanceLabel, maskClock, openRaceSite, parseClock, racePace, raceWhere } from "@/components/races";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { clock, longDate, today as todayFn, upperFirst } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Screen, Segmented, Select, Skeleton, Text, Textarea, toast } from "@/ui";
import { CircleAlert, ExternalLink, Flag, Gauge, MapPin, Pencil, Plus, Star, Trash2, UserPlus, Users } from "@/ui/icons";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
/** "0700" → "07:00" as typed (the race's start, 24 h). */
const maskHour = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`; };
const validHour = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export default function RacesManageScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [tab, setTab] = useState<"next" | "past">("next");
  const [form, setForm] = useState<Race | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const races = useRaces(club?.id);
  if (!club) return null;
  const all = races.data ?? [];
  const list = tab === "next" ? all.filter((r) => r.date >= today) : all.filter((r) => r.date < today).reverse();
  const current = all.find((r) => r.id === open) ?? null;
  const refresh = async () => { setRefreshing(true); await races.refetch(); setRefreshing(false); };
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{t("O calendário de provas do clube. A prova principal de cada aluno vira o objetivo do planejamento.")}</Text>
      <Button icon={Plus} block onPress={() => setForm(null)}>{t("Nova prova")}</Button>
      <Segmented label={t("Período")} value={tab} onChange={setTab} style={styles.stretch} options={[{ value: "next", label: t("Próximas") }, { value: "past", label: t("Passadas") }]} />
      {races.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : races.isError && !races.data ? (
        <Card><EmptyState icon={CircleAlert} title={races.error instanceof ApiError ? races.error.title : t("Algo deu errado")}
          action={<Button variant="secondary" loading={races.isFetching} onPress={() => void races.refetch()}>{t("Tentar de novo")}</Button>}>
          {races.error instanceof ApiError ? races.error.detail : t("Tente novamente em instantes.")}
        </EmptyState></Card>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={Flag} title={tab === "next" ? t("Nenhuma prova marcada") : t("Nenhuma prova passada")}>
          {t("Cadastre as provas que a equipe vai correr. Os alunos se inscrevem pelo app.")}
        </EmptyState></Card>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {list.map((r) => <RaceCard key={r.id} r={r} today={today} past={tab === "past"} onPress={() => setOpen(r.id)} />)}
        </View>
      )}
      <Dialog open={form !== undefined} onOpenChange={(v) => { if (!v) setForm(undefined); }} title={form ? t("Editar prova") : t("Nova prova")}>
        {form !== undefined && <RaceForm key={form?.id ?? "new"} club={club} value={form} onClose={() => setForm(undefined)} />}
      </Dialog>
      <Dialog open={!!current} onOpenChange={(v) => { if (!v) setOpen(null); }} title={current?.name ?? ""}
        description={current ? [upperFirst(longDate(current.date)), current.start_time?.slice(0, 5), raceWhere(current)].filter(Boolean).join(" · ") : null}>
        {current && <RaceDetail key={current.id} club={club} race={current} today={today} onClose={() => setOpen(null)} onEdit={() => { setOpen(null); setForm(current); }} />}
      </Dialog>
    </Screen>
  );
}

function RaceCard({ r, today, past, onPress }: { r: Race; today: string; past: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  const goals = (r.entries ?? []).filter((e) => e.is_goal).length;
  const finished = (r.entries ?? []).filter((e) => e.status === "finished").length;
  const where = raceWhere(r);
  return (
    <Card onPress={onPress} accessibilityLabel={`${r.name}, ${countdown(r.date, today)}, ${tn(r.entries_count, "{n} aluno", "{n} alunos")}`} style={{ padding: theme.space[3], gap: theme.space[3] }}>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <DateTile date={r.date} accent={goals > 0 && !past} />
        <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            <Text variant="labelMd">{r.name}</Text>
            <Badge>{t(RACE_SPORT_LABEL[r.sport])}</Badge>
          </View>
          <Text variant="bodySm" tone="muted">{upperFirst(countdown(r.date, today))} · {r.distances_m.map((d) => distanceLabel(d, r.sport)).join(" · ")}</Text>
          {where ? (
            <View style={[styles.row, { gap: theme.space[1] }]}>
              <MapPin size={theme.size.iconSm - 2} color={theme.color.fgMuted} aria-hidden />
              <Text variant="bodySm" tone="muted">{where}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <Users size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
          <Text variant="labelSm">{tn(r.entries_count, "{n} aluno", "{n} alunos")}</Text>
        </View>
        {goals > 0 && <Badge tone="accent" icon={Star}>{tn(goals, "{n} prova principal", "{n} provas principais")}</Badge>}
        {past && <Badge tone={finished ? "success" : "neutral"}>{tn(finished, "{n} resultado", "{n} resultados")}</Badge>}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------- create / edit
function RaceForm({ club, value, onClose }: { club: Club; value: Race | null; onClose: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const save = useSaveRace(club.id);
  const [v, setV] = useState({
    name: value?.name ?? "", sport: value?.sport ?? ("run" as RaceSport), date: isoToBr(value?.date), start_time: value?.start_time?.slice(0, 5) ?? "07:00",
    city: value?.city ?? club.city ?? "", state: value?.state ?? club.state ?? "", url: value?.url ?? "", notes: value?.notes ?? "", distances_m: value?.distances_m ?? [],
  });
  const [custom, setCustom] = useState("");
  const [tried, setTried] = useState(false);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  const iso = brToIso(v.date);
  const sport = v.sport;
  const toggle = (m: number) => set({ distances_m: v.distances_m.includes(m) ? v.distances_m.filter((x) => x !== m) : [...v.distances_m, m].sort((a, b) => a - b) });
  const addCustom = () => {
    const n = Number(custom.replace(",", "."));
    if (!(n > 0)) return;
    const m = Math.round(sport === "swim" ? n : n * 1000);
    if (!v.distances_m.includes(m)) toggle(m);
    setCustom("");
  };
  const submit = () => {
    setTried(true);
    if (!iso || (v.start_time && !validHour(v.start_time))) return;
    const input: RaceInput & { id?: string } = {
      id: value?.id, name: v.name.trim(), sport, date: iso, distances_m: v.distances_m, start_time: v.start_time || null,
      city: v.city.trim() || null, state: v.state || null, url: v.url.trim() || null, notes: v.notes.trim() || null,
    };
    save.mutate(input, {
      onSuccess: () => { toast.success(value ? t("Prova atualizada") : t("Prova adicionada ao calendário"), value ? undefined : t("Os alunos já podem se inscrever.")); onClose(); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  const chips = [...new Set([...DISTANCE_PRESETS[sport], ...v.distances_m])].sort((a, b) => a - b);
  return (
    <View style={{ gap: theme.space[4] }}>
      <Field label={t("Nome da prova")} error={err?.fieldError("name")}>
        {(a) => <Input {...a} value={v.name} onChangeText={(name) => set({ name })} placeholder={t("Ex.: Meia Maratona de Santos")} autoCapitalize="words" maxLength={120} />}
      </Field>
      <Field label={t("Modalidade")}>
        {(a) => <Select<RaceSport> {...a} title={t("Modalidade")} value={sport} onChange={(s) => set({ sport: s, distances_m: [] })} options={RACE_SPORTS.map((s) => ({ value: s, label: t(RACE_SPORT_LABEL[s]) }))} />}
      </Field>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <Field label={t("Data")} hint={t("dd/mm/aaaa")} error={tried && !iso ? t("Use o formato dd/mm/aaaa, como 15/03/2027.") : err?.fieldError("date")} style={styles.flex}>
          {(a) => <Input {...a} value={v.date} onChangeText={(d) => set({ date: maskDate(d) })} placeholder="15/03/2027" keyboardType="number-pad" maxLength={10} />}
        </Field>
        <Field label={t("Largada")} optional error={tried && v.start_time && !validHour(v.start_time) ? t("Use 07:00.") : err?.fieldError("start_time")} style={styles.third}>
          {(a) => <Input {...a} value={v.start_time} onChangeText={(h) => set({ start_time: maskHour(h) })} placeholder="07:00" keyboardType="number-pad" maxLength={5} />}
        </Field>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="labelSm" accessibilityRole="header">{t("Distâncias")}</Text>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {chips.map((m) => {
            const on = v.distances_m.includes(m);
            return (
              <Button key={m} size="sm" variant={on ? "primary" : "secondary"} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(m)}>
                {distanceLabel(m, sport)}
              </Button>
            );
          })}
        </View>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Input value={custom} onChangeText={setCustom} keyboardType="decimal-pad" placeholder={sport === "swim" ? t("metros") : t("km")} onSubmitEditing={addCustom}
            accessibilityLabel={sport === "swim" ? t("Outra distância em metros") : t("Outra distância em km")} style={{ width: theme.space[20] + theme.space[4] }} />
          <Button variant="ghost" size="sm" icon={Plus} onPress={addCustom}>{t("Adicionar")}</Button>
        </View>
        {err?.fieldError("distances_m") ? <Text variant="caption" color={c.danger.text}>{err.fieldError("distances_m")}</Text> : null}
      </View>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <Field label={t("Cidade")} optional style={styles.flex}>
          {(a) => <Input {...a} value={v.city} onChangeText={(city) => set({ city })} autoCapitalize="words" />}
        </Field>
        <Field label={t("Estado")} optional style={styles.third}>
          {(a) => <Select<string> {...a} title={t("Estado")} value={v.state || null} placeholder="–" onChange={(state) => set({ state })} options={UF.map((u) => ({ value: u, label: u }))} />}
        </Field>
      </View>
      <Field label={t("Site da prova")} optional error={err?.fieldError("url")}>
        {(a) => <Input {...a} value={v.url} onChangeText={(url) => set({ url })} placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} />}
      </Field>
      <Field label={t("Recado para a equipe")} optional>
        {(a) => <Textarea {...a} value={v.notes} onChangeText={(notes) => set({ notes })} placeholder={t("Ex.: concentração às 6h no portão 3")} maxLength={1000} />}
      </Field>
      <Button size="lg" block loading={save.isPending} disabled={!v.name.trim()} onPress={submit}>{value ? t("Salvar") : t("Adicionar prova")}</Button>
    </View>
  );
}

// ---------------------------------------------------------------- detail: entries + results
function RaceDetail({ club, race, today, onClose, onEdit }: { club: Club; race: Race; today: string; onClose: () => void; onEdit: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const remove = useRemoveRace(club.id);
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={{ gap: theme.space[5] }}>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        <Badge>{t(RACE_SPORT_LABEL[race.sport])}</Badge>
        {race.distances_m.map((d) => <Badge key={d} tone="info">{distanceLabel(d, race.sport)}</Badge>)}
      </View>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        <Button size="sm" variant="secondary" icon={Pencil} onPress={onEdit}>{t("Editar")}</Button>
        {race.url && <Button size="sm" variant="secondary" icon={ExternalLink} accessibilityRole="link" onPress={() => void openRaceSite(race.url!)}>{t("Site da prova")}</Button>}
        <Button size="sm" variant="ghost" icon={Trash2} onPress={() => setConfirm(true)}>{t("Remover")}</Button>
      </View>
      {confirm && (
        <View style={{ gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.danger.border, backgroundColor: c.danger.subtle }}>
          <Text variant="bodySm" color={c.danger.subtleFg}>
            {race.entries_count ? tn(race.entries_count, "Remover a prova e a inscrição de {n} aluno?", "Remover a prova e as inscrições de {n} alunos?") : t("Remover a prova do calendário?")}
          </Text>
          <View style={[styles.row, styles.end, { gap: theme.space[2] }]}>
            <Button size="sm" variant="ghost" onPress={() => setConfirm(false)}>{t("Voltar")}</Button>
            <Button size="sm" variant="danger" loading={remove.isPending}
              onPress={() => remove.mutate(race.id, { onSuccess: () => { toast.success(t("Prova removida")); onClose(); }, onError: toast.error })}>{t("Remover")}</Button>
          </View>
        </View>
      )}
      {race.notes ? <Text variant="bodySm" style={{ padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.sunken }}>{race.notes}</Text> : null}
      <Entries club={club} race={race} past={race.date < today} />
    </View>
  );
}

function Entries({ club, race, past }: { club: Club; race: Race; past: boolean }) {
  const { theme } = useTheme();
  const entries = race.entries ?? [];
  const athletes = useAthletes(club.id);
  const join = useJoinRace(club.id);
  const [pick, setPick] = useState<string | null>(null);
  const [dist, setDist] = useState(String(race.distances_m[0]!));
  const inRace = new Set(entries.map((e) => e.membership_id));
  const options = (athletes.data ?? []).filter((a) => !inRace.has(a.membership.id)).map((a) => ({ value: a.membership.id, label: a.user.name }));
  const byDistance = useMemo(() => race.distances_m.map((d) => ({ d, list: entries.filter((e) => e.distance_m === d) })).filter((g) => g.list.length), [race, entries]);
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="titleSm" accessibilityRole="header">{t("Inscritos")} <Text variant="bodyMd" tone="muted">({entries.length})</Text></Text>
      {entries.length === 0 ? <Text variant="bodySm" tone="muted">{t("Ninguém inscrito ainda.")}</Text> : byDistance.map(({ d, list }) => (
        <View key={d} style={{ gap: theme.space[1] }}>
          <Text variant="overline" tone="muted">{distanceLabel(d, race.sport)}</Text>
          <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.lineSubtle }}>
            {list.map((e, i) => <EntryRow key={e.id} club={club} race={race} e={e} past={past} first={i === 0} />)}
          </View>
        </View>
      ))}
      <View style={{ gap: theme.space[2], paddingTop: theme.space[4], borderTopWidth: 1, borderTopColor: theme.color.lineSubtle }}>
        <Text variant="labelSm">{t("Inscrever aluno")}</Text>
        <Select<string> value={pick} onChange={setPick} options={options} placeholder={t("Escolha o aluno")} title={t("Aluno para inscrever")} accessibilityLabel={t("Aluno para inscrever")} />
        {race.distances_m.length > 1 && (
          <Segmented<string> label={t("Distância")} value={dist} onChange={setDist} size="sm" style={styles.stretch}
            options={race.distances_m.map((d) => ({ value: String(d), label: distanceLabel(d, race.sport) }))} />
        )}
        <Button variant="secondary" icon={UserPlus} disabled={!pick} loading={join.isPending}
          onPress={() => pick && join.mutate({ race_id: race.id, membership_id: pick, distance_m: Number(dist) }, { onSuccess: () => { toast.success(t("Aluno inscrito")); setPick(null); }, onError: toast.error })}>
          {t("Inscrever")}
        </Button>
      </View>
    </View>
  );
}

function EntryRow({ club, race, e, past, first }: { club: Club; race: Race; e: NonNullable<Race["entries"]>[number]; past: boolean; first: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const update = useUpdateEntry(club.id);
  const leave = useLeaveRace(club.id);
  const zones = useSetZones(club.id, e.membership_id);
  const [time, setTime] = useState(e.result_time_s ? clock(e.result_time_s) : "");
  const [status, setStatus] = useState<RaceEntry["status"]>(e.status === "registered" ? "finished" : e.status);
  const secs = parseClock(time);
  const goalPace = racePace(e.goal_time_s, e.distance_m, race.sport);
  const name = e.athlete.user.name;
  const saveResult = () => update.mutate({ id: e.id, status, result_time_s: status === "finished" ? secs : e.result_time_s }, { onSuccess: () => toast.success(t("Resultado salvo")), onError: toast.error });
  return (
    <View style={{ gap: theme.space[2], padding: theme.space[3], borderTopWidth: first ? 0 : 1, borderTopColor: c.lineSubtle }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Avatar name={name} src={e.athlete.user.avatar_url} size={theme.space[8]} />
        <View style={styles.flex}>
          <View style={[styles.row, { gap: theme.space["1.5"] }]}>
            <Text variant="labelMd" numberOfLines={1} style={styles.shrink}>{name}</Text>
            {e.is_goal && <Star size={theme.size.iconSm - 2} color={c.accent.text} fill={c.accent.text} accessibilityLabel={t("Prova principal")} />}
          </View>
          <Text variant="caption" tone="muted">{e.goal_time_s ? t("Meta {t}", { t: clock(e.goal_time_s) }) + (goalPace ? ` · ${goalPace}` : "") : t("Sem meta de tempo")}</Text>
        </View>
        {!past && <EntryBadge e={e} />}
        {!past && (
          <IconButton icon={Trash2} label={t("Cancelar inscrição de {name}", { name })}
            onPress={() => leave.mutate(e.id, { onSuccess: () => toast.success(t("Inscrição cancelada")), onError: toast.error })} />
        )}
      </View>
      {past && (
        <View style={{ gap: theme.space[2] }}>
          <Segmented<RaceEntry["status"]> label={t("Situação de {name}", { name })} size="sm" value={status} onChange={setStatus} style={styles.stretch}
            options={[{ value: "finished", label: t("Concluiu") }, { value: "dnf", label: t("Não completou") }, { value: "dns", label: t("Não largou") }]} />
          <View style={[styles.row, { gap: theme.space[2] }]}>
            {status === "finished" && (
              <Input value={time} onChangeText={(v) => setTime(maskClock(v))} placeholder="52:30" keyboardType="number-pad" maxLength={8}
                accessibilityLabel={t("Tempo de {name}", { name })} invalid={!!time && !secs} style={[styles.flex, styles.tabular]} />
            )}
            <Button size="sm" variant="secondary" disabled={status === "finished" && !secs} loading={update.isPending} onPress={saveResult}>{t("Salvar")}</Button>
            {e.status === "finished" && e.result_time_s && race.sport === "run" ? (
              <IconButton icon={Gauge} label={t("Atualizar zonas de {name} com este tempo", { name })} disabled={zones.isPending}
                onPress={() => zones.mutate({ kind: "pace", race: { distance_m: e.distance_m, time_s: e.result_time_s! } }, {
                  onSuccess: () => toast.success(t("Zonas atualizadas"), t("Os treinos de {name} já usam os novos ritmos.", { name: name.split(" ")[0] })),
                  onError: toast.error,
                })} />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  end: { justifyContent: "flex-end" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, fontWeight: weight("semibold") },
  third: { width: "34%" },
  stretch: { alignSelf: "stretch" },
  tabular: { fontVariant: ["tabular-nums"] },
});

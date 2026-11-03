/**
 * M9 · Provas (student, from Perfil; the web's screens/student/Races.tsx): the goal race countdown, my entries, the
 * club's race calendar with "Quero participar", and results for past races. Signing up here tells the team and plans the
 * training; the official registration is on the race's own site. A goal race becomes the profile's goal and date.
 */
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useJoinRace, useLeaveRace, useRaces, useUpdateEntry } from "@/api/races";
import type { Race, RaceEntry } from "@/api/types";
import { DateTile, EntryBadge, RACE_SPORT_LABEL, countdown, distanceLabel, maskClock, openRaceSite, parseClock, racePace, raceWhere } from "@/components/races";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { clock, daysBetween, longDate, today as todayFn, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Screen, Segmented, Select, Skeleton, Switch, Text, toast } from "@/ui";
import { CircleAlert, ExternalLink, Flag, MapPin, Pencil, Star } from "@/ui/icons";

export default function RacesScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const races = useRaces(club?.id);
  const [join, setJoin] = useState<Race | null>(null);
  const [result, setResult] = useState<Race | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  if (!club) return null;
  const all = races.data ?? [];
  const upcoming = all.filter((r) => r.date >= today);
  const mine = upcoming.filter((r) => r.my_entry);
  const open = upcoming.filter((r) => !r.my_entry);
  const past = all.filter((r) => r.date < today && r.my_entry).reverse();
  const goal = mine.find((r) => r.my_entry?.is_goal);
  const refresh = async () => { setRefreshing(true); await races.refetch(); setRefreshing(false); };
  const section = (title: string, children: ReactNode) => (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="titleMd" accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* The back bar already says "Provas". */}
      <Text tone="muted">{t("O calendário da equipe, suas inscrições e seus resultados")}</Text>
      {races.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : races.isError && !races.data ? (
        <Card><EmptyState icon={CircleAlert} title={races.error instanceof ApiError ? races.error.title : t("Algo deu errado")}
          action={<Button variant="secondary" loading={races.isFetching} onPress={() => void races.refetch()}>{t("Tentar de novo")}</Button>}>
          {races.error instanceof ApiError ? races.error.detail : t("Tente novamente em instantes.")}
        </EmptyState></Card>
      ) : (
        <>
          {goal && <GoalHero race={goal} today={today} onEdit={() => setJoin(goal)} />}
          {section(t("Minhas inscrições"), mine.length === 0 ? (
            <View style={{ paddingVertical: theme.space[5], paddingHorizontal: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.color.sunken }}>
              <Text tone="muted" style={styles.textCenter}>{t("Você ainda não está inscrito em nenhuma prova.")}</Text>
            </View>
          ) : mine.map((r) => <RaceRow key={r.id} r={r} today={today} action={<Button size="sm" variant="ghost" icon={Pencil} onPress={() => setJoin(r)}>{t("Editar")}</Button>} />))}
          {section(t("Calendário do clube"), open.length === 0 ? (
            <Card><EmptyState icon={Flag} title={t("Nenhuma outra prova marcada")}>{t("Quando {club} adicionar provas, elas aparecem aqui.", { club: club.name })}</EmptyState></Card>
          ) : open.map((r) => <RaceRow key={r.id} r={r} today={today} action={<Button size="sm" onPress={() => setJoin(r)}>{t("Quero participar")}</Button>} />))}
          {past.length > 0 && section(t("Resultados"), past.map((r) => (
            <RaceRow key={r.id} r={r} today={today} action={r.my_entry!.status === "registered"
              ? <Button size="sm" variant="secondary" onPress={() => setResult(r)}>{t("Registrar resultado")}</Button>
              : <Button size="sm" variant="ghost" icon={Pencil} onPress={() => setResult(r)}>{t("Editar")}</Button>} />
          )))}
        </>
      )}
      <Dialog open={!!join} onOpenChange={(v) => { if (!v) setJoin(null); }} title={join?.my_entry ? t("Sua inscrição") : t("Participar da prova")}
        description={join ? `${join.name} · ${t(RACE_SPORT_LABEL[join.sport])}` : null}>
        {join && <JoinBody key={join.id} clubId={club.id} race={join} onClose={() => setJoin(null)} />}
      </Dialog>
      <Dialog open={!!result} onOpenChange={(v) => { if (!v) setResult(null); }} title={t("Seu resultado")} description={result?.name}>
        {result?.my_entry && <ResultBody key={result.id} clubId={club.id} race={result} e={result.my_entry} onClose={() => setResult(null)} />}
      </Dialog>
    </Screen>
  );
}

function GoalHero({ race, today, onEdit }: { race: Race; today: string; onEdit: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const e = race.my_entry!;
  const days = daysBetween(today, race.date);
  const p = racePace(e.goal_time_s, e.distance_m, race.sport);
  const meta = [upperFirst(longDate(race.date)), distanceLabel(e.distance_m, race.sport), e.goal_time_s ? t("meta {t}", { t: clock(e.goal_time_s) }) + (p ? ` (${p})` : "") : null].filter(Boolean).join(" · ");
  return (
    <Card tone="accent" style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.row, { gap: theme.space[4] }]}>
        <View accessible accessibilityLabel={tn(days, "faltam {n} dia", "faltam {n} dias")}
          style={[styles.center, { paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: c.surface, boxShadow: theme.shadow.sm }]}>
          <Text variant="metricLg" color={c.fg}>{days}</Text>
          <Text variant="overline" color={c.fgMuted}>{days === 1 ? t("dia") : t("dias")}</Text>
        </View>
        <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
          <View style={[styles.row, { gap: theme.space["1.5"] }]}>
            <Star size={theme.size.iconSm} color={c.accent.subtleFg} fill={c.accent.subtleFg} aria-hidden />
            <Text variant="labelSm">{t("Sua prova principal")}</Text>
          </View>
          <Text variant="titleLg">{race.name}</Text>
          <Text variant="bodySm">{meta}</Text>
        </View>
      </View>
      <Button variant="secondary" size="sm" icon={Pencil} style={styles.start} onPress={onEdit}>{t("Ajustar")}</Button>
    </Card>
  );
}

function RaceRow({ r, today, action }: { r: Race; today: string; action: ReactNode }) {
  const { theme } = useTheme();
  const e = r.my_entry;
  const where = raceWhere(r);
  return (
    <Card style={{ padding: theme.space[3], gap: theme.space[3] }}>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <DateTile date={r.date} accent={e?.is_goal} />
        <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            <Text variant="labelMd">{r.name}</Text>
            {e?.is_goal && <Badge tone="accent" icon={Star}>{t("Principal")}</Badge>}
          </View>
          <Text variant="bodySm" tone="muted">{upperFirst(countdown(r.date, today))} · {e ? distanceLabel(e.distance_m, r.sport) : r.distances_m.map((d) => distanceLabel(d, r.sport)).join(" · ")}</Text>
          {where ? (
            <View style={[styles.row, { gap: theme.space[1] }]}>
              <MapPin size={theme.size.iconSm - 2} color={theme.color.fgMuted} aria-hidden />
              <Text variant="bodySm" tone="muted">{where}</Text>
            </View>
          ) : null}
          {!e && r.entries_count > 0 && <Text variant="bodySm" tone="muted">{tn(r.entries_count, "{n} da equipe vai", "{n} da equipe vão")}</Text>}
          {r.notes && e ? <Text variant="bodySm">{r.notes}</Text> : null}
        </View>
      </View>
      <View style={[styles.row, styles.end, { gap: theme.space[2] }]}>
        {e && r.date < today && <EntryBadge e={e} />}
        {r.url && <IconButton icon={ExternalLink} label={t("Site da prova")} onPress={() => void openRaceSite(r.url!)} />}
        {action}
      </View>
    </Card>
  );
}

function JoinBody({ clubId, race, onClose }: { clubId: string; race: Race; onClose: () => void }) {
  const { theme } = useTheme();
  const join = useJoinRace(clubId);
  const leave = useLeaveRace(clubId);
  const e = race.my_entry;
  const [dist, setDist] = useState(String(e?.distance_m ?? race.distances_m[0]!));
  const [goal, setGoal] = useState(e?.goal_time_s ? clock(e.goal_time_s) : "");
  const [isGoal, setIsGoal] = useState(e?.is_goal ?? false);
  const secs = goal ? parseClock(goal) : null;
  const p = racePace(secs, Number(dist), race.sport);
  const submit = () => join.mutate({ race_id: race.id, distance_m: Number(dist), goal_time_s: secs, is_goal: isGoal }, {
    onSuccess: () => { toast.success(e ? t("Inscrição atualizada") : t("Inscrição feita!"), isGoal ? t("Seu treinador já vê essa prova como objetivo.") : undefined); onClose(); },
    onError: toast.error,
  });
  return (
    <View style={{ gap: theme.space[4] }}>
      <Text variant="bodySm" tone="muted">{t("A inscrição oficial é feita no site da prova. Aqui você avisa a equipe e organiza seus treinos.")}</Text>
      <Field label={t("Distância")}>
        {(a) => race.distances_m.length <= 4
          ? <Segmented<string> label={a.accessibilityLabel} value={dist} onChange={setDist} style={styles.stretch} options={race.distances_m.map((d) => ({ value: String(d), label: distanceLabel(d, race.sport) }))} />
          : <Select<string> {...a} title={t("Distância")} value={dist} onChange={setDist} options={race.distances_m.map((d) => ({ value: String(d), label: distanceLabel(d, race.sport) }))} />}
      </Field>
      <Field label={t("Meta de tempo")} optional hint={p ? t("Ritmo alvo: {p}", { p }) : t("Ex.: 52:30 ou 1:45:00")} error={goal && !secs ? t("Use o formato 52:30 ou 1:45:00.") : null}>
        {(a) => <Input {...a} value={goal} onChangeText={(v) => setGoal(maskClock(v))} placeholder="52:30" keyboardType="number-pad" maxLength={8} />}
      </Field>
      <Switch checked={isGoal} onCheckedChange={setIsGoal} label={t("É minha prova principal")} description={t("Vira o objetivo do seu perfil e guia o planejamento até lá.")} />
      <Button size="lg" block loading={join.isPending} disabled={!!goal && !secs} onPress={submit}>{e ? t("Salvar") : t("Confirmar participação")}</Button>
      {e && (
        <Button variant="ghost" block loading={leave.isPending}
          onPress={() => leave.mutate(e.id, { onSuccess: () => { toast.success(t("Inscrição cancelada")); onClose(); }, onError: toast.error })}>
          {t("Cancelar inscrição")}
        </Button>
      )}
    </View>
  );
}

function ResultBody({ clubId, race, e, onClose }: { clubId: string; race: Race; e: RaceEntry; onClose: () => void }) {
  const { theme } = useTheme();
  const update = useUpdateEntry(clubId);
  const [status, setStatus] = useState<RaceEntry["status"]>(e.status === "registered" ? "finished" : e.status);
  const [time, setTime] = useState(e.result_time_s ? clock(e.result_time_s) : "");
  const [pos, setPos] = useState(e.result_position?.toString() ?? "");
  const secs = parseClock(time);
  const p = racePace(secs, e.distance_m, race.sport);
  const finished = status === "finished";
  const save = () => update.mutate({ id: e.id, status, result_time_s: finished ? secs : null, result_position: finished && pos ? Number(pos) : null }, {
    onSuccess: () => {
      toast.success(finished ? t("Parabéns pela prova!") : t("Resultado salvo"), finished && race.sport === "run" ? t("Seu treinador pode atualizar suas zonas com esse tempo.") : undefined);
      onClose();
    },
    onError: toast.error,
  });
  return (
    <View style={{ gap: theme.space[4] }}>
      <Segmented<RaceEntry["status"]> label={t("Como foi")} value={status} onChange={setStatus} style={styles.stretch}
        options={[{ value: "finished", label: t("Completei") }, { value: "dnf", label: t("Não completei") }, { value: "dns", label: t("Não larguei") }]} />
      {finished && (
        <>
          <Field label={t("Tempo oficial")} hint={p ? t("Ritmo médio: {p}", { p }) : t("Ex.: 52:30 ou 1:45:00")} error={time && !secs ? t("Use o formato 52:30 ou 1:45:00.") : null}>
            {(a) => <Input {...a} value={time} onChangeText={(v) => setTime(maskClock(v))} placeholder="52:30" keyboardType="number-pad" maxLength={8} />}
          </Field>
          <Field label={t("Colocação")} optional>
            {(a) => <Input {...a} value={pos} onChangeText={(v) => setPos(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} />}
          </Field>
        </>
      )}
      <Button size="lg" block loading={update.isPending} disabled={finished && !secs} onPress={save}>{t("Salvar resultado")}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  end: { justifyContent: "flex-end" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  stretch: { alignSelf: "stretch" },
  textCenter: { textAlign: "center" },
});

/**
 * M4 · Atividades (student, from Perfil, D-035; the web's screens/student/Activities.tsx): activities by week with
 * totals, each with its source and the workout it matched, and the question under the ones the matching engine
 * couldn't place (D-049); "Registrar" logs one by hand (sheet); without Strava, a card to connect it right here.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useConnections } from "@/api/account";
import { useLogActivity, useMyActivities } from "@/api/activities";
import type { ActivityItem, Sport } from "@/api/types";
import { ActivityRow } from "@/components/activity";
import { MatchQuestion } from "@/components/matching";
import { SPORT_LABEL } from "@/components/sport";
import { StravaConnectPanel } from "@/components/connections/StravaConnect";
import { StravaAttribution } from "@/components/strava";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { addDays, dayMonth, duration, km, localDate, mondayOf, shortDate, today as todayFn, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, EmptyState, Field, Input, Screen, Select, Skeleton, Text, toast } from "@/ui";
import { Activity, Plus } from "@/ui/icons";

const SPORTS: Sport[] = ["run", "swim", "bike", "strength", "mobility", "other"];

/** "45" = minutes, "45:30" = mm:ss, "1:05:00" = h:mm:ss (the web builder's parseClock). */
const parseClock = (v: string): number | null => {
  const p = v.trim().split(":").map((x) => Number(x.replace(",", ".")));
  if (!v.trim() || p.some((x) => isNaN(x))) return null;
  if (p.length === 1) return Math.round(p[0]! * 60);
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return p[0]! * 3600 + p[1]! * 60 + p[2]!;
};

/** Logging by hand: sport, name, which day (the last two weeks) and time, duration, distance, average HR. */
function LogSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const log = useLogActivity();
  const today = todayFn();
  const [sport, setSport] = useState<Sport>("run");
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("06:30");
  const [dur, setDur] = useState("");
  const [dist, setDist] = useState("");
  const [hr, setHr] = useState("");
  const [local, setLocal] = useState<Record<string, string>>({});
  const err = log.error instanceof ApiError ? log.error : null;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i)).map((d, i) => ({
    value: d, label: i === 0 ? t("Hoje") : i === 1 ? t("Ontem") : upperFirst(shortDate(d)),
  }));
  const reset = () => { setName(""); setDur(""); setDist(""); setHr(""); setLocal({}); log.reset(); };
  const submit = () => {
    const s = parseClock(dur);
    const tm = time.trim().match(/^(\d{1,2})[:h]?(\d{2})$/);
    const problems: Record<string, string> = {};
    if (!s || s <= 0) problems.duration = t("Informe a duração (ex.: 45 ou 1:05:00).");
    if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) problems.time = t("Use o formato 06:30.");
    const m = dist.trim() ? Math.round(Number(dist.replace(",", ".")) * (sport === "swim" ? 1 : 1000)) : null;
    if (m !== null && (isNaN(m) || m <= 0)) problems.distance = t("Distância inválida.");
    setLocal(problems);
    if (Object.keys(problems).length) return;
    const [y, mo, d] = date.split("-").map(Number);
    // The phone's own clock: it's where the person trained.
    const started = new Date(y!, mo! - 1, d!, Number(tm![1]), Number(tm![2]));
    log.mutate({ sport, name: name.trim() || t(SPORT_LABEL[sport]), started_at: started.toISOString(), duration_s: s!, distance_m: m, avg_hr: hr.trim() ? Number(hr) : null }, {
      onSuccess: () => { toast.success(t("Atividade registrada")); onOpenChange(false); reset(); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }} title={t("Registrar atividade")} description={t("Para treinos sem relógio ou fora do Strava.")}
      footer={<>
        <Button variant="secondary" size="lg" onPress={() => onOpenChange(false)}>{t("Cancelar")}</Button>
        <Button size="lg" loading={log.isPending} onPress={submit} style={styles.flex}>{t("Salvar")}</Button>
      </>}>
      <View style={{ gap: theme.space[4] }}>
        <Field label={t("Modalidade")}>
          {(a) => <Select<Sport> {...a} title={t("Modalidade")} value={sport} onChange={setSport} options={SPORTS.map((s) => ({ value: s, label: t(SPORT_LABEL[s]) }))} />}
        </Field>
        <Field label={t("Nome")} optional>
          {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Ex.: Corrida no parque")} maxLength={120} />}
        </Field>
        <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
          <Field label={t("Dia")} error={err?.fieldError("started_at")} style={styles.flex}>
            {(a) => <Select<string> {...a} title={t("Dia")} value={date} onChange={setDate} options={days} />}
          </Field>
          <Field label={t("Hora")} error={local.time} style={styles.third}>
            {(a) => <Input {...a} value={time} onChangeText={setTime} placeholder="06:30" keyboardType="numbers-and-punctuation" maxLength={5} />}
          </Field>
        </View>
        <Field label={t("Duração")} hint={local.duration ? null : t("Minutos ou h:mm:ss")} error={local.duration ?? err?.fieldError("duration_s")}>
          {(a) => <Input {...a} value={dur} onChangeText={setDur} placeholder="45" keyboardType="numbers-and-punctuation" />}
        </Field>
        <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
          <Field label={sport === "swim" ? t("Distância (m)") : t("Distância (km)")} optional error={local.distance ?? err?.fieldError("distance_m")} style={styles.flex}>
            {(a) => <Input {...a} value={dist} onChangeText={setDist} placeholder={sport === "swim" ? "1500" : "8,5"} keyboardType="decimal-pad" />}
          </Field>
          <Field label={t("FC média (bpm)")} optional error={err?.fieldError("avg_hr")} style={styles.flex}>
            {(a) => <Input {...a} value={hr} onChangeText={setHr} keyboardType="number-pad" maxLength={3} />}
          </Field>
        </View>
      </View>
    </Dialog>
  );
}

function ConnectCard() {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Activity size={theme.size.iconLg} color={theme.color.fgMuted} aria-hidden />
        <Text variant="bodySm" style={styles.flex}>{t("Conecte o Strava e suas atividades chegam sozinhas, já ligadas aos treinos.")}</Text>
      </View>
      <StravaConnectPanel />
    </Card>
  );
}

export default function ActivitiesScreen() {
  const { theme } = useTheme();
  const list = useMyActivities();
  const conns = useConnections();
  const [log, setLog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const strava = conns.data?.find((c) => c.provider === "strava");
  const weeks = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const a of list.data ?? []) { const k = mondayOf(localDate(a.started_at)); m.set(k, [...(m.get(k) ?? []), a]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [list.data]);
  const thisMonday = mondayOf(todayFn());
  const refresh = async () => { setRefreshing(true); await Promise.all([list.refetch(), conns.refetch()]); setRefreshing(false); };
  const open = (a: ActivityItem) => router.push({ pathname: "/activities/[id]", params: { id: a.id } });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* The back bar already says "Atividades". */}
      <Button variant="secondary" icon={Plus} block onPress={() => setLog(true)}>{t("Registrar atividade")}</Button>
      {strava?.available && !strava.connection && <ConnectCard />}
      {list.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : list.isError && !list.data ? (
        <Card><EmptyState icon={Activity} title={list.error instanceof ApiError ? list.error.title : t("Algo deu errado")}
          action={<Button variant="secondary" loading={list.isFetching} onPress={() => void list.refetch()}>{t("Tentar de novo")}</Button>}>
          {list.error instanceof ApiError ? list.error.detail : t("Tente novamente em instantes.")}
        </EmptyState></Card>
      ) : weeks.length === 0 ? (
        <Card><EmptyState icon={Activity} title={t("Nenhuma atividade ainda")} action={<Button icon={Plus} onPress={() => setLog(true)}>{t("Registrar atividade")}</Button>}>
          {t("Quando você treinar com o Strava conectado, elas aparecem aqui.")}
        </EmptyState></Card>
      ) : weeks.map(([mon, acts]) => {
        const dm = acts.reduce((s, a) => s + (a.distance_m && a.sport !== "swim" ? a.distance_m : 0), 0);
        const ds = acts.reduce((s, a) => s + a.duration_s, 0);
        return (
          <View key={mon} style={{ gap: theme.space[2] }}>
            <View style={[styles.between, { paddingHorizontal: theme.space[1], gap: theme.space[3] }]}>
              <Text variant="labelMd" accessibilityRole="header">{mon === thisMonday ? t("Esta semana") : `${dayMonth(mon)} – ${dayMonth(addDays(mon, 6))}`}</Text>
              <Text variant="caption" tone="muted" style={styles.tabular}>{tn(acts.length, "{n} atividade", "{n} atividades")} · {duration(ds)}{dm ? ` · ${km(dm)} km` : ""}</Text>
            </View>
            <Card style={{ padding: theme.space[1] }}>
              {acts.map((a) => (
                <View key={a.id}>
                  <ActivityRow a={a} onPress={() => open(a)} />
                  {/* Which workout was it? (D-049): asked right under the activity. */}
                  {a.match_state === "pending" && a.match_options.length > 0 && <MatchQuestion a={a} inline />}
                </View>
              ))}
            </Card>
          </View>
        );
      })}
      {list.data?.some((a) => a.source === "strava") && <StravaAttribution style={{ paddingHorizontal: theme.space[1] }} />}
      <LogSheet open={log} onOpenChange={setLog} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  third: { width: "34%" },
  tabular: { fontVariant: ["tabular-nums"] },
});

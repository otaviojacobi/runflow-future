/**
 * M7 · Perfil de atleta (students): goal (with "Outro" + free text, D-035), race date, level, sessions per week, a
 * recent race (estimates the threshold pace) and heart rate; the zones the trainer set (read-only) and the student's
 * assessments. GET/PUT /clubs/{id}/my/profile, GET /clubs/{id}/my/assessments. Route: /account/profile (as on the web).
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMyAssessments, useMyProfile, useSaveMyProfile } from "@/api/account";
import type { AthleteProfile, Club, Goal, Level } from "@/api/types";
import { ASSESSMENT_NAME, GOALS, LEVELS, RACES, assessmentHeadline } from "@/components/account/labels";
import { brToIso, intIn, isoToBr, maskClock, maskDate, parseClock } from "@/components/account/inputs";
import { Section, Stepper, ZoneTable } from "@/components/account/parts";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { clock, fullDate, pace } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Field, Input, Screen, Select, Skeleton, Text, toast } from "@/ui";
import { CircleAlert, Gauge, HeartPulse, Info } from "@/ui/icons";

export default function ProfileScreen() {
  const { club, role } = useClub();
  const p = useMyProfile(role === "student" ? club?.id : undefined);
  const { theme } = useTheme();
  // Students only: the layout guards this route (staff go back to Minha conta).
  if (!club || role !== "student") return null;
  const who = club.trainer_label === "professor" ? t("seu professor") : t("seu treinador");
  return (
    <Screen refreshing={p.isRefetching} onRefresh={() => void p.refetch()}>
      <Text tone="muted">{t("Ajuda {who} a montar treinos do seu jeito em {club}.", { who, club: club.name })}</Text>
      {p.data ? (
        <>
          <Form clubId={club.id} p={p.data} who={who} key={p.data.updated_at} races={has(club, "races")} zones={has(club, "zones")} />
          {has(club, "zones") && <Zones p={p.data} who={who} />}
          <MyAssessments clubId={club.id} />
        </>
      ) : p.error ? (
        <Card>
          <EmptyState icon={CircleAlert} title={p.error instanceof ApiError ? p.error.title : t("Algo deu errado")}
            action={<Button variant="secondary" loading={p.isFetching} onPress={() => void p.refetch()}>{t("Tentar de novo")}</Button>}>
            {p.error instanceof ApiError ? p.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Skeleton style={{ height: theme.space[20] * 4 }} />
          <Skeleton style={{ height: theme.space[20] * 2 }} />
        </View>
      )}
    </Screen>
  );
}

/** `races`/`zones`: the race date, the recent race (pace estimate) and heart rate only for the club's modalities (D-052). */
function Form({ clubId, p, who, races, zones }: { clubId: string; p: AthleteProfile; who: string; races: boolean; zones: boolean }) {
  const { theme } = useTheme();
  const save = useSaveMyProfile(clubId);
  const [v, setV] = useState({
    goal: (p.goal ?? "") as Goal | "", goal_note: p.goal_note ?? "", goal_date: isoToBr(p.goal_date), level: (p.level ?? "") as Level | "",
    weekly_sessions: p.weekly_sessions, race_m: String(p.recent_race?.distance_m ?? 10000), race_time: p.recent_race ? clock(p.recent_race.time_s) : "",
    max_hr: p.max_hr?.toString() ?? "", resting_hr: p.resting_hr?.toString() ?? "",
  });
  const [tried, setTried] = useState(false);
  const set = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const err = save.error instanceof ApiError ? save.error : null;
  const raceS = v.race_time ? parseClock(v.race_time) : null;
  const goalDate = v.goal_date ? brToIso(v.goal_date) : "";
  const maxHr = intIn(v.max_hr, 100, 240), restHr = intIn(v.resting_hr, 25, 120);
  const errors = {
    goal_note: tried && v.goal === "other" && !v.goal_note.trim() ? t("Conte qual é o seu objetivo.") : err?.fieldError("goal_note"),
    goal_date: tried && goalDate === null ? t("Use o formato dd/mm/aaaa.") : err?.fieldError("goal_date"),
    race: (tried || v.race_time.length >= 4) && v.race_time && !raceS ? t("Use o formato 52:30 ou 1:45:10.") : err?.fieldError("recent_race"),
    max_hr: tried && Number.isNaN(maxHr) ? t("Entre 100 e 240 bpm.") : err?.fieldError("max_hr"),
    resting_hr: tried && Number.isNaN(restHr) ? t("Entre 25 e 120 bpm.") : err?.fieldError("resting_hr"),
  };
  const submit = () => {
    setTried(true);
    if ((v.goal === "other" && !v.goal_note.trim()) || goalDate === null || (v.race_time && !raceS) || Number.isNaN(maxHr) || Number.isNaN(restHr)) return;
    save.mutate({
      goal: v.goal || null, goal_note: v.goal === "other" ? v.goal_note.trim() || null : null, goal_date: goalDate || null, level: v.level || null,
      weekly_sessions: v.weekly_sessions, recent_race: raceS ? { distance_m: Number(v.race_m), time_s: raceS } : null, max_hr: maxHr, resting_hr: restHr,
    }, {
      onSuccess: () => toast.success(t("Perfil salvo"), t("Pronto: {who} já vê as mudanças.", { who })),
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  const gap = { padding: theme.space[4], gap: theme.space[4] };
  return (
    <>
      <Section title={t("Objetivo e rotina")} padded={false}>
        <View style={gap}>
          <Field label={t("Objetivo")} error={err?.fieldError("goal")}>
            {(a) => <Select<Goal | ""> {...a} value={v.goal || null} placeholder={t("Escolha…")} options={GOALS.map((g) => ({ value: g.value, label: t(g.label) }))} onChange={(goal) => set({ goal })} />}
          </Field>
          {v.goal === "other" && (
            <Field label={t("Qual é o seu objetivo?")} error={errors.goal_note}>
              {(a) => <Input {...a} value={v.goal_note} onChangeText={(goal_note) => set({ goal_note })} maxLength={120} placeholder={t("Ex.: voltar a correr depois de uma lesão")} />}
            </Field>
          )}
          {races && (
            <Field label={t("Data da prova")} optional error={errors.goal_date} hint={t("dd/mm/aaaa")}>
              {(a) => <Input {...a} value={v.goal_date} onChangeText={(x) => set({ goal_date: maskDate(x) })} placeholder="15/03/2027" keyboardType="number-pad" inputMode="numeric" maxLength={10} />}
            </Field>
          )}
          <Field label={t("Nível")} error={err?.fieldError("level")}>
            {(a) => <Select<Level | ""> {...a} value={v.level || null} placeholder={t("Escolha…")} options={LEVELS.map((l) => ({ value: l.value, label: t(l.label) }))} onChange={(level) => set({ level })} />}
          </Field>
          <Field label={t("Treinos por semana")} error={err?.fieldError("weekly_sessions")}>
            {(a) => <Stepper label={a.accessibilityLabel} value={v.weekly_sessions} min={0} max={14} onChange={(weekly_sessions) => set({ weekly_sessions })} format={(n) => String(n)} />}
          </Field>
        </View>
      </Section>

      {zones && (
        <Section title={t("Prova recente")} description={t("Usamos para estimar seu ritmo de limiar.")} padded={false}>
          <View style={gap}>
            <Field label={t("Distância")}>
              {(a) => <Select {...a} value={v.race_m} options={RACES.map((r) => ({ value: String(r.m), label: t(r.label) }))} onChange={(race_m) => set({ race_m })} />}
            </Field>
            <Field label={t("Tempo")} optional error={errors.race} hint={t("Só os números: 5230 vira 52:30.")}>
              {(a) => <Input {...a} value={v.race_time} onChangeText={(x) => set({ race_time: maskClock(x) })} placeholder="52:30" keyboardType="number-pad" inputMode="numeric" maxLength={8} />}
            </Field>
          </View>
        </Section>
      )}

      {zones && (
        <Section title={t("Frequência cardíaca")} padded={false}>
          <View style={[gap, styles.row]}>
            <Field label={t("FC máxima (bpm)")} optional error={errors.max_hr} style={styles.flex}>
              {(a) => <Input {...a} value={v.max_hr} onChangeText={(x) => set({ max_hr: x.replace(/\D/g, "") })} placeholder="188" keyboardType="number-pad" inputMode="numeric" maxLength={3} />}
            </Field>
            <Field label={t("FC de repouso (bpm)")} optional error={errors.resting_hr} style={styles.flex}>
              {(a) => <Input {...a} value={v.resting_hr} onChangeText={(x) => set({ resting_hr: x.replace(/\D/g, "") })} placeholder="52" keyboardType="number-pad" inputMode="numeric" maxLength={3} />}
            </Field>
          </View>
        </Section>
      )}

      <Button size="lg" loading={save.isPending} onPress={submit}>{t("Salvar perfil")}</Button>
    </>
  );
}

function Zones({ p, who }: { p: AthleteProfile; who: string }) {
  const { theme } = useTheme();
  const paceZ = p.zones?.find((z) => z.kind === "pace"), hrZ = p.zones?.find((z) => z.kind === "hr");
  const head = (I: typeof Gauge, title: string, sub?: string | null) => (
    <View style={{ gap: theme.space["0.5"] }}>
      <View style={[styles.row, styles.center, { gap: theme.space[2] }]}>
        <I size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
        <Text variant="labelMd" accessibilityRole="header">{title}</Text>
      </View>
      {sub ? <Text variant="caption" tone="muted">{sub}</Text> : null}
    </View>
  );
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ gap: theme.space["0.5"], paddingHorizontal: theme.space[1] }}>
        <Text variant="overline" tone="subtle" accessibilityRole="header">{t("Suas zonas")}</Text>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <Info size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{t("Definidas por {who}. Os treinos usam esses valores para mostrar seus ritmos.", { who })}</Text>
        </View>
      </View>
      <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
        {head(Gauge, t("Ritmo"), paceZ ? t("Desde {d}", { d: fullDate(paceZ.valid_from) }) + (p.threshold_pace_s_per_km ? ` · ${t("limiar {p} /km", { p: pace(p.threshold_pace_s_per_km) })}` : "") : null)}
        {paceZ ? <ZoneTable z={paceZ} unit="pace" /> : <Text variant="bodySm" tone="muted">{t("Ainda sem zonas de ritmo. Informe uma prova recente para {who} calcular.", { who })}</Text>}
      </Card>
      <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
        {head(HeartPulse, t("Frequência cardíaca"), hrZ ? t("Desde {d}", { d: fullDate(hrZ.valid_from) }) : null)}
        {hrZ ? <ZoneTable z={hrZ} unit="hr" /> : <Text variant="bodySm" tone="muted">{t("Ainda sem zonas de FC. Informe sua FC máxima.")}</Text>}
      </Card>
    </View>
  );
}

function MyAssessments({ clubId }: { clubId: Club["id"] }) {
  const { theme } = useTheme();
  const list = useMyAssessments(clubId);
  if (!list.data?.length) return null;
  return (
    <Section title={t("Suas avaliações")} description={tn(list.data.length, "{n} avaliação registrada", "{n} avaliações registradas")} padded={false}>
      {list.data.map((a, i) => (
        <View key={a.id} accessible style={{ gap: theme.space["0.5"], paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }}>
          <View style={[styles.row, styles.between, { gap: theme.space[2] }]}>
            <Text variant="labelMd" style={styles.flex}>{t(ASSESSMENT_NAME[a.kind])}</Text>
            <Text variant="caption" tone="muted">{fullDate(a.date)}</Text>
          </View>
          <Text variant="bodySm" style={styles.tabular}>{assessmentHeadline(a.kind, a.result, a.data)}</Text>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  center: { alignItems: "center" },
  between: { justifyContent: "space-between", alignItems: "baseline" },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ["tabular-nums"] },
});

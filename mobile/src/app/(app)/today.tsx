/**
 * M1 · Hoje (student home; the web's screens/student/Today.tsx): greeting and streak, the week strip (tap a day to see
 * it), that day's workouts with "Concluir" (M5 sheet), the week's progress, the last activity, and, near the weekend or
 * once the week is done, whether next week is still in preparation (D-031). Works offline from the saved week.
 */
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { prefetchWorkouts, useMyCalendar, useMySummary, useMyWorkout, type MySummary } from "@/api/my";
import type { PlannedWorkout } from "@/api/types";
import { SportChip } from "@/components/sport";
import { FeedbackSheet } from "@/components/workout/FeedbackSheet";
import { LoadError, OfflineBanner, PreparingWeek } from "@/components/workout/states";
import { WeekStrip, dayState, type DayState } from "@/components/workout/WeekStrip";
import { WorkoutCard, openWorkout } from "@/components/workout/WorkoutCard";
import { Stat } from "@/components/workout/workout";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, duration, isoWeekday, km, longDate, mondayOf, pace, shortDate, today as todayFn, upperFirst } from "@/lib/format";
import { useOnline } from "@/lib/offline";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, ProgressBar, Screen, Skeleton, Text } from "@/ui";
import { ChevronRight, Coffee, Flame, ShieldAlert } from "@/ui/icons";

const greet = () => { const h = new Date().getHours(); return h < 12 ? t("Bom dia") : h < 18 ? t("Boa tarde") : t("Boa noite"); };

export default function TodayScreen() {
  const { theme } = useTheme();
  const { me, club } = useClub();
  const online = useOnline();
  const today = todayFn(club?.timezone);
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  // This week and the next (its workouts, once released, and whether it is still in preparation).
  const cal = useMyCalendar(club?.id, monday, addDays(monday, 13));
  const summary = useMySummary(club?.id);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; open: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const items = cal.data?.items ?? [];
  const thisWeek = items.filter((w) => w.date <= sunday);
  // This week's workouts with personal targets, ahead of time: opening one works offline.
  const ids = thisWeek.map((w) => w.id).join(",");
  useEffect(() => { if (club && online && ids) prefetchWorkouts(club.id, ids.split(",")); }, [club, online, ids]);

  if (!me || !club) return null;
  const selected = picked && picked >= monday && picked <= sunday ? picked : today;
  const byDay = (d: string) => thisWeek.filter((w) => w.date === d);
  const states: Record<string, DayState> = Object.fromEntries(Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return [d, dayState(byDay(d), d, today)]; }));
  const list = byDay(selected);
  const s = summary.data;
  const nextWeek = cal.data?.unreleased_weeks.find((u) => u.week_start === addDays(monday, 7));
  const left = thisWeek.filter((w) => w.date >= today && !w.completion).length;
  const upcoming = items.find((w) => w.date > selected && w.date >= today);
  const professor = club.trainer_label === "professor";

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([cal.refetch(), summary.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={[styles.header, { gap: theme.space[3] }]}>
        <View style={styles.flex}>
          <Text variant="overline" tone="muted">{longDate(today)}</Text>
          <Text variant="displaySm" accessibilityRole="header">{`${greet()}, ${me.user.name.split(" ")[0]}`}</Text>
        </View>
        {s && s.streak_weeks > 0 && <Streak weeks={s.streak_weeks} />}
      </View>

      <OfflineBanner error={cal.error} />
      {s && !s.shares_data && <NotSharing />}

      {cal.data ? (
        <>
          <WeekStrip monday={monday} today={today} states={states} selected={selected} onSelect={setPicked} />
          <View style={{ gap: theme.space[3] }}>
            <Text variant="overline" tone="muted" accessibilityRole="header">{selected === today ? t("Hoje") : upperFirst(shortDate(selected))}</Text>
            {list.length
              ? list.map((w) => <WorkoutCard key={w.id} w={w} professor={professor} onFeedback={() => setFeedback({ id: w.id, open: true })} />)
              : <RestDay past={selected < today} next={upcoming} />}
          </View>
          {nextWeek && (isoWeekday(today) >= 5 || left === 0) && <PreparingWeek club={club} week={nextWeek} next />}
        </>
      ) : cal.isPending ? (
        <View style={{ gap: theme.space[3] }} accessibilityLabel={t("Carregando…")}>
          <Skeleton style={{ height: theme.space[20] }} />
          <Skeleton style={{ height: theme.space[20] * 3 }} />
        </View>
      ) : (
        <LoadError error={cal.error} retrying={cal.isFetching} onRetry={() => void cal.refetch()} />
      )}

      {s && s.week.planned > 0 && <WeekCard week={s.week} />}
      {s?.last_activity && <LastActivity a={s.last_activity} />}

      {feedback && (
        <TodayFeedback clubId={club.id} id={feedback.id} fallback={items.find((w) => w.id === feedback.id)} open={feedback.open}
          onOpenChange={(open) => setFeedback(open ? feedback : { ...feedback, open: false })} />
      )}
    </Screen>
  );
}

/** The sheet with the detail's candidate activities when they are already on the device (prefetched). */
function TodayFeedback({ clubId, id, fallback, open, onOpenChange }: { clubId: string; id: string; fallback: PlannedWorkout | undefined; open: boolean; onOpenChange: (v: boolean) => void }) {
  const detail = useMyWorkout(clubId, id);
  const w = detail.data ?? fallback;
  if (!w) return null;
  return <FeedbackSheet clubId={clubId} workout={w} activities={detail.data?.candidate_activities} open={open} onOpenChange={onOpenChange} />;
}

function Streak({ weeks }: { weeks: number }) {
  const { theme } = useTheme();
  const a = theme.color.accent;
  return (
    <View accessible accessibilityLabel={tn(weeks, "Sequência de {n} semana treinando", "Sequência de {n} semanas treinando")}
      style={[styles.pill, { gap: theme.space["1.5"], height: theme.space[8], paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, backgroundColor: a.subtle, borderColor: a.border }]}>
      <Flame size={theme.size.iconSm} color={a.subtleFg} aria-hidden />
      <Text variant="labelSm" color={a.subtleFg}>{tn(weeks, "{n} semana", "{n} semanas")}</Text>
    </View>
  );
}

/** The student isn't sharing training data with the club (LGPD consent): the trainer sees nothing. */
function NotSharing() {
  const { theme } = useTheme();
  const w = theme.color.warning;
  return (
    <Pressable accessibilityRole="link" accessibilityHint={t("Abre o perfil para ajustar")} onPress={() => router.navigate("/account")}
      style={({ pressed }) => [styles.row, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: pressed ? w.subtleHover : w.subtle, borderWidth: 1, borderColor: w.border }]}>
      <ShieldAlert size={theme.size.iconSm} color={w.subtleFg} style={{ marginTop: theme.space["0.5"] }} aria-hidden />
      <Text variant="bodySm" color={w.subtleFg} style={styles.flex}>
        {t("Você não está compartilhando seus treinos com o clube. O treinador não vê seu progresso.")} <Text variant="labelSm" color={w.subtleFg} style={styles.underline}>{t("Ajustar")}</Text>
      </Text>
    </Pressable>
  );
}

function RestDay({ past, next }: { past: boolean; next: PlannedWorkout | undefined }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.row, styles.center, { gap: theme.space[4] }]}>
        <View style={[styles.round, { width: theme.space[12], height: theme.space[12], borderRadius: theme.radius.full, backgroundColor: c.soft }]}>
          <Coffee size={theme.size.iconLg} color={c.fgMuted} aria-hidden />
        </View>
        <View style={styles.flex}>
          <Text variant="titleSm">{t("Dia de descanso")}</Text>
          <Text variant="bodySm" tone="muted">{past ? t("Nenhum treino neste dia.") : t("Recuperar também é treino. Aproveite!")}</Text>
        </View>
      </View>
      {!past && next && (
        <Pressable accessibilityRole="link" accessibilityLabel={t("Próximo treino: {title}, {date}", { title: next.title, date: shortDate(next.date) })} onPress={() => openWorkout(next.id)}
          style={({ pressed }) => [styles.row, styles.center, { gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[2], paddingHorizontal: theme.space[3], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : c.sunken }]}>
          <View style={styles.flex}>
            <Text variant="caption" tone="muted">{t("Próximo treino · {date}", { date: shortDate(next.date) })}</Text>
            <Text variant="labelMd" numberOfLines={1}>{next.title}</Text>
          </View>
          <SportChip sport={next.sport} size="sm" />
          <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />
        </Pressable>
      )}
    </Card>
  );
}

function WeekCard({ week }: { week: MySummary["week"] }) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={styles.between}>
        <Text variant="titleSm" accessibilityRole="header">{t("Sua semana")}</Text>
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/schedule")} hitSlop={theme.space[2]}
          style={({ pressed }) => [styles.row, styles.center, { minHeight: theme.size.touchMin - theme.space[2], opacity: pressed ? 0.7 : 1 }]}>
          <Text variant="labelSm" tone="brand">{t("Agenda")}</Text>
          <ChevronRight size={theme.size.iconSm} color={theme.color.brand.text} aria-hidden />
        </Pressable>
      </View>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Stat style={styles.flex} value={`${week.done}/${week.planned}`} label={t("Treinos feitos")} />
        <Stat style={styles.flex} value={duration(week.duration_s)} label={t("Tempo planejado")} />
        <Stat style={styles.flex} value={week.distance_m ? km(week.distance_m) : "–"} unit={week.distance_m ? "km" : undefined} label={t("Distância")} />
      </View>
      <ProgressBar value={week.done} max={week.planned} label={t("Treinos feitos na semana")} />
    </Card>
  );
}

function LastActivity({ a }: { a: NonNullable<MySummary["last_activity"]> }) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={styles.between}>
        <Text variant="titleSm" accessibilityRole="header">{t("Última atividade")}</Text>
        <Text variant="caption" tone="muted">{a.source === "strava" ? t("via Strava") : t("manual")}</Text>
      </View>
      <Text variant="bodySm" tone="muted" numberOfLines={1}>{a.name} · {shortDate(a.started_at.slice(0, 10))}</Text>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        {a.distance_m ? <Stat style={styles.flex} value={km(a.distance_m)} unit="km" label={t("Distância")} /> : null}
        <Stat style={styles.flex} value={duration(a.duration_s)} label={t("Tempo")} />
        {a.avg_pace_s_per_km ? <Stat style={styles.flex} value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace médio")} /> : null}
        {a.avg_hr && !(a.distance_m && a.avg_pace_s_per_km) ? <Stat style={styles.flex} value={String(a.avg_hr)} unit="bpm" label={t("FC média")} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end" },
  row: { flexDirection: "row" },
  center: { alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  pill: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  round: { alignItems: "center", justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});

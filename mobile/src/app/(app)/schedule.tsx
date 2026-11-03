/**
 * M3 · Agenda (student; the web's screens/student/Schedule.tsx): the week as a list of days or the month as a
 * calendar (tap a day to see its workouts), how past workouts went, and weeks the trainer is still preparing (D-031).
 * The weeks around the one on screen load ahead, so moving between them is instant; this week works offline.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { prefetchCalendar, useMyCalendar } from "@/api/my";
import type { PlannedWorkout } from "@/api/types";
import { SPORT_LABEL } from "@/components/sport";
import { MonthGrid, monthRange, monthStart } from "@/components/workout/MonthGrid";
import { LoadError, OfflineBanner, PreparingWeek } from "@/components/workout/states";
import { estimateText } from "@/domain/workout";
import { openWorkout } from "@/components/workout/WorkoutCard";
import { StatusBadge, statusLabel, type WorkoutStatus } from "@/components/workout/workout";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, mondayOf, monthTitle, today as todayFn, upperFirst, weekdayLong, weekdayShort } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, IconButton, PageHeader, Screen, Segmented, Skeleton, Text } from "@/ui";
import { CalendarClock, ChevronLeft, ChevronRight, Coffee } from "@/ui/icons";

type Span = "week" | "month";

/** The days a view shows: Monday–Sunday, or the whole weeks that cover the month. */
function range(view: Span, anchor: string) {
  if (view === "week") { const first = mondayOf(anchor); return { first, last: addDays(first, 6) }; }
  return monthRange(anchor);
}
const shift = (view: Span, anchor: string, dir: 1 | -1) => (view === "week" ? addDays(anchor, 7 * dir) : monthStart(anchor, dir));
/** A workout's state on the calendar: the completion's, "Sem registro" once its day has passed, else none. */
const statusOf = (w: PlannedWorkout, today: string): WorkoutStatus | null => w.completion?.status ?? (w.date < today ? "unlogged" : null);

export default function ScheduleScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [view, setView] = useState<Span>("week");
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { first, last } = range(view, anchor);
  const q = useMyCalendar(club?.id, first, last);

  // Load the previous and next period once this one is here.
  const loaded = !!q.data;
  useEffect(() => {
    if (!club?.id || !loaded) return;
    for (const dir of [1, -1] as const) { const r = range(view, shift(view, anchor, dir)); void prefetchCalendar(club.id, r.first, r.last); }
  }, [club?.id, loaded, view, anchor]);

  if (!club) return null;
  const items = q.data?.items ?? [];
  const pending = q.data?.unreleased_weeks ?? [];
  const byDay = (d: string) => items.filter((w) => w.date === d);
  const days = Array.from({ length: Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1 }, (_, i) => addDays(first, i));
  const containsToday = view === "week" ? today >= first && today <= last : today.slice(0, 7) === anchor.slice(0, 7);
  const title = view === "week" ? `${dayMonth(first)} – ${dayMonth(last)}` : monthTitle(anchor);
  const preparing = view === "week" ? pending.find((p) => p.week_start === first) : undefined;
  const move = (dir: 1 | -1) => { setAnchor(shift(view, anchor, dir)); setPicked(null); };
  const refresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <PageHeader title={t("Agenda")} actions={
        <Segmented<Span> label={t("Visão")} value={view} onChange={(v) => { setView(v); setPicked(null); }} style={styles.grow}
          options={[{ value: "week", label: t("Semana") }, { value: "month", label: t("Mês") }]} />
      } />

      <View style={[styles.row, styles.center, { gap: theme.space[2] }]}>
        <IconButton variant="secondary" icon={ChevronLeft} label={view === "week" ? t("Semana anterior") : t("Mês anterior")} onPress={() => move(-1)} />
        <Text variant="titleSm" accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.flex, styles.centerText]}>{title}</Text>
        <IconButton variant="secondary" icon={ChevronRight} label={view === "week" ? t("Próxima semana") : t("Próximo mês")} onPress={() => move(1)} />
        {!containsToday && <Button variant="ghost" onPress={() => { setAnchor(today); setPicked(null); }}>{t("Hoje")}</Button>}
      </View>

      <OfflineBanner error={q.error} />

      {!q.data && !q.isPending ? (
        <LoadError error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />
      ) : view === "week" ? (
        preparing ? <PreparingWeek club={club} week={preparing} />
        : q.data && !items.length ? (
          <Card><EmptyState icon={Coffee} title={t("Semana livre")}>{t("Quando seu treinador montar a semana, os treinos aparecem aqui.")}</EmptyState></Card>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            {days.map((d) => <DayRow key={d} date={d} today={today} workouts={byDay(d)} loading={!q.data} />)}
          </View>
        )
      ) : (
        <>
          {pending.length > 0 && (
            <View style={[styles.row, styles.center, { gap: theme.space[2] }]}>
              <CalendarClock size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
              <Text variant="bodySm" tone="muted" style={styles.flex}>
                {t("Em preparação: {weeks}.", { weeks: pending.map((p) => `${dayMonth(p.week_start)} – ${dayMonth(addDays(p.week_start, 6))}`).join(", ") })}
              </Text>
            </View>
          )}
          <MonthGrid days={days} month={anchor.slice(0, 7)} today={today} byDay={byDay} selected={picked ?? (containsToday ? today : null)} onSelect={setPicked} />
          {(() => {
            const sel = picked ?? (containsToday ? today : null);
            if (!sel || !q.data) return null;
            const ws = byDay(sel);
            return (
              <View style={{ gap: theme.space[2] }}>
                <Text variant="overline" tone="muted" accessibilityRole="header">{sel === today ? t("Hoje") : upperFirst(`${weekdayLong(sel)}, ${dayMonth(sel)}`)}</Text>
                {ws.length ? (
                  <Card style={{ padding: theme.space[2], gap: theme.space[1] }}>{ws.map((w) => <WorkoutRow key={w.id} w={w} today={today} />)}</Card>
                ) : (
                  <Text variant="bodySm" tone="subtle">{pending.some((p) => sel >= p.week_start && sel <= addDays(p.week_start, 6)) ? t("Semana em preparação.") : t("Descanso")}</Text>
                )}
              </View>
            );
          })()}
        </>
      )}
    </Screen>
  );
}

/** A workout in the list: sport bar, title and estimate, then how it went (or a chevron for what is ahead). */
function WorkoutRow({ w, today }: { w: PlannedWorkout; today: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const status = statusOf(w, today);
  const est = estimateText(w);
  return (
    <Pressable accessibilityRole="link" onPress={() => openWorkout(w.id)}
      accessibilityLabel={[t(SPORT_LABEL[w.sport]), w.title, est, status ? statusLabel(status) : null].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, styles.center, { gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[2], padding: theme.space["1.5"], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
      <View aria-hidden style={{ width: theme.space[1], alignSelf: "stretch", borderRadius: theme.radius.full, backgroundColor: c.sport[w.sport].solid }} />
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={1}>{w.title}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{[t(SPORT_LABEL[w.sport]), est].filter(Boolean).join(" · ")}</Text>
      </View>
      {status ? <StatusBadge status={status} /> : <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />}
    </Pressable>
  );
}

function DayRow({ date, today, workouts, loading }: { date: string; today: string; workouts: PlannedWorkout[]; loading: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const isToday = date === today;
  return (
    <View style={[styles.row, {
      gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.lg, borderWidth: isToday ? 2 : 1,
      borderColor: isToday ? c.brand.ring : c.line, backgroundColor: c.surface, opacity: !isToday && date < today && !workouts.length ? 0.85 : 1,
    }]}>
      <View accessible accessibilityRole="header" accessibilityLabel={`${weekdayLong(date)}, ${dayMonth(date)}${isToday ? `, ${t("hoje")}` : ""}`}
        style={[styles.date, { width: theme.space[12], paddingVertical: theme.space[1] }]}>
        <Text variant="overline" color={isToday ? c.brand.text : c.fgMuted}>{weekdayShort(date)}</Text>
        <Text variant="metricMd" color={isToday ? c.brand.text : c.fg}>{Number(date.slice(8))}</Text>
      </View>
      <View style={[styles.flex, styles.middle]}>
        {loading ? <Skeleton style={{ height: theme.space[8], marginHorizontal: theme.space[1] }} />
          : workouts.length ? workouts.map((w) => <WorkoutRow key={w.id} w={w} today={today} />)
          : <Text variant="bodySm" tone="subtle" style={{ paddingHorizontal: theme.space["1.5"] }}>{t("Descanso")}</Text>}
      </View>
    </View>
  );
}

/** The month as whole weeks: day number and one bar per workout (sport color; missed in red; faded until done). */
const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  center: { alignItems: "center" },
  middle: { justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  centerText: { textAlign: "center" },
  grow: { flexGrow: 1 },
  date: { alignItems: "center", justifyContent: "center" },
  clip: { overflow: "hidden" },
  cell: { flex: 1, minWidth: 0, alignItems: "center" },
  num: { alignItems: "center", justifyContent: "center" },
  tabular: { fontVariant: ["tabular-nums"], fontWeight: weight("bold") },
});

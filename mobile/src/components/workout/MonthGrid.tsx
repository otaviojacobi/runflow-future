/**
 * A month as a calendar (Monday first; the weeks that cover it): per day its number and a bar per workout (the sport's
 * color; red when missed; faded until done), today tinted, the picked day ringed. The student's Agenda (M3) and the
 * trainer's view of a student (W3) use it; tapping a day hands it to the screen, which lists that day below.
 */
import { Pressable, StyleSheet, View } from "react-native";
import type { PlannedWorkout } from "@/api/types";
import { t, tn } from "@/i18n";
import { addDays, dayMonth, mondayOf, weekdayLong } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Text } from "@/ui";

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** First day of the month `n` months from the one `d` is in. */
export const monthStart = (d: string, n = 0) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 10); };
/** The whole weeks (Monday–Sunday) that cover the month `anchor` is in. */
export function monthRange(anchor: string) {
  const start = monthStart(anchor);
  return { first: mondayOf(start), last: addDays(mondayOf(addDays(monthStart(anchor, 1), -1)), 6) };
}
/** Every day from `first` to `last`. */
export const dayList = (first: string, last: string) =>
  Array.from({ length: Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1 }, (_, i) => addDays(first, i));

export function MonthGrid({ days, month, today, byDay, selected, onSelect }: {
  days: string[]; month: string; today: string; byDay: (d: string) => PlannedWorkout[]; selected: string | null; onSelect: (d: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  return (
    <Card style={styles.clip}>
      <View style={[styles.row, { backgroundColor: c.sunken }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((d) => <Text key={d} variant="overline" tone="muted" style={[styles.flex, styles.centerText, { paddingVertical: theme.space[2] }]}>{t(d)}</Text>)}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.row}>
          {week.map((d, i) => {
            const ws = byDay(d);
            const out = d.slice(0, 7) !== month;
            const isToday = d === today;
            const isSel = d === selected;
            const done = ws.filter((w) => w.completion && w.completion.status !== "missed").length;
            const label = `${weekdayLong(d)}, ${dayMonth(d)}${isToday ? `, ${t("hoje")}` : ""}: ${ws.length ? tn(ws.length, "{n} treino", "{n} treinos") + (done ? `, ${tn(done, "{n} feito", "{n} feitos")}` : "") : t("descanso")}`;
            return (
              <Pressable key={d} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: isSel }} onPress={() => onSelect(d)}
                style={({ pressed }) => [styles.cell, {
                  minHeight: theme.space[16], padding: theme.space[1], gap: theme.space[1],
                  borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.lineSubtle,
                  backgroundColor: pressed ? c.soft : isToday ? c.brand.subtle : out ? c.sunken : "transparent",
                }]}>
                <View style={[styles.num, {
                  width: theme.space[6], height: theme.space[6], borderRadius: theme.radius.full,
                  borderWidth: isSel ? 2 : 0, borderColor: c.brand.ring,
                }]}>
                  <Text variant="labelSm" color={isToday ? c.brand.text : out ? c.fgSubtle : c.fg} style={styles.tabular}>{Number(d.slice(8))}</Text>
                </View>
                {ws.slice(0, 3).map((w) => {
                  const missed = w.completion?.status === "missed";
                  return <View key={w.id} aria-hidden style={{ height: theme.space["1.5"], alignSelf: "stretch", borderRadius: theme.radius.full, backgroundColor: missed ? c.danger.solid : c.sport[w.sport].solid, opacity: w.completion && !missed ? 1 : 0.55 }} />;
                })}
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  flex: { flex: 1, minWidth: 0 },
  centerText: { textAlign: "center" },
  clip: { overflow: "hidden" },
  cell: { flex: 1, minWidth: 0, alignItems: "center" },
  num: { alignItems: "center", justifyContent: "center" },
  tabular: { fontVariant: ["tabular-nums"], fontWeight: weight("bold") },
});

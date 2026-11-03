/**
 * Monday–Sunday strip (the web's components/week.tsx): each day colored by how its workouts went, today filled with
 * the club's color, the selected day ringed. Tapping a day selects it. Day state comes from `dayState`.
 */
import { Pressable, StyleSheet, View } from "react-native";
import type { PlannedWorkout } from "@/api/types";
import { t } from "@/i18n";
import { addDays, weekdayLong } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";

export type DayState = "done" | "partial" | "missed" | "planned" | "rest";
const LETTER = ["S", "T", "Q", "Q", "S", "S", "D"];
const SPOKEN: Record<DayState, string> = { rest: "descanso", planned: "treino planejado", done: "feito", partial: "feito em parte", missed: "não feito" };

/** How a day went: all done, some done, all missed (past days), or planned. No workouts = rest. */
export function dayState(ws: PlannedWorkout[], date: string, today: string): DayState {
  if (!ws.length) return "rest";
  const st = ws.map((w) => w.completion?.status);
  if (st.every((s) => s === "completed")) return "done";
  if (st.some((s) => s === "completed" || s === "partial")) return "partial";
  if (date < today && st.every((s) => !s || s === "missed" || s === "skipped")) return "missed";
  return "planned";
}

export function WeekStrip({ monday, today, states, selected, onSelect }: { monday: string; today: string; states: Record<string, DayState>; selected: string; onSelect: (date: string) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const circle = theme.space[8];
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t("Dias da semana")}
      style={[styles.strip, { gap: theme.space["0.5"], paddingHorizontal: theme.space["1.5"], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, borderColor: c.line, backgroundColor: c.surface }]}>
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(monday, i);
        const st = states[date] ?? "rest";
        const isToday = date === today;
        const isSel = date === selected;
        const fill = isToday ? c.brand.solid : st === "done" ? c.success.subtle : st === "partial" ? c.warning.subtle : st === "missed" ? c.danger.subtle : "transparent";
        const fg = isToday ? c.brand.onSolid : st === "done" ? c.success.subtleFg : st === "partial" ? c.warning.subtleFg : st === "missed" ? c.danger.subtleFg : st === "rest" ? c.fgSubtle : c.fg;
        const dot = st === "rest" ? "transparent" : isToday && st === "planned" ? c.brand.solid : st === "done" ? c.success.solid : st === "partial" ? c.warning.solid : st === "missed" ? c.danger.solid : c.fgSubtle;
        const name = `${weekdayLong(date)}, ${Number(date.slice(8))}${isToday ? `, ${t("hoje")}` : ""}, ${t(SPOKEN[st])}`;
        return (
          <Pressable key={date} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: isSel }} onPress={() => onSelect(date)}
            style={({ pressed }) => [styles.day, { gap: theme.space[1], minHeight: theme.size.touchMin + theme.space[4], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
            <Text variant="caption" color={isToday ? c.brand.text : c.fgSubtle} style={styles.letter}>{LETTER[i]}</Text>
            <View style={[styles.center, {
              width: circle, height: circle, borderRadius: theme.radius.full, backgroundColor: fill,
              borderWidth: isSel && !isToday ? 2 : 0, borderColor: c.brand.ring,
            }]}>
              <Text variant="labelMd" color={fg} style={[styles.num, st === "rest" && !isToday && styles.light]}>{Number(date.slice(8))}</Text>
            </View>
            <View aria-hidden style={{ width: theme.space["1.5"], height: theme.space["1.5"], borderRadius: theme.radius.full, backgroundColor: dot }} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", borderWidth: 1 },
  day: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  letter: { fontWeight: weight("bold") },
  num: { fontVariant: ["tabular-nums"] },
  light: { fontWeight: weight("medium") },
});

/** An activity as a list row (M4, and later the trainer's view of a student): sport tile, name, when, source, the
 * workout it matched, and its distance or time. */
import { Pressable, StyleSheet, View } from "react-native";
import type { ActivityItem } from "@/api/types";
import { SPORT_ICON } from "@/components/sport";
import { t } from "@/i18n";
import { distance, duration, localDate, pace, shortDate, timeOf } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";
import { ChevronRight } from "@/ui/icons";

export function ActivityRow({ a, onPress }: { a: ActivityItem; onPress?: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const s = c.sport[a.sport];
  const I = SPORT_ICON[a.sport];
  const meta = [shortDate(localDate(a.started_at)), timeOf(a.started_at), a.source === "strava" ? "Strava" : t("manual"), a.matched_workout ? t("treino: {x}", { x: a.matched_workout.title }) : null].filter(Boolean).join(" · ");
  const main = a.distance_m ? distance(a.distance_m, { swim: a.sport === "swim" }) : duration(a.duration_s);
  const sub = a.avg_pace_s_per_km && a.sport === "run" ? `${pace(a.avg_pace_s_per_km)} /km` : a.distance_m ? duration(a.duration_s) : "";
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${a.name}, ${meta}, ${main}`} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[4], paddingHorizontal: theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
      <View aria-hidden style={[styles.center, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.lg, backgroundColor: s.solid }]}>
        <I size={theme.size.iconMd} color={s.onSolid} />
      </View>
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={1}>{a.name}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{meta}</Text>
      </View>
      <View style={styles.end}>
        <Text variant="labelMd" style={styles.tabular}>{main}</Text>
        {sub ? <Text variant="caption" tone="muted" style={styles.tabular}>{sub}</Text> : null}
      </View>
      {onPress && <ChevronRight size={theme.size.iconSm} color={c.fgSubtle} aria-hidden />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  end: { alignItems: "flex-end" },
  tabular: { fontVariant: ["tabular-nums"] },
});

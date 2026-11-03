/**
 * Workout bits shared by the student's screens, mirroring the web's components/workout.tsx: the intensity profile
 * (one bar per segment: width = time, height and color = zone; zone colors are data colors, root.md §6), the status
 * badge, a stat (big tabular number + unit) and the feelings of the feedback.
 */
import type { CompletionStatus, Feeling, Sport } from "@/api/types";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Text, type Tone } from "@/ui";
import { Check, Circle, CircleDashed, Minus, X, type Icon } from "@/ui/icons";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { segments, type Structure, type ZoneN } from "@/domain/workout";

const ZONE_H: Record<ZoneN, `${number}%`> = { 1: "30%", 2: "46%", 3: "62%", 4: "82%", 5: "100%" };

export function IntensityProfile({ structure, sport, height, style }: { structure: Structure; sport: Sport; height?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const segs = segments(structure, sport);
  const h = height ?? theme.space[12];
  if (!segs.length) {
    return (
      <View style={[styles.empty, { height: h, borderRadius: theme.radius.md, borderColor: theme.color.line }, style]}>
        <Text variant="caption" tone="subtle">{t("Sem etapas ainda")}</Text>
      </View>
    );
  }
  return (
    <View accessibilityRole="image" accessibilityLabel={t("Perfil de intensidade")} style={[styles.profile, { height: h, gap: theme.space["0.5"] }, style]}>
      {segs.map((s, i) => (
        <View key={i} style={{
          flexGrow: s.seconds, flexShrink: 1, flexBasis: 0, minWidth: theme.space[1], height: ZONE_H[s.zone], backgroundColor: theme.color.zone[s.zone].solid,
          borderTopLeftRadius: theme.radius.xs, borderTopRightRadius: theme.radius.xs,
        }} />
      ))}
    </View>
  );
}

/** A small square in a zone's color (step lists). */
export function ZoneDot({ zone }: { zone: ZoneN }) {
  const { theme } = useTheme();
  const side = theme.space[2] + theme.space["0.5"];
  return <View aria-hidden style={{ width: side, height: side, borderRadius: theme.radius.xs, backgroundColor: theme.color.zone[zone].solid }} />;
}

/** A workout's state: the completion's, "Planejado", or "Sem registro" for a past day with no feedback. */
export type WorkoutStatus = CompletionStatus | "planned" | "unlogged";
const STATUS: Record<WorkoutStatus, { label: string; tone: Tone; icon: Icon }> = {
  planned: { label: "Planejado", tone: "neutral", icon: Circle },
  completed: { label: "Concluído", tone: "success", icon: Check },
  partial: { label: "Parcial", tone: "warning", icon: Minus },
  missed: { label: "Não realizado", tone: "danger", icon: X },
  skipped: { label: "Pulado", tone: "neutral", icon: CircleDashed },
  unlogged: { label: "Sem registro", tone: "neutral", icon: CircleDashed },
};
export const statusLabel = (s: WorkoutStatus) => t(STATUS[s].label);
export function StatusBadge({ status, solid, style }: { status: WorkoutStatus; solid?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} solid={solid} icon={s.icon} style={[styles.center, style]}>{t(s.label)}</Badge>;
}

/** A number with a smaller unit (4:30 /km) and a caption under it. */
export function Stat({ value, unit, label, size = "md", style }: { value: string; unit?: string; label?: string; size?: "md" | "lg"; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.stat, style]} accessible accessibilityLabel={[label, `${value}${unit ? " " + unit : ""}`].filter(Boolean).join(": ")}>
      <View style={[styles.baseline, { gap: theme.space[1] }]}>
        <Text variant={size === "lg" ? "metricLg" : "metricMd"} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.shrink}>{value}</Text>
        {unit ? <Text variant="caption" tone="muted">{unit}</Text> : null}
      </View>
      {label ? <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: theme.space[1] }}>{label}</Text> : null}
    </View>
  );
}

/** How the student felt (M5), with the emoji shown in the sheet. */
export const FEELINGS: { value: Feeling; emoji: string; label: string }[] = [
  { value: "great", emoji: "😄", label: "Ótimo" }, { value: "good", emoji: "🙂", label: "Bem" }, { value: "ok", emoji: "😐", label: "Normal" },
  { value: "bad", emoji: "😮‍💨", label: "Cansado" }, { value: "awful", emoji: "😣", label: "Muito mal" },
];
export const feelingLabel = (f: Feeling) => t(FEELINGS.find((x) => x.value === f)!.label);
/** PSE 1–10 in words (index = value). */
export const RPE_LABEL = ["", "Muito leve", "Muito leve", "Leve", "Leve", "Moderado", "Moderado", "Difícil", "Muito difícil", "Quase máximo", "Máximo"];

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed" },
  profile: { flexDirection: "row", alignItems: "flex-end" },
  stat: { minWidth: 0 },
  // The kit's Badge hugs the top of a row; workout rows center it with their text.
  center: { alignSelf: "center" },
  baseline: { flexDirection: "row", alignItems: "baseline" },
  shrink: { flexShrink: 1 },
});

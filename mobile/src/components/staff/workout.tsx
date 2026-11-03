/**
 * Staff-only workout pieces (the web's components/workout.tsx, phone-sized): compliance bar, sport bar, the
 * workout row used by Painel, Aluno and Planejamento, the unread count, filter chips and the section card. The status
 * badge, stat, intensity profile and steps are the student screens' (components/workout).
 */
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { AthleteRef, PlannedWorkout, Sport } from "@/api/types";
import { StatusBadge, feelingLabel, statusLabel } from "@/components/workout/workout";
import { estimateText } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { shortDate, weekdayShort } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Card, Text } from "@/ui";
import { EyeOff, MessageSquare } from "@/ui/icons";

export const complianceTone = (pct: number): "success" | "warning" | "danger" => (pct >= 80 ? "success" : pct >= 60 ? "warning" : "danger");
/** 28-day compliance: the number in its tone plus a thin bar (never color alone: the number is the value). */
export function ComplianceBar({ pct, style }: { pct: number | null; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  if (pct == null) return <Text variant="bodySm" tone="subtle">–</Text>;
  const tone = complianceTone(pct);
  return (
    <View style={[{ gap: theme.space[1] }, style]} accessibilityLabel={t("Aderência de {p}%", { p: pct })}>
      <Text variant="labelSm" tone={tone} style={styles.tabular}>{`${pct}%`}</Text>
      <View style={[styles.track, { height: theme.space[1], borderRadius: theme.radius.full, backgroundColor: theme.color.soft }]}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: theme.radius.full, backgroundColor: theme.color[tone].solid }} />
      </View>
    </View>
  );
}

/** The sport's color as a thin vertical bar (identity also comes from the title/label next to it). */
export function SportBar({ sport, style }: { sport: Sport; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return <View aria-hidden style={[{ width: theme.space[1], alignSelf: "stretch", borderRadius: theme.radius.full, backgroundColor: theme.color.sport[sport].solid }, style]} />;
}

/**
 * A planned workout in a list. With `athlete` it leads with the student (Painel, Planejamento); with `showDate` with
 * the day (Aluno). Trailing: the completion, "Ainda não" today, "Sem registro" for a past day without one.
 */
export function WorkoutRow({ w, athlete, showDate, today, onPress, divider }: { w: PlannedWorkout; athlete?: AthleteRef; showDate?: boolean; today: string; onPress: () => void; divider?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const st = w.completion?.status;
  const meta = estimateText(w);
  const pendingText = !st ? (w.date === today ? t("Ainda não") : w.date < today ? t("Sem registro") : null) : null;
  const feel = w.completion?.feeling ? feelingLabel(w.completion.feeling) : null;
  const rpe = w.completion?.rpe ? t("PSE {n}", { n: w.completion.rpe }) : null;
  const label = [
    athlete?.user.name, showDate ? shortDate(w.date) : null, w.title, meta, !w.visible ? t("rascunho") : null,
    st ? statusLabel(st) : pendingText, feel, rpe, w.unread_count ? tn(w.unread_count, "{n} comentário novo", "{n} comentários novos") : null,
  ].filter(Boolean).join(", ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.row, {
        gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[3], paddingVertical: theme.space[2], paddingHorizontal: theme.space[3],
        backgroundColor: pressed ? c.soft : "transparent", borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle,
      }]}>
      {athlete ? <Avatar name={athlete.user.name} src={athlete.user.avatar_url} size={theme.space[8] + theme.space[1]} /> : showDate ? (
        <View style={[styles.center, { width: theme.space[10] }]}>
          <Text variant="overline" tone={w.date === today ? "brand" : "muted"}>{weekdayShort(w.date)}</Text>
          <Text variant="titleMd" tone={w.date === today ? "brand" : "default"} style={styles.tabular}>{String(Number(w.date.slice(8)))}</Text>
        </View>
      ) : null}
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        {athlete && <Text variant="labelMd" numberOfLines={1}>{athlete.user.name}</Text>}
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <SportBar sport={w.sport} style={{ alignSelf: "auto", height: theme.space[3] + theme.space["0.5"] }} />
          <Text variant={athlete ? "bodySm" : "labelMd"} tone={athlete ? "muted" : "default"} numberOfLines={1} style={styles.shrink}>{w.title}</Text>
          {!w.visible && <EyeOff size={theme.size.iconSm - 2} color={c.fgSubtle} aria-hidden />}
        </View>
        {meta || feel || rpe ? <Text variant="caption" tone="muted" numberOfLines={1}>{[meta, feel, rpe].filter(Boolean).join(" · ")}</Text> : null}
      </View>
      <View style={[styles.trailing, { gap: theme.space[1] }]}>
        {st ? <StatusBadge status={st} /> : pendingText ? <Text variant="caption" tone="subtle" style={{ fontWeight: weight("semibold") }}>{pendingText}</Text> : null}
        {w.unread_count > 0 ? <Count n={w.unread_count} /> : w.comments_count > 0 ? <MessageSquare size={theme.size.iconSm - 2} color={c.fgSubtle} aria-hidden /> : null}
      </View>
    </Pressable>
  );
}

/** Unread count bubble. */
export function Count({ n }: { n: number }) {
  const { theme } = useTheme();
  return (
    <View aria-hidden style={[styles.center, { minWidth: theme.space[5], height: theme.space[5], paddingHorizontal: theme.space[1], borderRadius: theme.radius.full, backgroundColor: theme.color.danger.solid }]}>
      <Text variant="caption" color={theme.color.danger.onSolid} style={[styles.tabular, { fontWeight: weight("bold") }]}>{n > 9 ? "9+" : String(n)}</Text>
    </View>
  );
}

/** A row of filter pills (groups, inbox filters): one choice at a time, scrolls sideways when it doesn't fit. */
export function FilterChips<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; label: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const h = theme.space[8] + theme.space[1];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label}
      style={{ marginHorizontal: -theme.space[4], flexGrow: 0 }} contentContainerStyle={{ gap: theme.space["1.5"], paddingHorizontal: theme.space[4] }}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <Pressable key={it.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={it.count != null ? `${it.label}, ${it.count}` : it.label}
            onPress={() => onChange(it.value)} hitSlop={(theme.size.touchMin - h) / 2}
            style={({ pressed }) => [styles.row, {
              height: h, gap: theme.space["1.5"], paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, borderWidth: 1,
              borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
            }]}>
            <Text variant="labelSm" color={on ? c.brand.subtleFg : c.fgMuted} numberOfLines={1}>{it.label}</Text>
            {it.count != null && (
              <View style={{ minWidth: theme.space[5], paddingHorizontal: theme.space[1], borderRadius: theme.radius.full, backgroundColor: on ? c.surface : c.soft }}>
                <Text variant="caption" color={c.fg} style={[styles.tabular, styles.centerText]}>{String(it.count)}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A card with a title row (and an optional action on the right). */
export function Section({ title, action, children, flush, style }: { title: string; action?: ReactNode; children: ReactNode; flush?: boolean; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <Card style={[{ paddingVertical: theme.space[4], gap: theme.space[3] }, !flush && { paddingHorizontal: theme.space[4] }, style]}>
      <View style={[styles.row, { gap: theme.space[3], minHeight: theme.size.controlSm }, flush && { paddingHorizontal: theme.space[4] }]}>
        <Text variant="titleMd" accessibilityRole="header" style={styles.flex}>{title}</Text>
        {action}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  trailing: { alignItems: "flex-end", flexShrink: 0 },
  track: { overflow: "hidden" },
  tabular: { fontVariant: ["tabular-nums"] },
});

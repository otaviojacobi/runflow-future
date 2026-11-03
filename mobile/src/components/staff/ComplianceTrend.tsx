/**
 * Weekly compliance bars (the web's ComplianceTrend, phone-sized). One series, so no legend: the section title names
 * it. Thin bars with 4 pt rounded data-ends on the baseline and 2 pt gaps, a recessive 50/100 % grid, only the latest
 * finished week labeled. Bars are the club's brand `text` role (≥ 4.5:1 on the surface for any club color); the week
 * in progress is a soft outline. Tapping a bar shows its week below (the phone's tooltip); each bar is also a button
 * with the full reading for screen readers.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { TrendPoint } from "@/api/staff";
import { t } from "@/i18n";
import { dayMonth } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";

const reading = (d: TrendPoint) =>
  `${t("Semana de {d}", { d: dayMonth(d.week_start) })}${d.current ? ` (${t("em andamento")})` : ""}: ${d.pct != null ? t("{p}% de aderência", { p: d.pct }) : t("sem treinos")}, ${t("{done} de {planned} treinos", { done: d.done, planned: d.planned })}`;

export function ComplianceTrend({ data, height }: { data: TrendPoint[]; height?: number }) {
  const { theme } = useTheme();
  const c = theme.color;
  const plot = height ?? theme.space[20] + theme.space[10];
  const label = theme.space[5];
  const [sel, setSel] = useState<number | null>(null);
  const lastIdx = data.map((d) => d.pct != null && !d.current).lastIndexOf(true);
  const shown = sel ?? (lastIdx >= 0 ? lastIdx : null);
  const barH = (pct: number | null) => Math.max(2, (Math.min(100, pct ?? 0) / 100) * plot);
  const axis = theme.space[8];
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ height: plot + label }}>
        {[100, 50].map((g) => (
          <View key={g} aria-hidden style={[styles.grid, { bottom: (g / 100) * plot, borderTopColor: c.lineSubtle }]}>
            <Text variant="caption" tone="subtle" style={[styles.gridLabel, { top: -theme.space[2], backgroundColor: c.surface, paddingLeft: theme.space[1] }]}>{`${g}%`}</Text>
          </View>
        ))}
        <View accessibilityRole="list" accessibilityLabel={t("Aderência por semana")} style={[StyleSheet.absoluteFill, styles.bars, { gap: theme.space["0.5"], paddingRight: axis }]}>
          {data.map((d, i) => {
            const on = sel === i;
            const dim = sel !== null && !on;
            return (
              <Pressable key={d.week_start} accessibilityRole="button" accessibilityLabel={reading(d)} accessibilityState={{ selected: on }} onPress={() => setSel(on ? null : i)} style={styles.col}>
                {i === lastIdx && sel === null && d.pct != null && (
                  <Text variant="caption" style={[styles.value, { bottom: barH(d.pct) + theme.space[1], fontWeight: weight("bold") }]}>{`${d.pct}%`}</Text>
                )}
                <View style={{
                  width: "100%", maxWidth: theme.space[6] + theme.space[1], height: barH(d.pct), borderTopLeftRadius: theme.radius.xs, borderTopRightRadius: theme.radius.xs,
                  backgroundColor: d.current ? c.brand.subtle : c.brand.text, borderWidth: d.current ? 2 : 0, borderBottomWidth: 0, borderColor: c.brand.border, opacity: dim ? 0.4 : 1,
                }} />
              </Pressable>
            );
          })}
        </View>
      </View>
      <View aria-hidden style={[styles.ticks, { gap: theme.space["0.5"], paddingRight: axis }]}>
        {data.map((d) => <Text key={d.week_start} variant="caption" tone="subtle" style={styles.tick}>{`${Number(d.week_start.slice(8))}/${d.week_start.slice(5, 7)}`}</Text>)}
      </View>
      <Text variant="bodySm" tone="muted" accessibilityLiveRegion="polite">
        {shown != null ? reading(data[shown]!) : t("Toque numa barra para ver a semana.")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dashed" },
  gridLabel: { position: "absolute", right: 0 },
  bars: { flexDirection: "row", alignItems: "flex-end" },
  col: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  value: { position: "absolute", fontVariant: ["tabular-nums"] },
  ticks: { flexDirection: "row" },
  tick: { flex: 1, textAlign: "center", fontVariant: ["tabular-nums"] },
});

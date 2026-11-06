/**
 * The completed-training analysis (D-055; the web's components/activity/ActivityAnalysis.tsx): what Strava's detailed
 * activity carries, read the way a coach reads it. One "Parciais" table first (the watch's laps for a "tiros" session,
 * else the per-km splits; distance, time, pace, heart rate, the tiros highlighted), so it shows on the first screen; then the route, drawn
 * without a map provider; then heart rate over time, with a "tiros" session's work laps shaded behind it. The logic
 * is domain/activity.ts (a copy of the web's).
 */
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import type { Activity } from "@/api/types";
import { areaPath, linePath, nameLaps, niceRange, partials, routePath, routePoints, series, tirosSummary } from "@/domain/activity";
import { t } from "@/i18n";
import { clock, distance, pace } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Text } from "@/ui";
import { MapCredit, RouteMap } from "@/components/RouteMap";

type Data = Pick<Activity, "laps" | "splits" | "polyline" | "avg_hr" | "max_hr" | "sport"> & { analysis?: Activity["analysis"] };

/** Every section that has something to show; nothing at all for an activity without laps, splits, series or route. */
export function ActivityAnalysis({ a }: { a: Data }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[4] }}>
      <Parts a={a} />
      <RouteCard a={a} />
      <HeartRate a={a} />
    </View>
  );
}

/** Width of the box a chart draws into (measured, so paths are in real pixels). */
function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

// ---------------------------------------------------------------- heart rate

function HeartRate({ a }: { a: Data }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [w, onLayout] = useWidth();
  const s = a.analysis?.streams;
  const pts = s ? series(s, "heartrate") : [];
  if (pts.length < 2) return null;
  const h = theme.space[20] + theme.space[10];
  const range = niceRange(pts);
  const avg = a.avg_hr ?? Math.round(pts.reduce((sum, p) => sum + p.y, 0) / pts.length);
  const max = a.max_hr ?? Math.max(...pts.map((p) => p.y));
  const t0 = pts[0]!.x, t1 = pts[pts.length - 1]!.x;
  const x = (sec: number) => ((sec - t0) / Math.max(1, t1 - t0)) * w;
  const y = (bpm: number) => h - ((bpm - range.min) / Math.max(1, range.max - range.min)) * h;
  const work = nameLaps(a.laps ?? []).filter((l) => l.kind === "work" && l.start_s != null);
  const stroke = theme.space["0.5"];
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.between, { gap: theme.space[2] }]}>
        <Text variant="titleSm" accessibilityRole="header">{t("Frequência cardíaca")}</Text>
        <Text variant="caption" tone="muted">{t("média {a} bpm · máx {m} bpm", { a: avg, m: max })}</Text>
      </View>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <View style={[styles.axis, { height: h }]}>
          <Text variant="caption" tone="muted" style={styles.tabular}>{range.max}</Text>
          <Text variant="caption" tone="muted" style={styles.tabular}>{range.min}</Text>
        </View>
        <View style={styles.flex} onLayout={onLayout} accessible
          accessibilityLabel={t("Gráfico de frequência cardíaca: média {a} bpm, máxima {m} bpm", { a: avg, m: max })}>
          {w > 0 && (
            <Svg width={w} height={h}>
              {work.map((l) => (
                <Rect key={l.n ?? l.start_s} x={x(l.start_s!)} y={0} width={Math.max(stroke, x(l.start_s! + (l.elapsed_s ?? l.duration_s)) - x(l.start_s!))} height={h} fill={c.brand.subtle} />
              ))}
              <Path d={areaPath(pts, w, h, range)} fill={c.danger.subtle} />
              <Path d={linePath(pts, w, h, range)} fill="none" stroke={c.danger.text} strokeWidth={stroke} strokeLinejoin="round" />
              <Line x1={0} x2={w} y1={y(avg)} y2={y(avg)} stroke={c.fgMuted} strokeWidth={stroke / 2} strokeDasharray={[theme.space[1], theme.space[1]]} />
            </Svg>
          )}
        </View>
      </View>
      <View style={[styles.between, { paddingLeft: theme.space[8] }]}>
        <Text variant="caption" tone="muted" style={styles.tabular}>{clock(0)}</Text>
        <Text variant="caption" tone="muted" style={styles.tabular}>{clock((t1 - t0) / 2)}</Text>
        <Text variant="caption" tone="muted" style={styles.tabular}>{clock(t1 - t0)}</Text>
      </View>
      {work.length > 0 && <Text variant="caption" tone="muted">{t("Faixas: os tiros.")}</Text>}
    </Card>
  );
}

// ---------------------------------------------------------------- splits and laps

/** The one "Parciais" table (`partials`): distance, time, pace and average heart rate per row; tiros highlighted. */
function Parts({ a }: { a: Data }) {
  const { theme } = useTheme();
  const c = theme.color;
  const { rows } = partials(a);
  if (!rows.length) return null;
  const sum = tirosSummary(rows);
  const cell = [styles.flex, styles.tabular, styles.right];
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <Text variant="titleSm" accessibilityRole="header">{t("Parciais")}</Text>
      {sum && (
        <Text variant="bodySm" tone="muted">
          {[t("{n} tiros", { n: sum.count }), sum.pace ? t("pace médio {p} /km", { p: pace(sum.pace) }) : null, sum.avg_hr ? t("FC média {x} bpm", { x: sum.avg_hr }) : null].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View accessibilityRole="list" style={{ gap: theme.space[1] }}>
        <View style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[2] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text variant="caption" tone="subtle" style={styles.flex}>{t("Distância")}</Text>
          <Text variant="caption" tone="subtle" style={[styles.flex, styles.right]}>{t("Tempo")}</Text>
          <Text variant="caption" tone="subtle" style={[styles.flex, styles.right]}>{t("Pace")}</Text>
          <Text variant="caption" tone="subtle" style={[styles.flex, styles.right]}>{t("FC")}</Text>
        </View>
        {rows.map((r) => {
          const color = r.work ? c.brand.subtleFg : undefined;
          const variant = r.work ? "labelSm" : "bodySm";
          return (
            <View key={r.n} accessible
              accessibilityLabel={[r.work ? t("Tiro") : null, distance(r.distance_m), clock(r.duration_s), r.pace ? t("{p} por km", { p: pace(r.pace) }) : null, r.avg_hr ? `${r.avg_hr} bpm` : null].filter(Boolean).join(", ")}
              style={[styles.row, { gap: theme.space[2], paddingVertical: theme.space["1.5"], paddingHorizontal: theme.space[2], borderRadius: theme.radius.sm }, r.work && { backgroundColor: c.brand.subtle }]}>
              <Text variant={variant} color={color} style={[styles.flex, styles.tabular]}>{distance(r.distance_m)}</Text>
              <Text variant={variant} color={color} style={cell}>{clock(r.duration_s)}</Text>
              <Text variant={variant} color={color} style={cell}>{pace(r.pace)}</Text>
              <Text variant={variant} color={color} style={cell}>{r.avg_hr ? `${r.avg_hr} bpm` : "–"}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------- route

function RouteCard({ a }: { a: Data }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [w, onLayout] = useWidth();
  const pts = useMemo(() => routePoints(a.analysis ?? null, a.polyline), [a.analysis, a.polyline]);
  // The map (MapLibre in a web view) replaces the drawing once it's ready; offline or without WebGL the drawing stays.
  const [mapReady, setMapReady] = useState(false);
  const onReady = useCallback(() => setMapReady(true), []);
  if (pts.length < 2) return null;
  const h = Math.round((w * 9) / 16);
  const margin = theme.space[3];
  const d = w > 0 ? routePath(pts, w, h, margin) : "";
  // The path's first and last points are where the run started and ended.
  const ends = d.match(/[ML](-?[\d.]+) (-?[\d.]+)/g) ?? [];
  const point = (seg: string | undefined) => (seg ? seg.slice(1).split(" ").map(Number) as [number, number] : null);
  const start = point(ends[0]), end = point(ends[ends.length - 1]);
  const dot = theme.space["1.5"];
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <Text variant="titleSm" accessibilityRole="header">{t("Percurso")}</Text>
      <View onLayout={onLayout} accessible accessibilityLabel={t("Desenho do percurso")}
        style={{ borderRadius: theme.radius.md, backgroundColor: c.sunken, overflow: "hidden", minHeight: theme.space[20] }}>
        {w > 0 && (
          <Svg width={w} height={h} style={mapReady && styles.hidden}>
            <Path d={d} fill="none" stroke={c.brand.text} strokeWidth={theme.space["0.5"] + theme.space["0.5"] / 2} strokeLinejoin="round" strokeLinecap="round" />
            {start && <Circle cx={start[0]} cy={start[1]} r={dot} fill={c.success.solid} />}
            {end && <Circle cx={end[0]} cy={end[1]} r={dot} fill={c.danger.solid} />}
          </Svg>
        )}
        {w > 0 && <RouteMap points={pts} onReady={onReady} />}
      </View>
      <View style={[styles.row, { gap: theme.space[4] }]}>
        <Legend color={c.success.solid} label={t("Início")} />
        <Legend color={c.danger.solid} label={t("Fim")} />
      </View>
      {mapReady && <MapCredit />}
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space["1.5"] }]}>
      <View style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.full, backgroundColor: color }} />
      <Text variant="caption" tone="muted">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" },
  axis: { justifyContent: "space-between", alignItems: "flex-end" },
  flex: { flex: 1, minWidth: 0 },
  right: { textAlign: "right" },
  tabular: { fontVariant: ["tabular-nums"] },
  hidden: { opacity: 0 },
});

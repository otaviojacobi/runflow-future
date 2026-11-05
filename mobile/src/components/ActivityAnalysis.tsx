/**
 * The completed-training analysis (D-055; the web's components/activity/Analysis.tsx): what Strava's detailed
 * activity carries, read the way a coach reads it. Heart rate over time first (founder: the most important view on a
 * concluído treino), with a "tiros" session's work laps shaded behind it; then the per-km splits or the laps (named:
 * aquecimento, tiros, recuperações, desaquecimento, with the time the watch was stopped), whichever says more; then
 * the route, drawn without a map provider. The logic is domain/activity.ts (a copy of the web's).
 */
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import type { Activity } from "@/api/types";
import { areaPath, defaultView, linePath, nameLaps, niceRange, routePath, routePoints, series, type NamedLap, type Split } from "@/domain/activity";
import { t } from "@/i18n";
import { clock, distance, number, pace } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Segmented, Text } from "@/ui";

type Data = Pick<Activity, "laps" | "splits" | "polyline" | "avg_hr" | "max_hr" | "sport"> & { analysis?: Activity["analysis"] };

/** Every section that has something to show; nothing at all for an activity without laps, splits, series or route. */
export function ActivityAnalysis({ a }: { a: Data }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[4] }}>
      <HeartRate a={a} />
      <Parts a={a} />
      <RouteCard a={a} />
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

function Parts({ a }: { a: Data }) {
  const { theme } = useTheme();
  const splits = (a.splits ?? []).filter((s) => s.distance_m > 0);
  const laps = nameLaps((a.laps ?? []).filter((l) => l.distance_m > 0));
  const tiros = laps.some((l) => l.kind === "work");
  const [view, setView] = useState<"splits" | "laps">(() => defaultView({ laps: a.laps, splits: a.splits }));
  if (!splits.length && !laps.length) return null;
  const shown = !splits.length ? "laps" : !laps.length ? "splits" : view;
  const lapsLabel = tiros ? t("Tiros") : t("Voltas");
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.between, { gap: theme.space[2] }]}>
        <Text variant="titleSm" accessibilityRole="header">{shown === "splits" ? t("Parciais por km") : lapsLabel}</Text>
        {shown === "splits" && <Text variant="caption" tone="muted">{t("barra maior = mais rápido")}</Text>}
      </View>
      {splits.length > 0 && laps.length > 0 && (
        <Segmented size="sm" label={t("Ver parciais ou voltas")} value={shown} onChange={setView}
          options={[{ value: "splits", label: t("Parciais") }, { value: "laps", label: lapsLabel }]} />
      )}
      {shown === "splits" ? <SplitRows splits={splits} /> : <LapRows laps={laps} />}
    </Card>
  );
}

function SplitRows({ splits }: { splits: Split[] }) {
  const { theme } = useTheme();
  const c = theme.color;
  const paces = splits.map((s) => s.avg_pace_s_per_km ?? s.duration_s / (s.distance_m / 1000));
  const fastest = Math.min(...paces), slowest = Math.max(...paces);
  return (
    <View accessibilityRole="list" style={{ gap: theme.space["1.5"] }}>
      {splits.map((s, i) => {
        const p = paces[i]!;
        const w = slowest === fastest ? 100 : 55 + ((slowest - p) / (slowest - fastest)) * 45;
        const partial = s.distance_m < 950;
        const label = partial ? `${number(s.distance_m / 1000, 2)} km` : String(s.n);
        const elev = s.elevation_diff_m;
        return (
          <View key={s.n} accessible style={[styles.row, { gap: theme.space[2] }]}
            accessibilityLabel={t("km {n}: {p} por km", { n: label, p: pace(p) }) + (s.avg_hr ? `, ${s.avg_hr} bpm` : "")}>
            <Text variant="caption" tone="muted" style={[styles.tabular, { width: theme.space[12] }]}>{label}</Text>
            <View style={styles.flex}>
              <View style={{ width: `${w}%`, height: theme.space[5], borderTopRightRadius: theme.radius.xs, borderBottomRightRadius: theme.radius.xs, backgroundColor: c.brand.text, opacity: p === fastest ? 1 : 0.75 }} />
            </View>
            <Text variant="labelSm" style={[styles.tabular, styles.right, { width: theme.space[10] }]}>{pace(p)}</Text>
            <Text variant="caption" tone="muted" style={[styles.tabular, styles.right, { width: theme.space[12] }]}>{s.avg_hr ? `${s.avg_hr} bpm` : ""}</Text>
            <Text variant="caption" tone="muted" style={[styles.tabular, styles.right, { width: theme.space[10] }]}>
              {elev == null ? "" : elev > 0 ? `+${elev} m` : elev < 0 ? `−${Math.abs(elev)} m` : "0 m"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "Aquecimento", "Tiro 2", "Recuperação", "Desaquecimento", "Volta 3" ("Parte principal" for a single work lap). */
function lapName(l: NamedLap, i: number, works: number): string {
  switch (l.kind) {
    case "warmup": return t("Aquecimento");
    case "work": return works === 1 ? t("Parte principal") : t("Tiro {n}", { n: l.rep ?? i + 1 });
    case "recovery": return t("Recuperação");
    case "cooldown": return t("Desaquecimento");
    default: return t("Volta {n}", { n: l.n ?? i + 1 });
  }
}

function LapRows({ laps }: { laps: NamedLap[] }) {
  const { theme } = useTheme();
  const c = theme.color;
  const work = laps.filter((l) => l.kind === "work");
  const workM = work.reduce((s, l) => s + l.distance_m, 0), workS = work.reduce((s, l) => s + l.duration_s, 0);
  const hrLaps = work.filter((l) => l.avg_hr != null);
  const hrS = hrLaps.reduce((s, l) => s + l.duration_s, 0);
  const workHr = hrS > 0 ? Math.round(hrLaps.reduce((s, l) => s + l.avg_hr! * l.duration_s, 0) / hrS) : null;
  return (
    <View style={{ gap: theme.space[2] }}>
      {work.length > 1 && (
        <Text variant="bodySm" tone="muted">
          {[t("{n} tiros", { n: work.length }), workM > 0 ? t("pace médio {p} /km", { p: pace(workS / (workM / 1000)) }) : null, workHr ? t("FC média {x} bpm", { x: workHr }) : null].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View accessibilityRole="list" style={{ gap: theme.space[1] }}>
        {laps.map((l, i) => {
          const name = lapName(l, i, work.length);
          const muted = l.kind === "recovery";
          return (
            <View key={l.n ?? i} accessible
              accessibilityLabel={[name, distance(l.distance_m), clock(l.duration_s), l.pace ? t("{p} por km", { p: pace(l.pace) }) : null, l.avg_hr ? `${l.avg_hr} bpm` : null, l.stopped_s >= 5 ? t("parado {x}", { x: clock(l.stopped_s) }) : null].filter(Boolean).join(", ")}
              style={[styles.row, { gap: theme.space[2], paddingVertical: theme.space["1.5"], paddingHorizontal: theme.space[2], borderRadius: theme.radius.sm }, l.kind === "work" && { backgroundColor: c.brand.subtle }]}>
              <View style={styles.flex}>
                <Text variant="labelSm" numberOfLines={1} color={l.kind === "work" ? c.brand.subtleFg : muted ? c.fgMuted : undefined}>{name}</Text>
                <View style={[styles.row, { gap: theme.space["1.5"] }]}>
                  <Text variant="caption" tone="muted" style={styles.tabular}>{distance(l.distance_m)} · {clock(l.duration_s)}</Text>
                  {l.stopped_s >= 5 && (
                    <View style={{ paddingHorizontal: theme.space["1.5"], borderRadius: theme.radius.full, backgroundColor: c.warning.subtle }}>
                      <Text variant="caption" color={c.warning.subtleFg} style={styles.tabular}>{t("parado {x}", { x: clock(l.stopped_s) })}</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text variant="labelMd" color={l.kind === "work" ? c.brand.subtleFg : muted ? c.fgMuted : undefined} style={[styles.tabular, styles.right, { width: theme.space[16] }]}>
                {l.pace ? `${pace(l.pace)}` : "–"}<Text variant="caption" tone="muted"> /km</Text>
              </Text>
              <View style={[styles.end, { width: theme.space[16] }]}>
                <Text variant="labelSm" color={muted ? c.fgMuted : undefined} style={styles.tabular}>{l.avg_hr ? `${l.avg_hr} bpm` : ""}</Text>
                {l.max_hr ? <Text variant="caption" tone="muted" style={styles.tabular}>{t("máx {x}", { x: l.max_hr })}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- route

function RouteCard({ a }: { a: Data }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [w, onLayout] = useWidth();
  const pts = routePoints(a.analysis ?? null, a.polyline);
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
          <Svg width={w} height={h}>
            <Path d={d} fill="none" stroke={c.brand.text} strokeWidth={theme.space["0.5"] + theme.space["0.5"] / 2} strokeLinejoin="round" strokeLinecap="round" />
            {start && <Circle cx={start[0]} cy={start[1]} r={dot} fill={c.success.solid} />}
            {end && <Circle cx={end[0]} cy={end[1]} r={dot} fill={c.danger.solid} />}
          </Svg>
        )}
      </View>
      <View style={[styles.row, { gap: theme.space[4] }]}>
        <Legend color={c.success.solid} label={t("Início")} />
        <Legend color={c.danger.solid} label={t("Fim")} />
      </View>
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
  end: { alignItems: "flex-end" },
  right: { textAlign: "right" },
  tabular: { fontVariant: ["tabular-nums"] },
});

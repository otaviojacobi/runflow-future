/** The completed-training analysis (D-055): pure logic shared by the web and the phone app (the app keeps an identical
 * copy, checked by scripts/check-copies.mjs). What Strava sends is laps (the watch's lap presses or auto-laps: a "tiro"
 * and its recovery are separate laps), per-km splits, the route as an encoded polyline and time series. This decides
 * which view opens first, names the laps of a "tiros" session, and turns series and routes into SVG
 * paths. No colors or text styles here: the screens bring those (tokens). */

export interface Lap {
  n?: number; name?: string | null;
  distance_m: number; duration_s: number; elapsed_s?: number | null; start_s?: number | null;
  avg_pace_s_per_km?: number | null; avg_hr: number | null; max_hr?: number | null;
}
export interface Split {
  n: number; distance_m: number; duration_s: number; elapsed_s?: number | null;
  avg_pace_s_per_km: number | null; avg_hr: number | null; elevation_diff_m?: number | null;
}
export interface Streams {
  time: number[]; distance: number[];
  heartrate: (number | null)[] | null; altitude: (number | null)[] | null; velocity: (number | null)[] | null;
  latlng: ([number, number] | null)[] | null; original_size?: number;
}

/** Seconds per km of a lap or split (stored, else from distance and moving time); null without distance. */
export function paceOf(x: { distance_m: number; duration_s: number; avg_pace_s_per_km?: number | null }): number | null {
  if (x.avg_pace_s_per_km) return x.avg_pace_s_per_km;
  return x.distance_m > 0 ? Math.round(x.duration_s / (x.distance_m / 1000)) : null;
}

/** Laps that are just the watch's 1 km auto-laps (every one but the last within 1 km ± 30 m): the splits say it all. */
export function lapsAreAutoKm(laps: Lap[]): boolean {
  if (laps.length < 2) return false;
  return laps.slice(0, -1).every((l) => Math.abs(l.distance_m - 1000) <= 30);
}

export type LapKind = "warmup" | "work" | "recovery" | "cooldown" | "steady";
export interface NamedLap extends Lap { kind: LapKind; rep: number | null; pace: number | null }

/**
 * A "tiros" session's laps, named: when the laps' paces fall into two clear groups (the fastest group at least 12%
 * faster than the rest, two laps or more on each side), the fast ones are the work ("Tiro 1", "Tiro 2"…), the slow ones between them recoveries, and
 * slow laps before the first and after the last tiro the warm-up and cool-down. Otherwise every lap is "steady".
 */
export function nameLaps(laps: Lap[]): NamedLap[] {
  const paces = laps.map(paceOf);
  const known = paces.filter((p): p is number => p != null).sort((a, b) => a - b);
  let threshold: number | null = null;
  if (laps.length >= 3 && known.length >= 3) {
    let best = 0;
    for (let i = 0; i < known.length - 1; i++) {
      const gap = known[i + 1]! / known[i]! - 1;
      if (gap > best) { best = gap; threshold = known[i]!; }
    }
    // Two real groups: a clear gap, and at least two laps on each side (one slow km up a hill isn't a recovery).
    const fast = threshold == null ? 0 : known.filter((p) => p <= threshold!).length;
    if (best < 0.12 || fast < 2 || known.length - fast < 2) threshold = null;
  }
  const work = laps.map((_, i) => threshold != null && paces[i] != null && paces[i]! <= threshold);
  const first = work.indexOf(true), last = work.lastIndexOf(true);
  let rep = 0;
  return laps.map((l, i) => {
    const kind: LapKind = threshold == null ? "steady" : work[i] ? "work" : i < first ? "warmup" : i > last ? "cooldown" : "recovery";
    return { ...l, kind, rep: kind === "work" ? ++rep : null, pace: paces[i] ?? null };
  });
}

/** Which table a completed activity opens on: its laps when they say something the splits don't (a "tiros" session,
 * manual laps), else the per-km splits; laps only when there are no splits. */
export function defaultView(a: { laps: Lap[] | null; splits: Split[] | null }): "splits" | "laps" {
  const laps = a.laps ?? [], splits = a.splits ?? [];
  if (laps.length > 1 && !lapsAreAutoKm(laps)) return "laps";
  return splits.length ? "splits" : "laps";
}

/** A row of the "Parciais" table: distance, moving time, pace and average heart rate; `work` marks a tiro. */
export interface PartialRow { n: number; distance_m: number; duration_s: number; pace: number | null; avg_hr: number | null; work: boolean }

/**
 * The one "Parciais" table (founder, 2026-11-06): the watch's laps when they say more than the per-km splits (a
 * "tiros" session, laps pressed by hand: `defaultView`), else Strava's per-km splits. Same columns either way; the
 * tiros are flagged so the screens can highlight them. Empty rows are dropped.
 */
export function partials(a: { laps: Lap[] | null; splits: Split[] | null }): { from: "laps" | "splits"; rows: PartialRow[] } {
  const from = defaultView(a);
  const rows: PartialRow[] = from === "laps"
    ? nameLaps((a.laps ?? []).filter((l) => l.distance_m > 0)).map((l, i) => ({ n: l.n ?? i + 1, distance_m: l.distance_m, duration_s: l.duration_s, pace: l.pace, avg_hr: l.avg_hr, work: l.kind === "work" }))
    : (a.splits ?? []).filter((s) => s.distance_m > 0).map((s) => ({ n: s.n, distance_m: s.distance_m, duration_s: s.duration_s, pace: paceOf(s), avg_hr: s.avg_hr, work: false }));
  return { from, rows };
}

/** A "tiros" session in one line: how many, their pace (total time over total distance) and their heart rate
 * (weighted by time). Null with fewer than two tiros. */
export function tirosSummary(rows: PartialRow[]): { count: number; pace: number | null; avg_hr: number | null } | null {
  const work = rows.filter((r) => r.work);
  if (work.length < 2) return null;
  const m = work.reduce((s, r) => s + r.distance_m, 0), sec = work.reduce((s, r) => s + r.duration_s, 0);
  const hr = work.filter((r) => r.avg_hr != null), hrSec = hr.reduce((s, r) => s + r.duration_s, 0);
  return {
    count: work.length,
    pace: m > 0 ? Math.round(sec / (m / 1000)) : null,
    avg_hr: hrSec > 0 ? Math.round(hr.reduce((s, r) => s + r.avg_hr! * r.duration_s, 0) / hrSec) : null,
  };
}

/** Points of one series against time, nulls dropped: [{x: seconds, y}]. */
export function series(s: Streams, key: "heartrate" | "altitude" | "velocity"): { x: number; y: number }[] {
  const ys = s[key];
  if (!ys) return [];
  const out: { x: number; y: number }[] = [];
  ys.forEach((y, i) => { if (y != null && s.time[i] != null) out.push({ x: s.time[i]!, y }); });
  return out;
}

/** An SVG path through points scaled into a w×h box (y grows downwards), with the y range padded to read well. */
export function linePath(pts: { x: number; y: number }[], w: number, h: number, range?: { min: number; max: number }): string {
  if (pts.length < 2) return "";
  const x0 = pts[0]!.x, x1 = pts[pts.length - 1]!.x;
  const ymin = range?.min ?? Math.min(...pts.map((p) => p.y)), ymax = range?.max ?? Math.max(...pts.map((p) => p.y));
  const sx = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * w;
  const sy = (y: number) => h - ((y - ymin) / Math.max(1, ymax - ymin)) * h;
  return pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
}

/** The same path closed down to the baseline (an area under the line). */
export function areaPath(pts: { x: number; y: number }[], w: number, h: number, range?: { min: number; max: number }): string {
  const line = linePath(pts, w, h, range);
  return line ? `${line} L${w} ${h} L0 ${h} Z` : "";
}

/** A rounded range around the values (heart rate: to 10 bpm), so the chart neither clips nor flattens. */
export function niceRange(pts: { y: number }[], step = 10): { min: number; max: number } {
  if (!pts.length) return { min: 0, max: step };
  const lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y));
  return { min: Math.floor(lo / step) * step, max: Math.max(Math.ceil(hi / step) * step, Math.floor(lo / step) * step + step) };
}

/** Decode Google's encoded polyline (Strava's routes) → [lat, lng] points. */
export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < s.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next(); lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** A route drawn without a map: points projected (equirectangular around their middle latitude), fitted and centred
 * in a w×h box with a margin, keeping the shape's proportions. Empty for fewer than two points. */
export function routePath(points: [number, number][], w: number, h: number, margin = 8): string {
  if (points.length < 2) return "";
  const k = Math.cos(((points.reduce((s, p) => s + p[0], 0) / points.length) * Math.PI) / 180);
  const xs = points.map((p) => p[1] * k), ys = points.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - 2 * margin) / Math.max(1e-9, maxX - minX), (h - 2 * margin) / Math.max(1e-9, maxY - minY));
  const ox = (w - (maxX - minX) * scale) / 2, oy = (h - (maxY - minY) * scale) / 2;
  return points.map((_, i) => `${i ? "L" : "M"}${(ox + (xs[i]! - minX) * scale).toFixed(1)} ${(oy + (ys[i]! - minY) * scale).toFixed(1)}`).join(" ");
}

/** The route's points: the full route when there is one, else the streams' positions, else the summary polyline. */
export function routePoints(analysis: { route_polyline: string | null; streams: Streams | null } | null, summary?: string | null): [number, number][] {
  if (analysis?.route_polyline) return decodePolyline(analysis.route_polyline);
  const ll = analysis?.streams?.latlng?.filter((p): p is [number, number] => p != null);
  if (ll && ll.length > 1) return ll;
  return summary ? decodePolyline(summary) : [];
}

/**
 * The completed-training analysis in the mock (D-055): what Strava's detailed activity carries, made up from an
 * activity's own totals so the screens have something real-looking to draw. Deterministic per activity id (its own
 * random stream, so the rest of the seed doesn't shift): device laps (auto 1 km laps, or a "tiros" session's work and
 * recovery laps when the name says so), Strava-style per-km splits, a route around Parque da Redenção (Porto Alegre)
 * as an encoded polyline, and the time series sampled to ≤ 600 points (served by the detail routes, not stored).
 */

/** A small seeded random stream from a string (mulberry32 over a 32-bit hash). */
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h |= 0; h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Google's encoded polyline (what Strava sends), 5 decimals. */
export function encodePolyline(points) {
  let out = "", lat0 = 0, lng0 = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = "";
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    out += enc(a - lat0) + enc(b - lng0);
    lat0 = a; lng0 = b;
  }
  return out;
}

const isRun = (a) => a.sport === "run" && a.distance_m > 0 && a.moving_time_s > 0;

/** The session's segments: warm-up, reps of work + recovery, cool-down (from "Intervalado 6×1 km", "8×400 m"), else one steady block. */
function segments(a, r) {
  const total = a.distance_m, pace = a.moving_time_s / (total / 1000);
  const m = /(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(km|m)\b/i.exec(a.name || "");
  if (!m) return [{ kind: "steady", m: total, pace, hr: a.avg_hr ?? 148 }];
  const reps = Number(m[1]), rep = Number(m[2].replace(",", ".")) * (m[3].toLowerCase() === "km" ? 1000 : 1);
  const rec = rep >= 800 ? 300 : 200;
  const warm = Math.max(1500, Math.round((total - reps * (rep + rec)) * 0.55 / 100) * 100);
  const cool = Math.max(500, total - warm - reps * rep - (reps - 1) * rec);
  const fast = pace * 0.82, slow = pace * 1.35, hr = a.avg_hr ?? 155;
  const out = [{ kind: "warmup", m: warm, pace: pace * 1.08, hr: hr - 14 }];
  for (let i = 0; i < reps; i++) {
    out.push({ kind: "work", m: rep, pace: fast + (r() - 0.5) * 8, hr: hr + 12 + i });
    if (i < reps - 1) out.push({ kind: "recovery", m: rec, pace: slow + (r() - 0.5) * 20, hr: hr - 6, pause: r() < 0.5 ? 15 + Math.round(r() * 25) : 0 });
  }
  out.push({ kind: "cooldown", m: cool, pace: pace * 1.15, hr: hr - 12 });
  return out;
}

/** A point every ~10 s along the session: { t (clock), mt (moving time), d, hr, v }. A segment's pause (the watch
 * stopped at the end of a recovery) moves the clock on, not the moving time. */
function timeline(a, segs, r) {
  const pts = [{ t: 0, mt: 0, d: 0, hr: (a.avg_hr ?? 148) - 30, v: 0 }];
  let t = 0, mt = 0, d = 0, hr = pts[0].hr;
  for (const s of segs) {
    const v = 1000 / s.pace;
    const steps = Math.max(1, Math.round(s.m / v / 10));
    for (let i = 0; i < steps; i++) {
      const dt = s.m / v / steps;
      t += dt; mt += dt; d += s.m / steps;
      hr += (s.hr - hr) * (s.kind === "steady" ? 0.08 : 0.25) + (r() - 0.5) * 2;
      pts.push({ t, mt, d, hr, v: v * (1 + (r() - 0.5) * 0.06) });
    }
    if (s.pause) t += s.pause;
  }
  return pts;
}

/** A loop around Parque da Redenção, as long as the run (lat, lng). */
function route(a, pts, r) {
  const c = [-30.0368 + (r() - 0.5) * 0.004, -51.2145 + (r() - 0.5) * 0.004];
  const loop = 1650; // metres around the park
  return pts.map((p) => {
    const ang = (p.d / loop) * 2 * Math.PI;
    return [c[0] + 0.0042 * Math.sin(ang) + 0.0004 * Math.sin(ang * 5), c[1] + 0.0029 * Math.cos(ang)];
  });
}

/** Laps, splits, the route and the matching max heart rate a run gets stored with (laps unchanged otherwise). */
export function synthActivity(a) {
  if (!isRun(a)) return { laps: a.laps ?? null, splits: null, max_hr: a.max_hr ?? null, route_polyline: null };
  const r = rng(a.id);
  const segs = segments(a, r);
  const pts = timeline(a, segs, r);
  // The last point at or before a distance (a segment's end, before any pause that follows it).
  const at = (dist) => pts.findLast((p) => p.d <= dist + 0.5) ?? pts[0];
  const hrBetween = (d0, d1) => {
    const xs = pts.filter((p) => p.d > d0 && p.d <= d1 + 0.5).map((p) => p.hr);
    return xs.length ? { avg: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), max: Math.round(Math.max(...xs)) } : { avg: null, max: null };
  };
  // Distance, moving and clock time between two distances.
  const block = (d0, d1) => {
    const p0 = at(d0), p1 = at(d1), dist = Math.round(d1 - d0), moving = Math.round(p1.mt - p0.mt);
    const hr = hrBetween(d0, d1);
    return {
      distance_m: dist, duration_s: moving, elapsed_s: Math.round(p1.t - p0.t), start: p0.t,
      avg_pace_s_per_km: dist > 0 ? Math.round(moving / (dist / 1000)) : null, avg_hr: a.avg_hr ? hr.avg : null, max_hr: a.avg_hr ? hr.max : null,
    };
  };
  // Splits: every full km, then the rest (a pause inside a km shows as clock time above moving time).
  const splits = [];
  for (let n = 1, d0 = 0; d0 < a.distance_m - 50; n++, d0 += 1000) {
    const d1 = Math.min(d0 + 1000, a.distance_m), b = block(d0, d1);
    splits.push({ n, distance_m: b.distance_m, duration_s: b.duration_s, elapsed_s: b.elapsed_s, avg_pace_s_per_km: b.avg_pace_s_per_km, avg_hr: b.avg_hr, elevation_diff_m: Math.round((r() - 0.5) * 8) });
  }
  // Laps: the session's segments when it was a "tiros" session, else 1 km auto-laps like a watch.
  const laps = [];
  if (segs.length > 1) {
    // Pauses here only come at a segment's end, so each lap's clock is its moving time plus its own pause.
    let d = 0, clock = 0;
    segs.forEach((s, i) => {
      const b = block(d, d + s.m), pause = s.pause ?? 0;
      laps.push({ n: i + 1, name: `Volta ${i + 1}`, distance_m: b.distance_m, duration_s: b.duration_s, elapsed_s: b.duration_s + pause, start_s: Math.round(clock), avg_pace_s_per_km: b.avg_pace_s_per_km, avg_hr: b.avg_hr, max_hr: b.max_hr });
      d += s.m; clock += b.duration_s + pause;
    });
  } else {
    for (const sp of splits) {
      const b = block((sp.n - 1) * 1000, (sp.n - 1) * 1000 + sp.distance_m);
      laps.push({ n: sp.n, name: `Volta ${sp.n}`, distance_m: sp.distance_m, duration_s: sp.duration_s, elapsed_s: sp.elapsed_s, start_s: Math.round(b.start), avg_pace_s_per_km: sp.avg_pace_s_per_km, avg_hr: sp.avg_hr, max_hr: b.max_hr });
    }
  }
  const path = route(a, pts.filter((_, i) => i % 3 === 0), r);
  // The totals agree with the made-up series (Strava's max heart rate is the series' max).
  const max_hr = a.avg_hr ? Math.round(Math.max(...pts.slice(1).map((p) => p.hr))) : a.max_hr;
  return { laps, splits, max_hr, route_polyline: a.source === "strava" ? encodePolyline(path) : null };
}

/** The detail views' `analysis` {route_polyline, streams} (D-055), or null for activities without one. */
export function analysisOf(a) {
  if (!isRun(a) || !a.splits) return null;
  const r = rng(a.id);
  const pts = timeline(a, segments(a, r), r);
  const keep = pts.length <= 600 ? pts : Array.from({ length: 600 }, (_, i) => pts[Math.floor((i * (pts.length - 1)) / 599)]);
  const latlng = route(a, keep, rng(a.id + ":route")).map(([lat, lng]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
  return {
    route_polyline: a.route_polyline ?? null,
    streams: {
      time: keep.map((p) => Math.round(p.t)),
      distance: keep.map((p) => Math.round(p.d)),
      heartrate: a.avg_hr ? keep.map((p) => Math.round(p.hr)) : null,
      altitude: keep.map((p) => Math.round((32 + 6 * Math.sin(p.d / 400)) * 10) / 10),
      velocity: keep.map((p) => Math.round(p.v * 100) / 100),
      latlng: a.source === "strava" ? latlng : null,
      original_size: pts.length * 10,
    },
  };
}

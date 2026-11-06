import { describe, expect, it } from "vitest";
import { areaPath, decodePolyline, defaultView, lapsAreAutoKm, linePath, nameLaps, niceRange, routePath, routePoints, series, partials, routeGeo, tirosSummary, type Lap } from "./activity";

const km = (n: number, s: number): Lap => ({ n, distance_m: 1000, duration_s: s, avg_hr: 150 });

describe("completed-training analysis (D-055)", () => {
  it("names a tiros session: warm-up, tiros, recoveries, cool-down", () => {
    const laps: Lap[] = [
      { distance_m: 1800, duration_s: 580, elapsed_s: 580, start_s: 0, avg_hr: 145 },
      { distance_m: 1000, duration_s: 244, elapsed_s: 244, start_s: 580, avg_hr: 168 },
      { distance_m: 300, duration_s: 121, elapsed_s: 160, start_s: 824, avg_hr: 159 },
      { distance_m: 1000, duration_s: 246, elapsed_s: 246, start_s: 984, avg_hr: 170 },
      { distance_m: 300, duration_s: 122, elapsed_s: 122, start_s: 1230, avg_hr: 158 },
      { distance_m: 1000, duration_s: 242, elapsed_s: 242, start_s: 1352, avg_hr: 171 },
      { distance_m: 1814, duration_s: 623, elapsed_s: 623, start_s: 1594, avg_hr: 150 },
    ];
    const named = nameLaps(laps);
    expect(named.map((l) => l.kind)).toEqual(["warmup", "work", "recovery", "work", "recovery", "work", "cooldown"]);
    expect(named.map((l) => l.rep)).toEqual([null, 1, null, 2, null, 3, null]);
    expect(named[1]!.pace).toBe(244);
    expect(defaultView({ laps, splits: [] })).toBe("laps");
  });

  it("keeps a steady run steady, even with one slow km up a hill", () => {
    const laps = [km(1, 300), km(2, 304), km(3, 362), km(4, 298), km(5, 301), { distance_m: 420, duration_s: 126, avg_hr: 151 }];
    expect(nameLaps(laps).every((l) => l.kind === "steady")).toBe(true);
    expect(lapsAreAutoKm(laps)).toBe(true);
    // Auto 1 km laps say what the splits say: the splits open first; without splits, the laps.
    const splits = laps.map((l, i) => ({ n: i + 1, distance_m: l.distance_m, duration_s: l.duration_s, avg_pace_s_per_km: null, avg_hr: 150 }));
    expect(defaultView({ laps, splits })).toBe("splits");
    expect(defaultView({ laps: [laps[0]!], splits })).toBe("splits");
    expect(defaultView({ laps, splits: null })).toBe("laps");
    expect(defaultView({ laps: null, splits: null })).toBe("laps");
  });

  it("decodes Strava's routes and draws them in a box without a map", () => {
    // Google's documented example.
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
    const square: [number, number][] = [[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0]];
    const d = routePath(square, 100, 100, 10);
    expect(d.startsWith("M10.0 90.0")).toBe(true);
    expect(d.split("L")).toHaveLength(4);
    expect(routePath([[0, 0]], 100, 100)).toBe("");
    expect(routePoints({ route_polyline: null, streams: { time: [0, 1], distance: [0, 3], heartrate: null, altitude: null, velocity: null, latlng: [[1, 2], null, [3, 4]] } })).toEqual([[1, 2], [3, 4]]);
    expect(routePoints(null, "_p~iF~ps|U")).toEqual([[38.5, -120.2]]);
  });

  it("turns a heart-rate series into chart paths, skipping gaps", () => {
    const s = { time: [0, 60, 120, 180], distance: [0, 200, 400, 600], heartrate: [120, null, 160, 140], altitude: null, velocity: null, latlng: null };
    const pts = series(s, "heartrate");
    expect(pts).toEqual([{ x: 0, y: 120 }, { x: 120, y: 160 }, { x: 180, y: 140 }]);
    expect(series(s, "altitude")).toEqual([]);
    const range = niceRange(pts);
    expect(range).toEqual({ min: 120, max: 160 });
    expect(linePath(pts, 180, 40, range)).toBe("M0.0 40.0 L120.0 0.0 L180.0 20.0");
    expect(areaPath(pts, 180, 40, range)).toBe("M0.0 40.0 L120.0 0.0 L180.0 20.0 L180 40 L0 40 Z");
    expect(linePath(pts.slice(0, 1), 10, 10)).toBe("");
  });

  it("shows one Parciais table: the laps of a tiros session, else the per-km splits", () => {
    const splits = [1, 2, 3].map((n) => ({ n, distance_m: 1000, duration_s: 300, avg_pace_s_per_km: 300, avg_hr: 150 }));
    const tiros: Lap[] = [
      { distance_m: 1500, duration_s: 540, avg_hr: 140 },
      { distance_m: 1000, duration_s: 240, avg_hr: 168 },
      { distance_m: 300, duration_s: 120, avg_hr: 155 },
      { distance_m: 1000, duration_s: 250, avg_hr: 172 },
      { distance_m: 1200, duration_s: 430, avg_hr: 145 },
    ];
    const t = partials({ laps: tiros, splits });
    expect(t.from).toBe("laps");
    expect(t.rows.map((r) => [r.distance_m, r.duration_s, r.pace, r.avg_hr, r.work])).toEqual([
      [1500, 540, 360, 140, false], [1000, 240, 240, 168, true], [300, 120, 400, 155, false], [1000, 250, 250, 172, true], [1200, 430, 358, 145, false],
    ]);
    expect(tirosSummary(t.rows)).toEqual({ count: 2, pace: 245, avg_hr: 170 });
    // A steady run (1 km auto-laps, or no laps at all): the splits, nothing flagged.
    const steady = partials({ laps: splits.map((s) => ({ ...s })), splits });
    expect(steady.from).toBe("splits");
    expect(steady.rows.every((r) => !r.work && r.distance_m === 1000)).toBe(true);
    // Every other row shaded, the same color as the tiros, so a long table is easy to follow across.
    expect(steady.rows.map((r) => r.shade)).toEqual([true, false, true]);
    expect(t.rows.map((r) => r.shade)).toEqual([false, true, false, true, false]);
    expect(tirosSummary(steady.rows)).toBeNull();
    expect(partials({ laps: null, splits }).from).toBe("splits");
  });

  it("hands a map the route in GeoJSON order with its bounds", () => {
    const g = routeGeo([[-30.03, -51.21], [-30.04, -51.2], [-30.035, -51.22]])!;
    expect(g.line[0]).toEqual([-51.21, -30.03]);
    expect(g.bounds).toEqual([[-51.22, -30.04], [-51.2, -30.03]]);
    expect(routeGeo([[-30, -51]])).toBeNull();
  });
});

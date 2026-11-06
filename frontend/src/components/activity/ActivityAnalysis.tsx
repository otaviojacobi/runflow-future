/** The completed-training analysis (D-055), shared by the activity detail (M4), the student's completed workout (M2)
 * and the trainer's workout dialog (W4): one "Parciais" table first (the watch's laps for a "tiros" session, else the
 * per-km splits; distance, time, pace, heart rate, the tiros highlighted), so a coach reads the session at a glance; then the route, drawn
 * without a map provider; then heart rate over time, with the tiros shaded behind it. The phone app has the same
 * blocks in the same order (mobile/src/components/ActivityAnalysis.tsx). */
import type { Activity } from "@/api/types";
import { areaPath, linePath, nameLaps, niceRange, partials, routePath, routePoints, series, tirosSummary, type NamedLap, type PartialRow } from "@/domain/activity";
import { t } from "@/i18n";
import { clock, distance, pace } from "@/lib/format";
import { Card, cn } from "@/ui";

const W = 600, H = 150;

function HeartRate({ a, laps }: { a: Activity; laps: NamedLap[] }) {
  const s = a.analysis?.streams;
  const pts = s ? series(s, "heartrate") : [];
  if (pts.length < 2) return null;
  const range = niceRange(pts);
  const end = pts[pts.length - 1]!.x, start = pts[0]!.x;
  const x = (sec: number) => ((sec - start) / Math.max(1, end - start)) * W;
  const avg = a.avg_hr ?? Math.round(pts.reduce((sum, p) => sum + p.y, 0) / pts.length);
  const max = a.max_hr ?? Math.max(...pts.map((p) => p.y));
  const yAvg = H - ((avg - range.min) / Math.max(1, range.max - range.min)) * H;
  const bands = laps.filter((l) => l.kind === "work" && l.start_s != null);
  return (
    <Card className="grid min-w-0 gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="rf-text-title-md">{t("Frequência cardíaca")}</h2>
        <span className="text-sm tabular-nums text-fg-muted">{t("média {a} bpm · máx {m} bpm", { a: avg, m: max })}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div className="flex flex-col justify-between py-0.5 text-right text-xs tabular-nums text-fg-subtle"><span>{range.max}</span><span>{range.min}</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full overflow-visible" role="img" aria-label={t("Frequência cardíaca ao longo do treino: média {a} bpm, máxima {m} bpm", { a: avg, m: max })}>
          {bands.map((l) => <rect key={l.n ?? l.start_s} x={x(l.start_s!)} y={0} width={Math.max(1, x(l.start_s! + (l.elapsed_s ?? l.duration_s)) - x(l.start_s!))} height={H} className="fill-brand-soft" />)}
          <path d={areaPath(pts, W, H, range)} className="fill-danger-soft" />
          <path d={linePath(pts, W, H, range)} className="fill-none stroke-danger" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <line x1={0} x2={W} y1={yAvg} y2={yAvg} className="stroke-fg-subtle" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        </svg>
        <span />
        <div className="flex justify-between text-xs tabular-nums text-fg-subtle"><span>0:00</span><span>{clock((end - start) / 2)}</span><span>{clock(end - start)}</span></div>
      </div>
      {bands.length > 0 && <p className="flex items-center gap-2 text-xs text-fg-muted"><span className="inline-block size-3 rounded-[2px] bg-brand-soft" />{t("Faixas: os tiros.")}</p>}
    </Card>
  );
}

/** The one "Parciais" table (`partials`): distance, time, pace and average heart rate per row; tiros highlighted. */
function Partials({ rows }: { rows: PartialRow[] }) {
  const sum = tirosSummary(rows);
  const cols = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2";
  return (
    <div className="grid gap-3">
      {sum && (
        <p className="text-sm text-fg-muted">
          {[t("{n} tiros", { n: sum.count }), sum.pace ? t("pace médio {p} /km", { p: pace(sum.pace) }) : null, sum.avg_hr ? t("FC média {h} bpm", { h: sum.avg_hr }) : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <ol className="grid gap-1" aria-label={t("Parciais")}>
        <li className={cn(cols, "px-2 text-xs text-fg-subtle")}><span>{t("Distância")}</span><span className="text-right">{t("Tempo")}</span><span className="text-right">{t("Pace")}</span><span className="text-right">{t("FC")}</span></li>
        {rows.map((r) => (
          <li key={r.n} className={cn(cols, "items-center rounded-md px-2 py-1.5 text-sm tabular-nums", r.work && "bg-brand-soft font-semibold text-on-brand-soft")}>
            <span>{distance(r.distance_m)}</span>
            <span className="text-right">{clock(r.duration_s)}</span>
            <span className="text-right">{pace(r.pace)}</span>
            <span className="text-right">{r.avg_hr ? `${r.avg_hr} bpm` : "–"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Route({ a }: { a: Activity }) {
  const pts = routePoints(a.analysis ?? null, a.polyline);
  if (pts.length < 2) return null;
  const RW = 320, RH = 180;
  const d = routePath(pts, RW, RH, 12);
  const [sx, sy] = d.slice(1).split(" L")[0]!.split(" ").map(Number) as [number, number];
  const [ex, ey] = d.split(" L").at(-1)!.split(" ").map(Number) as [number, number];
  return (
    <Card className="grid min-w-0 gap-3 p-4 sm:p-5">
      <h2 className="rf-text-title-md">{t("Percurso")}</h2>
      <svg viewBox={`0 0 ${RW} ${RH}`} className="aspect-video w-full rounded-md bg-sunken" role="img" aria-label={t("Desenho do percurso")}>
        <path d={d} className="fill-none stroke-brand-text" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx} cy={sy} r={5} className="fill-success stroke-surface" strokeWidth={2} />
        <circle cx={ex} cy={ey} r={5} className="fill-danger stroke-surface" strokeWidth={2} />
      </svg>
      <p className="flex gap-4 text-xs text-fg-muted"><span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-success" />{t("início")}</span><span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-danger" />{t("fim")}</span></p>
    </Card>
  );
}

/** Everything a completed activity can show; renders nothing for an activity without detail (manual, older imports). */
export function ActivityAnalysis({ a }: { a: Activity }) {
  const laps = nameLaps(a.laps ?? []);
  const { rows } = partials(a);
  return (
    <>
      {rows.length > 0 && (
        <Card className="grid min-w-0 gap-4 p-4 sm:p-5">
          <h2 className="rf-text-title-md">{t("Parciais")}</h2>
          <Partials rows={rows} />
        </Card>
      )}
      <Route a={a} />
      <HeartRate a={a} laps={laps} />
    </>
  );
}

/** The completed-training analysis (D-055), shared by the activity detail (M4), the student's completed workout (M2)
 * and the trainer's workout dialog (W4): heart rate over time first (the founder's most important view on a concluído
 * treino), with the tiros shaded behind it; then the per-km splits or the laps (a "tiros" session's laps named:
 * aquecimento, tiros, recuperações, desaquecimento, and when the watch was stopped); then the route, drawn without a
 * map provider. The phone app has the same blocks (mobile/src/components/ActivityAnalysis.tsx). */
import { useState } from "react";
import type { Activity } from "@/api/types";
import { areaPath, defaultView, linePath, nameLaps, niceRange, paceOf, routePath, routePoints, series, type NamedLap, type Split } from "@/domain/activity";
import { t } from "@/i18n";
import { clock, distance, number, pace } from "@/lib/format";
import { Card, Segmented, cn } from "@/ui";

const W = 600, H = 150;

/** "Tiro 3", "Recuperação", "Volta 2"… (`short`: what fits a phone's column). */
function lapLabel(l: NamedLap, works: number, short = false): string {
  if (l.kind === "work") return works === 1 ? t(short ? "Principal" : "Parte principal") : t("Tiro {n}", { n: l.rep ?? 0 });
  if (l.kind === "warmup") return t(short ? "Aquec." : "Aquecimento");
  if (l.kind === "cooldown") return t(short ? "Desaq." : "Desaquecimento");
  if (l.kind === "recovery") return t(short ? "Recup." : "Recuperação");
  return t("Volta {n}", { n: l.n ?? 0 });
}

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

/** Rows with a pace bar: longer = faster. */
function bar(p: number | null, fastest: number, slowest: number) {
  if (p == null) return 0;
  return slowest === fastest ? 100 : 40 + ((slowest - p) / (slowest - fastest)) * 60;
}

function Splits({ splits }: { splits: Split[] }) {
  const paces = splits.map((s) => paceOf(s)).filter((p): p is number => p != null);
  const fastest = Math.min(...paces), slowest = Math.max(...paces);
  return (
    <ol className="grid gap-1.5" aria-label={t("Parciais por km")}>
      <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_3rem_3.75rem_3rem] sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_4rem_3.5rem] gap-2 text-xs text-fg-subtle"><span>{t("Km")}</span><span /><span className="text-right">{t("Pace")}</span><span className="text-right">{t("FC")}</span><span className="text-right">{t("Elev.")}</span></li>
      {splits.map((s) => {
        const p = paceOf(s);
        const full = s.distance_m >= 950;
        return (
          <li key={s.n} className="grid grid-cols-[2.75rem_minmax(0,1fr)_3rem_3.75rem_3rem] sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_4rem_3.5rem] items-center gap-2 text-sm tabular-nums">
            <span className="text-fg-muted">{full ? s.n : `${number(s.distance_m / 1000, 2)} km`}</span>
            <span className="h-4 rounded-r-[4px] bg-brand-text" style={{ width: `${bar(p, fastest, slowest)}%`, opacity: p === fastest ? 1 : 0.7 }} />
            <span className="text-right font-semibold">{pace(p)}</span>
            <span className="text-right text-fg-muted">{s.avg_hr ? `${s.avg_hr} bpm` : "–"}</span>
            <span className="text-right text-fg-muted">{s.elevation_diff_m == null ? "–" : `${s.elevation_diff_m > 0 ? "+" : ""}${s.elevation_diff_m} m`}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Laps({ laps }: { laps: NamedLap[] }) {
  const works = laps.filter((l) => l.kind === "work");
  const workDist = works.reduce((s, l) => s + l.distance_m, 0), workTime = works.reduce((s, l) => s + l.duration_s, 0);
  const hrLaps = works.filter((l) => l.avg_hr);
  const workHr = hrLaps.length ? Math.round(hrLaps.reduce((s, l) => s + l.avg_hr! * l.duration_s, 0) / Math.max(1, hrLaps.reduce((s, l) => s + l.duration_s, 0))) : null;
  return (
    <div className="grid gap-3">
      {works.length > 1 && (
        <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-on-brand-soft">
          {[t("{n} tiros", { n: works.length }), workDist ? t("pace médio {p} /km", { p: pace(workTime / (workDist / 1000)) }) : null, workHr ? t("FC média {h} bpm", { h: workHr }) : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <ol className="grid gap-1" aria-label={t("Voltas")}>
        <li className="grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_4rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4rem_3.5rem_5rem] gap-2 px-2 text-xs text-fg-subtle"><span /><span className="text-right">{t("Distância")}</span><span className="hidden text-right sm:block">{t("Tempo")}</span><span className="text-right">{t("Pace")}</span><span className="text-right">{t("FC média/máx")}</span></li>
        {laps.map((l) => (
          <li key={l.n ?? l.start_s} className={cn("grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_4rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4rem_3.5rem_5rem] items-center gap-2 rounded-md px-2 py-1.5 text-sm tabular-nums", l.kind === "work" && "bg-brand-soft text-on-brand-soft", l.kind === "recovery" && "text-fg-muted")}>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className={cn("truncate", l.kind === "work" && "font-semibold")}><span className="sm:hidden">{lapLabel(l, works.length, true)}</span><span className="hidden sm:inline">{lapLabel(l, works.length)}</span></span>
              {l.stopped_s >= 5 && <span className="rounded-full bg-warning-soft px-1.5 text-xs text-on-warning-soft">{t("parado {t}", { t: clock(l.stopped_s) })}</span>}
            </span>
            <span className="text-right">{distance(l.distance_m)}</span>
            <span className="hidden text-right sm:block">{clock(l.duration_s)}</span>
            <span className="text-right font-semibold">{pace(l.pace)}</span>
            <span className="text-right">{l.avg_hr ? <>{l.avg_hr}{l.max_hr ? <span className="text-xs opacity-70">/{l.max_hr}</span> : null}</> : "–"}</span>
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
  const splits = a.splits ?? [];
  const works = laps.filter((l) => l.kind === "work").length;
  const [view, setView] = useState(() => defaultView(a));
  const both = splits.length > 0 && laps.length > 1;
  const showLaps = laps.length > 0 && (view === "laps" || !splits.length);
  return (
    <>
      <HeartRate a={a} laps={laps} />
      {(splits.length > 0 || laps.length > 0) && (
        <Card className="grid min-w-0 gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="rf-text-title-md">{showLaps ? (works > 1 ? t("Tiros") : t("Voltas")) : t("Parciais por km")}</h2>
            {both && <Segmented size="sm" label={t("Ver parciais ou voltas")} value={view} onChange={setView} options={[{ value: "splits", label: t("Parciais") }, { value: "laps", label: works > 1 ? t("Tiros") : t("Voltas") }]} />}
          </div>
          {showLaps ? <Laps laps={laps} /> : <Splits splits={splits} />}
        </Card>
      )}
      <Route a={a} />
    </>
  );
}

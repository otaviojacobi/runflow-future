/**
 * Weekly compliance bars (single series → no legend; the title names it). Dataviz spec: thin bars,
 * 4 px rounded data-ends on the baseline, 2 px gaps, recessive axis, only the latest value labeled,
 * per-bar hover tooltip, screen-reader table. Color: the club's brand `text` role (≥ 4.5:1 on surface
 * for ANY club color); the in-progress week is a soft outline.
 */
import { useState } from "react";
import { t } from "@/i18n";
import { dayMonth } from "@/lib/format";
import { cn } from "@/ui";

export interface TrendPoint { week_start: string; pct: number | null; planned: number; done: number; current: boolean }

export function ComplianceTrend({ data, height = 140 }: { data: TrendPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const lastIdx = data.map((d) => d.pct != null && !d.current).lastIndexOf(true);
  return (
    <figure className="grid gap-2">
      <div className="relative" style={{ height }}>
        {[100, 50].map((g) => <div key={g} aria-hidden className="absolute inset-x-0 border-t border-dashed border-line-subtle" style={{ bottom: `${(g / 100) * (height - 20)}px` }}><span className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] text-fg-subtle">{g}%</span></div>)}
        <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-[2px] pr-8" aria-hidden>
          {data.map((d, i) => {
            const pct = Math.min(100, d.pct ?? 0);
            return (
              <div key={d.week_start} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={cn("w-full max-w-7 rounded-t-[4px] transition-opacity", d.current ? "border-2 border-b-0 border-brand-line bg-brand-soft" : "bg-brand-text", hover !== null && hover !== i && "opacity-40")}
                  style={{ height: `${Math.max(2, (pct / 100) * (height - 20))}px` }} />
                {i === lastIdx && d.pct != null && hover === null && <span className="absolute text-xs font-bold tabular-nums text-fg" style={{ bottom: `${(pct / 100) * (height - 20) + 4}px` }}>{d.pct}%</span>}
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md bg-inverse px-2.5 py-1.5 text-xs text-fg-inverse shadow-md">
                    <div className="font-semibold">{t("Semana de {d}", { d: dayMonth(d.week_start) })}{d.current ? ` · ${t("em andamento")}` : ""}</div>
                    <div className="tabular-nums">{d.pct != null ? t("{p}% de aderência", { p: d.pct }) : t("Sem treinos")}</div>
                    <div className="tabular-nums opacity-80">{t("{done} de {planned} treinos", { done: d.done, planned: d.planned })}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-[2px] pr-8 text-[10px] text-fg-subtle" aria-hidden>{data.map((d) => <span key={d.week_start} className="flex-1 text-center tabular-nums">{dayMonth(d.week_start).split(" ")[0]}/{d.week_start.slice(5, 7)}</span>)}</div>
      <table className="sr-only"><caption>{t("Aderência por semana")}</caption><thead><tr><th>{t("Semana")}</th><th>{t("Aderência")}</th><th>{t("Treinos feitos")}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.week_start}><td>{d.week_start}</td><td>{d.pct ?? "–"}%</td><td>{d.done}/{d.planned}</td></tr>)}</tbody></table>
    </figure>
  );
}

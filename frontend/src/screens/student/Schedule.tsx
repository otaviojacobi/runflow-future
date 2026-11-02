/** M3 · Agenda (student): week list and month calendar. Route: /schedule */
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { useMyWorkouts } from "@/api/my";
import { sportBar } from "@/components/sport";
import { StatusBadge } from "@/components/workout";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, duration, mondayOf, today as todayFn, weekdayShort } from "@/lib/format";
import { Card, EmptyState, IconButton, PageHeader, Segmented, cn } from "@/ui";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function ScheduleScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today);
  const first = view === "week" ? mondayOf(anchor) : mondayOf(anchor.slice(0, 8) + "01");
  const last = view === "week" ? addDays(first, 6) : addDays(mondayOf(addDays(anchor.slice(0, 8) + "28", 7)), 6);
  const q = useMyWorkouts(club?.id, first, last);
  const byDay = useMemo(() => { const m = new Map<string, NonNullable<typeof q.data>>(); for (const w of q.data ?? []) m.set(w.date, [...(m.get(w.date) ?? []), w]); return m; }, [q.data]);
  if (!club) return null;
  const move = (dir: 1 | -1) => setAnchor(view === "week" ? addDays(anchor, 7 * dir) : (() => { const [y, mo] = anchor.split("-").map(Number); const d = new Date(Date.UTC(y!, mo! - 1 + dir, 1)); return d.toISOString().slice(0, 10); })());
  const title = view === "week" ? `${dayMonth(first)} – ${dayMonth(last)}` : `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const days = Array.from({ length: view === "week" ? 7 : Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1 }, (_, i) => addDays(first, i));

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader title={t("Agenda")} actions={<div data-print="hide" className="flex items-center gap-2"><IconButton variant="secondary" label={t("Imprimir")} onClick={() => window.print()}><Printer /></IconButton><Segmented label={t("Visão")} value={view} onChange={setView} options={[{ value: "week", label: t("Semana") }, { value: "month", label: t("Mês") }]} /></div>} />
      <div className="flex items-center gap-2"><IconButton variant="secondary" label={t("Anterior")} onClick={() => move(-1)}><ChevronLeft /></IconButton><span className="min-w-40 text-center font-semibold first-letter:uppercase">{title}</span><IconButton variant="secondary" label={t("Próximo")} onClick={() => move(1)}><ChevronRight /></IconButton><button className="ml-2 text-sm font-semibold text-brand-text" onClick={() => setAnchor(today)}>{t("Hoje")}</button></div>
      {view === "week" ? (
        <div className="grid gap-2">
          {days.map((d) => {
            const ws = byDay.get(d) ?? [];
            return (
              <div key={d} className={cn("grid grid-cols-[56px_1fr] gap-3 rounded-lg border bg-surface p-3", d === today ? "border-brand-ring" : "border-line")}>
                <div className="text-center"><div className={cn("text-xs font-bold uppercase", d === today ? "text-brand-text" : "text-fg-muted")}>{weekdayShort(d)}</div><div className="font-display text-xl font-bold tabular-nums">{Number(d.slice(8))}</div></div>
                <div className="grid content-center gap-2">
                  {ws.length ? ws.map((w) => (
                    <Link key={w.id} to="/workouts/$id" params={{ id: w.id }} className="flex items-center gap-3 rounded-md p-1 hover:bg-soft">
                      <span className={cn("h-9 w-1 rounded-full", sportBar[w.sport])} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{w.title}</span><span className="text-xs text-fg-muted">{w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : ""}</span></span>
                      {w.completion ? <StatusBadge status={w.completion.status} /> : d < today ? null : <ChevronRight className="size-4 text-fg-subtle" />}
                    </Link>
                  )) : <span className="text-sm text-fg-subtle">{t("Descanso")}</span>}
                </div>
              </div>
            );
          })}
          {!q.isPending && !(q.data ?? []).length && <Card><EmptyState title={t("Semana livre")}>{t("Quando seu treinador montar a semana, os treinos aparecem aqui.")}</EmptyState></Card>}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 bg-sunken text-center text-[11px] font-bold uppercase text-fg-muted">{["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => <span key={d} className="py-2">{t(d)}</span>)}</div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const ws = byDay.get(d) ?? [];
              const out = d.slice(5, 7) !== anchor.slice(5, 7);
              return (
                <div key={d} className={cn("min-h-20 border-t border-l border-line-subtle p-1.5 [&:nth-child(7n+1)]:border-l-0", out && "bg-sunken/60", d === today && "bg-brand-soft")}>
                  <div className={cn("text-xs font-bold tabular-nums", out ? "text-fg-subtle" : "text-fg", d === today && "text-brand-text")}>{Number(d.slice(8))}</div>
                  <div className="mt-1 grid gap-1">{ws.slice(0, 3).map((w) => <Link key={w.id} to="/workouts/$id" params={{ id: w.id }} title={w.title} className={cn("h-1.5 rounded-full", w.completion?.status === "missed" ? "bg-danger" : sportBar[w.sport], w.completion && w.completion.status !== "missed" ? "opacity-100" : "opacity-60")} />)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

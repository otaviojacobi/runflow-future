import { addDays, isoWeekday, today as todayFn } from "@/lib/format";
import { t } from "@/i18n";
import { cn } from "@/ui";

export type DayState = "done" | "partial" | "missed" | "planned" | "rest";
const LETTER = ["S", "T", "Q", "Q", "S", "S", "D"];
const NAME = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

/** Mon–Sun strip. `states[date]` colors the day; `selected` gets the brand ring; today is highlighted. */
export function WeekStrip({ monday, states, selected, onSelect, className }: { monday: string; states: Record<string, DayState | undefined>; selected?: string; onSelect?: (date: string) => void; className?: string }) {
  const today = todayFn();
  return (
    <div className={cn("grid grid-cols-7 gap-0.5 rounded-lg border border-line bg-surface px-1.5 py-2.5", className)}>
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(monday, i);
        const st = states[date] ?? "rest";
        const isToday = date === today;
        const isSel = date === selected;
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag key={date} type={onSelect ? "button" : undefined} onClick={onSelect ? () => onSelect(date) : undefined}
            aria-label={onSelect ? t("{day}, dia {n}", { day: NAME[isoWeekday(date) - 1]!, n: Number(date.slice(8)) }) : undefined}
            aria-pressed={onSelect ? isSel : undefined}
            className="flex flex-col items-center gap-1 rounded-md py-0.5 text-[11px] font-semibold text-fg-subtle">
            <span className={cn(isToday && "text-brand-text")}>{LETTER[i]}</span>
            <span className={cn("grid size-[30px] place-items-center rounded-full text-[13px] font-bold tabular-nums text-fg",
              st === "done" && "bg-success-soft text-on-success-soft", st === "partial" && "bg-warning-soft text-on-warning-soft", st === "missed" && "bg-danger-soft text-on-danger-soft",
              st === "rest" && "font-medium text-fg-subtle",
              isToday && "bg-brand text-on-brand ring-1 ring-inset ring-brand-edge", isSel && !isToday && "ring-2 ring-brand-ring")}>
              {Number(date.slice(8))}
            </span>
            <i className={cn("size-[5px] rounded-full", st === "planned" && "bg-fg-subtle", st === "done" && "bg-success", st === "partial" && "bg-warning", st === "missed" && "bg-danger", isToday && st === "planned" && "bg-brand")} />
          </Tag>
        );
      })}
    </div>
  );
}

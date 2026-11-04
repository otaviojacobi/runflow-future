/**
 * A date field that always reads and writes dd/mm/aaaa (founder, 2026-11-04), whatever the browser's language: the
 * native <input type="date"> follows the browser (an English Chrome shows mm/dd/yyyy and a year list going forward).
 * Typed with a mask (digits; a pasted 2026-11-03 or 03/11/2026 works too) or picked in a month grid (Monday first,
 * pt-BR). `value`/`onChange` are ISO "YYYY-MM-DD"; "" while empty, incomplete or outside `min`/`max`, and the field
 * says why. Years after `max` (and before `min`) stay in the year list, grayed out: a birth date (`max` = today)
 * starts at this year and goes back.
 */
import { Popover } from "radix-ui";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/i18n";
import { addDays, brDate, brToIso, isoWeekday, maskDate, today as todayFn } from "@/lib/format";
import { cn } from "./cn";
import { Input } from "./form";

type Props = {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** Where the calendar opens while the field is empty (an ISO day); default today, kept within min/max. */
  initialMonth?: string;
  autoComplete?: string;
  "aria-describedby"?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
const clamp = (d: string, min?: string, max?: string) => (min && d < min ? min : max && d > max ? max : d);
/** The same day n months away (the 31st becomes the month's last day). */
function shiftMonths(d: string, n: number): string {
  const total = +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1) + n;
  return dayOf(Math.floor(total / 12), (total % 12) + 1, +d.slice(8, 10));
}
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 15)));
  return s.charAt(0).toUpperCase() + s.slice(1);
});
const WEEKDAYS = [["S", "segunda-feira"], ["T", "terça-feira"], ["Q", "quarta-feira"], ["Q", "quinta-feira"], ["S", "sexta-feira"], ["S", "sábado"], ["D", "domingo"]] as const;
const spoken = (d: string) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function DateInput({ id, value, onChange, min, max, invalid, disabled, className, initialMonth, autoComplete, "aria-describedby": describedBy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const msgId = useId();
  const [text, setText] = useState(() => (value ? brDate(value) : ""));
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const emitted = useRef<string | null>(null);
  // A change from outside (a reset, a preset) replaces the text, unless the person is typing in the field.
  useEffect(() => {
    if (value === emitted.current || document.activeElement === input.current) return;
    emitted.current = null;
    setText(value ? brDate(value) : "");
  }, [value]);

  const outside = (d: string) => (!!min && d < min) || (!!max && d > max);
  const iso = brToIso(text);
  const problem = !text ? null
    : iso ? (min && iso < min ? t("Escolha uma data a partir de {d}.", { d: brDate(min) }) : max && iso > max ? t("Escolha uma data até {d}.", { d: brDate(max) }) : null)
    : text.length === 10 || touched ? t("Use o formato dd/mm/aaaa.") : null;

  const write = (next: string) => {
    setText(next);
    const v = brToIso(next);
    const out = v && !outside(v) ? v : "";
    emitted.current = out;
    if (out !== value) onChange(out);
  };
  const onText = (raw: string) => {
    const pasted = /^\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
    write(pasted ? brDate(pasted[1]!) : maskDate(raw));
  };
  const pick = (d: string) => { write(brDate(d)); setTouched(true); setOpen(false); };
  const start = iso && !outside(iso) ? iso : value || clamp(initialMonth ?? todayFn(), min, max);

  return (
    <div className="flex flex-col gap-1.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <div className="relative">
            <Input
              ref={input} id={id} value={text} disabled={disabled} inputMode="numeric" maxLength={10} placeholder={t("dd/mm/aaaa")}
              autoComplete={autoComplete ?? "off"} invalid={invalid || !!problem}
              aria-describedby={[describedBy, problem ? msgId : null].filter(Boolean).join(" ") || undefined}
              onChange={(e) => onText(e.target.value)} onBlur={() => setTouched(true)}
              onKeyDown={(e) => { if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
              className={cn("pr-11 tabular-nums", className)}
            />
            <Popover.Trigger asChild>
              <button type="button" disabled={disabled}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-50">
                <CalendarDays className="size-4" aria-hidden /><span className="sr-only">{t("Escolher no calendário")}</span>
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="end" sideOffset={6} collisionPadding={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}
            className="z-50 w-[18.5rem] rounded-lg border border-line-subtle bg-raised p-3 text-fg shadow-md"
          >
            <Calendar selected={iso && !outside(iso) ? iso : null} start={start} min={min} max={max} onPick={pick} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {problem && <p id={msgId} className="flex items-center gap-1 rf-text-caption text-danger-text"><CircleAlert className="size-3.5 shrink-0" aria-hidden />{problem}</p>}
    </div>
  );
}

const SELECT = "h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg focus:outline-none focus:border-brand-ring focus:ring-3 focus:ring-brand-ring/25";
const NAV = "grid size-9 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:pointer-events-none disabled:opacity-40";

/** A month grid with month and year lists. Arrows move the day, PageUp/PageDown the month (with Shift the year). */
function Calendar({ selected, start, min, max, onPick }: { selected: string | null; start: string; min?: string; max?: string; onPick: (d: string) => void }) {
  const [focus, setFocus] = useState(clamp(selected ?? start, min, max));
  const keyNav = useRef(true); // focus the day when the calendar opens and after each key in the grid
  const grid = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const today = todayFn();
  const y = +focus.slice(0, 4), m = +focus.slice(5, 7);
  const outside = (d: string) => (!!min && d < min) || (!!max && d > max);
  // Years newest first; the ones after `max` (and before `min`) are listed but can't be picked.
  const hi = max ? +max.slice(0, 4) : +today.slice(0, 4) + 10;
  const lo = min ? +min.slice(0, 4) : +today.slice(0, 4) - 100;
  const top = Math.max(max ? hi + 5 : hi, y), bottom = Math.min(min ? lo - 5 : lo, y);
  const years = Array.from({ length: top - bottom + 1 }, (_, i) => top - i);
  const monthOut = (yy: number, mm: number) => (!!max && dayOf(yy, mm, 1) > max) || (!!min && dayOf(yy, mm, 31) < min);
  const goTo = (yy: number, mm: number) => setFocus(clamp(dayOf(yy, mm, +focus.slice(8, 10)), min, max));

  const lead = isoWeekday(dayOf(y, m, 1)) - 1;
  const cells = Array.from({ length: Math.ceil((lead + daysIn(y, m)) / 7) * 7 }, (_, i) => (i >= lead && i < lead + daysIn(y, m) ? dayOf(y, m, i - lead + 1) : null));
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1), ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, 1 - isoWeekday(focus)), End: () => addDays(focus, 7 - isoWeekday(focus)),
      PageUp: () => shiftMonths(focus, e.shiftKey ? -12 : -1), PageDown: () => shiftMonths(focus, e.shiftKey ? 12 : 1),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    keyNav.current = true;
    setFocus(clamp(move(), min, max));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button type="button" className={NAV} disabled={!!min && dayOf(y, m, 1) <= min} onClick={() => setFocus(clamp(shiftMonths(focus, -1), min, max))}>
          <ChevronLeft className="size-4" aria-hidden /><span className="sr-only">{t("Mês anterior")}</span>
        </button>
        <select aria-label={t("Mês")} value={m} onChange={(e) => goTo(y, +e.target.value)} className={cn(SELECT, "min-w-0 flex-1")}>
          {MONTHS.map((name, i) => <option key={name} value={i + 1} disabled={monthOut(y, i + 1)}>{name}</option>)}
        </select>
        <select aria-label={t("Ano")} value={y} onChange={(e) => goTo(+e.target.value, m)} className={cn(SELECT, "w-[5.5rem] tabular-nums")}>
          {years.map((yy) => <option key={yy} value={yy} disabled={yy > hi || yy < lo}>{yy}</option>)}
        </select>
        <button type="button" className={NAV} disabled={!!max && dayOf(y, m, 31) >= max} onClick={() => setFocus(clamp(shiftMonths(focus, 1), min, max))}>
          <ChevronRight className="size-4" aria-hidden /><span className="sr-only">{t("Próximo mês")}</span>
        </button>
      </div>
      <table ref={grid} role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} onKeyDown={onKey} className="w-full border-collapse">
        <thead>
          <tr>{WEEKDAYS.map(([short, long], i) => <th key={i} scope="col" abbr={t(long)} className="pb-1 text-center rf-text-caption font-semibold text-fg-subtle"><span aria-hidden>{short}</span><span className="sr-only">{t(long)}</span></th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((d, i) => (
                <td key={i} role="gridcell" aria-selected={d ? d === selected : undefined} className="p-0.5 text-center">
                  {d && (
                    <button
                      type="button" data-day={d} tabIndex={d === focus ? 0 : -1} disabled={outside(d)} aria-current={d === today ? "date" : undefined}
                      onClick={() => onPick(d)} onFocus={() => d !== focus && setFocus(d)}
                      className={cn(
                        "relative mx-auto grid size-9 place-items-center rounded-md text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
                        d === selected ? "bg-brand font-semibold text-on-brand" : "hover:bg-soft",
                        d === today && d !== selected && "font-bold text-brand-text ring-1 ring-inset ring-brand-ring",
                        outside(d) && "cursor-not-allowed text-fg-disabled hover:bg-transparent",
                      )}
                    >
                      <span aria-hidden>{+d.slice(8, 10)}</span><span className="sr-only">{spoken(d)}</span>
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

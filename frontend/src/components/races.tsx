/** Shared bits for races (W12 staff, M9 student, planning flags). */
import type { Race, RaceEntry, RaceSport } from "@/api/types";
import { t, tn } from "@/i18n";
import { clock, daysBetween, distance, pace } from "@/lib/format";
import { Badge, cn, type Tone } from "@/ui";

export const RACE_SPORTS: RaceSport[] = ["run", "trail", "swim", "bike", "triathlon", "other"];
export const RACE_SPORT_LABEL: Record<RaceSport, string> = { run: "Corrida", trail: "Trail", swim: "Águas abertas", bike: "Ciclismo", triathlon: "Triathlon", other: "Outro" };
export const DISTANCE_PRESETS: Record<RaceSport, number[]> = {
  run: [5000, 10000, 21097, 42195], trail: [10000, 21000, 42000], swim: [750, 1500, 3000, 5000], bike: [40000, 90000, 180000], triathlon: [25750, 51500, 113000], other: [],
};
const NAMED: Record<number, string> = { 21097: "21 km", 42195: "42 km" };

/** 5000 → "5 km"; 21097 → "21 km"; 1500 (swim) → "1.500 m". */
export const distanceLabel = (m: number, sport: RaceSport = "run") => NAMED[m] ?? distance(m, { swim: sport === "swim" });

/** Countdown in days relative to `today` (club-local dates). */
export function countdown(date: string, today: string) {
  const d = daysBetween(today, date);
  if (d === 0) return t("hoje");
  if (d === 1) return t("amanhã");
  if (d > 1) return tn(d, "em {n} dia", "em {n} dias");
  return d === -1 ? t("ontem") : tn(-d, "há {n} dia", "há {n} dias");
}

/** Goal or result pace for running distances. */
export const racePace = (time_s: number | null, m: number, sport: RaceSport) => (time_s && (sport === "run" || sport === "trail") ? `${pace(time_s / (m / 1000))} /km` : null);

const STATUS: Record<RaceEntry["status"], { label: string; tone: Tone }> = {
  registered: { label: "Inscrito", tone: "info" }, finished: { label: "Concluiu", tone: "success" }, dns: { label: "Não largou", tone: "neutral" }, dnf: { label: "Não completou", tone: "warning" },
};
export function EntryBadge({ e }: { e: Pick<RaceEntry, "status" | "result_time_s"> }) {
  const s = STATUS[e.status];
  return <Badge tone={s.tone}>{e.status === "finished" && e.result_time_s ? clock(e.result_time_s) : t(s.label)}</Badge>;
}

/** Calendar-style date tile. */
export function DateTile({ date, className, accent }: { date: string; className?: string; accent?: boolean }) {
  const mon = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")).replace(".", "");
  return (
    <span className={cn("grid w-14 shrink-0 justify-items-center overflow-hidden rounded-lg border text-center", accent ? "border-accent-edge" : "border-line", className)}>
      <span className={cn("w-full py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", accent ? "bg-accent text-on-accent" : "bg-sunken text-fg-muted")}>{mon}</span>
      <span className="py-1 font-display text-xl font-bold tabular-nums leading-none">{Number(date.slice(8))}</span>
    </span>
  );
}

export const raceWhere = (r: Pick<Race, "city" | "state">) => [r.city, r.state].filter(Boolean).join(" · ");

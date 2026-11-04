/** Texts for activity matching (D-049): how a workout relates to the activity the student is placing. */
import type { MatchOption, Sport } from "@/api/types";
import { t, tn } from "@/i18n";
import { daysBetween, distance, duration } from "./format";

/** "no dia", "adiantado 1 dia" (done before the planned date), "atrasado 2 dias" (done after it). */
export function dayOffset(activityDay: string, workoutDate: string): string {
  const n = daysBetween(activityDay, workoutDate);
  if (n === 0) return t("no dia");
  return n > 0 ? tn(n, "adiantado {n} dia", "adiantado {n} dias") : tn(-n, "atrasado {n} dia", "atrasado {n} dias");
}

/** What was planned, for comparing with what was done: distance and time when known. */
export function plannedSize(o: Pick<MatchOption, "est_distance_m" | "est_duration_s">, sport: Sport): string {
  return [o.est_distance_m && distance(o.est_distance_m, { swim: sport === "swim" }), o.est_duration_s && `≈ ${duration(o.est_duration_s)}`].filter(Boolean).join(" · ");
}

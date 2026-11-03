/**
 * Shared bits for races (M9 student, W12 staff), mirroring the web's components/races.tsx: sport labels, distance
 * presets and labels, countdown, goal/result pace, the entry status badge, the calendar date tile, and the race's site.
 */
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import type { Race, RaceEntry, RaceSport } from "@/api/types";
import { t, tn } from "@/i18n";
import { clock, daysBetween, distance, pace } from "@/lib/format";
import { weight, type Tone } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Text, toast } from "@/ui";

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

/** Calendar-style date tile: the month on a band (the club's accent for a goal race), the day big. */
export function DateTile({ date, accent }: { date: string; accent?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const mon = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")).replace(".", "");
  return (
    <View aria-hidden style={[styles.tile, { width: theme.space[12] + theme.space[2], borderRadius: theme.radius.md, borderColor: accent ? c.accent.border : c.line }]}>
      <Text variant="caption" color={accent ? c.accent.onSolid : c.fgMuted}
        style={[styles.mon, { paddingVertical: theme.space["0.5"], backgroundColor: accent ? c.accent.solid : c.sunken }]}>{mon}</Text>
      <Text variant="metricMd" style={{ paddingVertical: theme.space[1] }}>{Number(date.slice(8))}</Text>
    </View>
  );
}

export const raceWhere = (r: Pick<Race, "city" | "state">) => [r.city, r.state].filter(Boolean).join(" · ");

/** The race's own site in the in-app browser. */
export async function openRaceSite(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    toast.info(t("Não deu para abrir o site da prova"));
  }
}

/** "52:30" / "1:45:00" from digits as typed (h:mm:ss at most), like the account forms. */
export { maskClock, parseClock } from "@/components/account/inputs";

const styles = StyleSheet.create({
  tile: { alignItems: "center", overflow: "hidden", borderWidth: 1 },
  mon: { alignSelf: "stretch", textAlign: "center", textTransform: "uppercase", fontWeight: weight("bold") },
});

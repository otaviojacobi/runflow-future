/** Shared bits for challenges (W15, M11). */
import { Award, Flame, Medal, Trophy, type LucideIcon } from "lucide-react";
import type { Badge as BadgeT, Challenge, ChallengeMetric, ChallengeStanding } from "@/api/types";
import { t, tn } from "@/i18n";
import { dayMonth, number } from "@/lib/format";
import { Avatar, Badge, cn, type Tone } from "@/ui";

export const METRIC_LABEL: Record<ChallengeMetric, string> = { distance: "Distância", duration: "Tempo de treino", sessions: "Número de treinos", elevation: "Altimetria" };
export const metricValue = (m: ChallengeMetric, v: number) => (m === "distance" ? `${number(v, 1)} km` : m === "duration" ? `${number(v, 1)} h` : m === "elevation" ? `${number(v)} m` : tn(v, "{n} treino", "{n} treinos"));
export const challengeWhen = (c: Pick<Challenge, "starts_on" | "ends_on">) => `${dayMonth(c.starts_on)} – ${dayMonth(c.ends_on)}`;
const STATUS: Record<Challenge["status"], { label: string; tone: Tone }> = { active: { label: "Em andamento", tone: "success" }, upcoming: { label: "Em breve", tone: "info" }, finished: { label: "Encerrado", tone: "neutral" } };
export const ChallengeStatus = ({ s }: { s: Challenge["status"] }) => <Badge tone={STATUS[s].tone}>{t(STATUS[s].label)}</Badge>;

/** Thin progress meter in the club accent (achievements), with the value on the side. */
export function GoalBar({ value, goal, metric }: { value: number; goal: number | null; metric: ChallengeMetric }) {
  const pct = goal ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <div className="grid gap-1">
      {goal ? <div className="h-2 overflow-hidden rounded-full bg-soft" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={t("Progresso")}><div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} /></div> : null}
      <div className="flex justify-between text-xs tabular-nums text-fg-muted"><span className="font-semibold text-fg">{metricValue(metric, value)}</span>{goal ? <span>{t("meta {g}", { g: metricValue(metric, goal) })}</span> : null}</div>
    </div>
  );
}

const PODIUM = ["bg-accent text-on-accent", "bg-soft text-fg", "bg-soft text-fg"];
export function Leaderboard({ rows, metric, meId }: { rows: ChallengeStanding[]; metric: ChallengeMetric; meId?: string }) {
  if (!rows.length) return <p className="text-sm text-fg-muted">{t("Ninguém participando ainda.")}</p>;
  return (
    <ol className="divide-y divide-line-subtle">
      {rows.map((r) => (
        <li key={r.membership_id} className={cn("flex items-center gap-3 py-2", r.membership_id === meId && "rounded-md bg-accent-soft/50 px-2")}>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums", r.rank <= 3 ? PODIUM[r.rank - 1] : "text-fg-muted")}>{r.rank}</span>
          <Avatar name={r.user.name} src={r.user.avatar_url} size={30} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.user.name}{r.membership_id === meId ? ` (${t("você")})` : ""}</span>
          <span className="text-sm font-semibold tabular-nums">{metricValue(metric, r.value)}</span>
          {r.pct != null && <span className="w-12 text-right text-xs tabular-nums text-fg-muted">{r.pct}%</span>}
        </li>
      ))}
    </ol>
  );
}

const BADGE_ICON: Record<BadgeT["kind"], LucideIcon> = { streak: Flame, distance_month: Medal, challenge: Trophy, race: Award };
export function BadgeTile({ b }: { b: BadgeT }) {
  const I = BADGE_ICON[b.kind];
  return (
    <li className="grid justify-items-center gap-2 rounded-xl border border-accent-line bg-accent-soft p-3 text-center text-on-accent-soft">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-on-accent ring-1 ring-inset ring-accent-edge"><I className="size-6" /></span>
      <span className="text-sm font-semibold leading-tight">{b.title}</span>
    </li>
  );
}

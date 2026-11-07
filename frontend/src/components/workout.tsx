import { Check, Circle, CircleDashed, Minus, X } from "lucide-react";
import type { Sport, Zone } from "@/api/types";
import { profileHeights, segments, type Structure, type ZoneN } from "@/domain/workout";
import { t } from "@/i18n";
import { pace } from "@/lib/format";
import { Badge, cn, type Tone } from "@/ui";

const ZONE_BG: Record<ZoneN, string> = { 1: "bg-z1", 2: "bg-z2", 3: "bg-z3", 4: "bg-z4", 5: "bg-z5" };
export const zoneBg = ZONE_BG;

/** Intensity profile: one bar per segment, width = time, color = zone, height = how hard within the workout (profileHeights). */
export function IntensityProfile({ structure, sport, height = 48, className }: { structure: Structure; sport: Sport; height?: number; className?: string }) {
  const segs = segments(structure, sport);
  const heights = profileHeights(segs);
  if (!segs.length) return <div className={cn("grid place-items-center rounded-md border border-dashed border-line text-xs text-fg-subtle", className)} style={{ height }}>{t("Sem etapas ainda")}</div>;
  return (
    <div role="img" aria-label={t("Perfil de intensidade")} className={cn("flex items-end gap-[2px]", className)} style={{ height }}>
      {segs.map((s, i) => (
        <span key={i} className={cn("min-w-[3px] rounded-t-[3px] rounded-b-[1px]", ZONE_BG[s.zone])} style={{ flex: `${s.seconds} 1 0`, height: `${heights[i]}%` }} />
      ))}
    </div>
  );
}
export function ZoneDot({ zone, className }: { zone: ZoneN; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", ZONE_BG[zone], className)} />;
}

export type WorkoutStatus = "planned" | "completed" | "partial" | "missed" | "skipped";
const STATUS: Record<WorkoutStatus, { label: string; tone: Tone; Icon: typeof Check }> = {
  planned: { label: "Planejado", tone: "neutral", Icon: Circle },
  completed: { label: "Concluído", tone: "success", Icon: Check },
  partial: { label: "Parcial", tone: "warning", Icon: Minus },
  missed: { label: "Não realizado", tone: "danger", Icon: X },
  skipped: { label: "Pulado", tone: "neutral", Icon: CircleDashed },
};
export function StatusBadge({ status, solid }: { status: WorkoutStatus; solid?: boolean }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} solid={solid} icon={<s.Icon aria-hidden />}>{t(s.label)}</Badge>;
}
export const statusLabel = (s: WorkoutStatus) => t(STATUS[s].label);

/** A number with a smaller unit: 4:30 /km. */
export function Stat({ value, unit, label, size = "md", className }: { value: string; unit?: string; label?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const v = { sm: "text-[17px]", md: "text-[22px]", lg: "text-[28px]" }[size];
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline gap-1">
        <span className={cn("font-display font-bold leading-none tracking-[-0.01em] tabular-nums [font-stretch:110%]", v)}>{value}</span>
        {unit && <span className="text-xs font-semibold text-fg-muted">{unit}</span>}
      </div>
      {label && <div className="mt-1 rf-text-caption text-fg-muted">{label}</div>}
    </div>
  );
}
export function complianceTone(pct: number): Tone {
  return pct >= 80 ? "success" : pct >= 60 ? "warning" : "danger";
}
export function ComplianceBar({ pct, className }: { pct: number | null; className?: string }) {
  if (pct == null) return <span className="text-sm text-fg-subtle">–</span>;
  const tone = complianceTone(pct);
  const text = { success: "text-success-text", warning: "text-warning-text", danger: "text-danger-text" }[tone as "success"];
  const bar = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone as "success"];
  return (
    <div className={cn("grid gap-1", className)}>
      <span className={cn("text-sm font-bold tabular-nums", text)}>{pct}%</span>
      <span className="h-[5px] overflow-hidden rounded-full bg-soft"><i className={cn("block h-full rounded-full", bar)} style={{ width: `${Math.min(100, pct)}%` }} /></span>
    </div>
  );
}

/** Zone bounds, Z5 on top. `unit` picks pace (/km) or heart rate (bpm). */
export function ZoneTable({ z, unit }: { z: Pick<Zone, "bounds">; unit: "pace" | "hr" | "swim_pace" | "power" }) {
  const fmt = (b: Zone["bounds"][number]) => unit === "pace" ? `${pace(b.min)} – ${pace(b.max)} /km` : unit === "swim_pace" ? `${pace(b.min)} – ${pace(b.max)} /100 m` : unit === "power" ? `${b.min} – ${b.max} W` : `${b.min} – ${b.max} bpm`;
  return (
    <table className="w-full text-sm"><tbody>{[...z.bounds].reverse().map((b) => (
      <tr key={b.zone} className="border-t border-line-subtle"><td className="py-2"><span className={cn("inline-grid size-7 place-items-center rounded-md text-xs font-bold", ZONE_BG[b.zone as ZoneN])} style={{ color: `var(--rf-zone-${b.zone}-on-solid)` }}>Z{b.zone}</span></td>
        <td className="py-2 font-semibold tabular-nums">{fmt(b)}</td></tr>
    ))}</tbody></table>
  );
}

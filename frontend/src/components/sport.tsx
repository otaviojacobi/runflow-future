import { Activity, Bike, Dumbbell, Footprints, PersonStanding, Waves, type LucideIcon } from "lucide-react";
import type { Sport } from "@/api/types";
import { t } from "@/i18n";
import { cn } from "@/ui";

export const SPORTS: Sport[] = ["run", "swim", "bike", "strength", "mobility", "other"];
export const SPORT_LABEL: Record<Sport, string> = { run: "Corrida", swim: "Natação", bike: "Ciclismo", strength: "Musculação", mobility: "Mobilidade", other: "Outro" };
export const SPORT_ICON: Record<Sport, LucideIcon> = { run: Footprints, swim: Waves, bike: Bike, strength: Dumbbell, mobility: PersonStanding, other: Activity };
const SOFT: Record<Sport, string> = {
  run: "bg-run-soft text-on-run-soft", swim: "bg-swim-soft text-on-swim-soft", bike: "bg-bike-soft text-on-bike-soft",
  strength: "bg-strength-soft text-on-strength-soft", mobility: "bg-mobility-soft text-on-mobility-soft", other: "bg-other-soft text-on-other-soft",
};
const SOLID: Record<Sport, string> = {
  run: "bg-run text-on-run", swim: "bg-swim text-on-swim", bike: "bg-bike text-on-bike", strength: "bg-strength text-on-strength", mobility: "bg-mobility text-on-mobility", other: "bg-other text-on-other",
};
export const sportBar: Record<Sport, string> = { run: "bg-run", swim: "bg-swim", bike: "bg-bike", strength: "bg-strength", mobility: "bg-mobility", other: "bg-other" };
export const sportSoft = SOFT;

export function SportChip({ sport, size = "md", className }: { sport: Sport; size?: "sm" | "md"; className?: string }) {
  const I = SPORT_ICON[sport];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold", size === "sm" ? "h-6 px-2 text-xs [&_svg]:size-3.5" : "h-[26px] px-2.5 text-[13px] [&_svg]:size-[15px]", SOFT[sport], className)}>
      <I aria-hidden />{t(SPORT_LABEL[sport])}
    </span>
  );
}
export function SportBadge({ sport, size = 40, className }: { sport: Sport; size?: number; className?: string }) {
  const I = SPORT_ICON[sport];
  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-[12px]", SOLID[sport], className)} style={{ width: size, height: size }} title={t(SPORT_LABEL[sport])}>
      <I style={{ width: size * 0.55, height: size * 0.55 }} aria-hidden />
    </span>
  );
}

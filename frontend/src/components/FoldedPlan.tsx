/** A done workout's plan (D-055): its intensity profile, the steps (and whatever else the screen adds) a click away,
 * so the activity's splits or tiros come up on the first screen. Used by the student's workout and the trainer's
 * workout dialog once an activity completed it; the app has the same fold. */
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { Sport } from "@/api/types";
import type { Structure } from "@/domain/workout";
import { IntensityProfile } from "@/components/workout";
import { WorkoutSteps } from "@/components/WorkoutSteps";
import { t } from "@/i18n";
import { cn } from "@/ui";

export function FoldedPlan({ structure, sport, label, children }: { structure: Structure; sport: Sport; label?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring">
        {label && <span className="min-w-0 flex-1 truncate">{label}</span>}
        <span className={cn("flex shrink-0 items-center gap-1 font-semibold text-brand-text", !label && "mr-auto")}>
          {open ? t("Esconder as etapas") : t("Ver as etapas")}
          <ChevronDown className={cn("size-4 transition-transform duration-150 ease-standard", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      {/* Outside the button: inside one, Chrome sized the profile past the card on phones. */}
      <IntensityProfile structure={structure} sport={sport} height={32} />
      <div id={id} hidden={!open} className="grid gap-3">
        {open && <WorkoutSteps structure={structure} sport={sport} />}
        {open && children}
      </div>
    </div>
  );
}

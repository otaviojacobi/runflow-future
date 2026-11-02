import { Repeat as RepeatIcon } from "lucide-react";
import { useExerciseLookup } from "@/api/exercises";
import type { Sport } from "@/api/types";
import { exerciseText, stepText, zoneOf, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { cn } from "@/ui";
import { useClub } from "@/lib/club";
import { HowToButton } from "./ExerciseVideo";
import { zoneBg } from "./workout";

/** Read-only list of a workout's blocks (series grouped, zone color per step). */
export function WorkoutSteps({ structure, sport, className }: { structure: Structure; sport: Sport; className?: string }) {
  const { club } = useClub();
  const lookup = useExerciseLookup(structure.blocks.some((b) => b.kind === "exercise") ? club?.id : undefined);
  return (
    <ol className={cn("grid gap-2", className)}>
      {structure.blocks.map((b, i) =>
        b.kind === "exercise" ? (
          <li key={i} className="flex items-start gap-3 rounded-md bg-sunken px-3 py-2"><span className="mt-0.5 font-bold tabular-nums text-fg-muted">{i + 1}</span><span className="min-w-0 flex-1"><span className="block font-semibold">{b.name}</span><span className="text-sm text-fg-muted">{exerciseText(b)}{b.note ? ` · ${b.note}` : ""}</span></span>{(() => { const ex = lookup(b); return ex && (ex.video_url || ex.cues) ? <HowToButton exercise={ex} /> : null; })()}</li>
        ) : b.kind === "repeat" ? (
          <li key={i} className="grid gap-1.5 rounded-md border border-dashed border-line-strong p-2.5">
            <span className="flex items-center gap-1.5 text-sm font-bold"><RepeatIcon className="size-4 text-fg-muted" />{t("{n}× série", { n: b.count })}</span>
            {b.steps.map((s, j) => <span key={j} className="flex items-center gap-2.5 pl-1 text-sm"><i className={cn("size-2.5 shrink-0 rounded-[3px]", zoneBg[zoneOf(s, sport)])} />{stepText(s, sport)}{s.note && <span className="text-fg-muted">· {s.note}</span>}</span>)}
          </li>
        ) : (
          <li key={i} className="flex items-center gap-2.5 px-1 text-sm"><i className={cn("size-2.5 shrink-0 rounded-[3px]", zoneBg[zoneOf(b, sport)])} />{stepText(b, sport)}{b.note && <span className="text-fg-muted">· {b.note}</span>}</li>
        ),
      )}
    </ol>
  );
}

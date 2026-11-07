import { Repeat as RepeatIcon } from "lucide-react";
import { useExerciseLookup } from "@/api/exercises";
import type { Sport } from "@/api/types";
import { exerciseText, repeatTitle, stepText, zoneOf, type Step, type Structure } from "@/domain/workout";
import { cn } from "@/ui";
import { useClub } from "@/lib/club";
import { HowToButton } from "./ExerciseVideo";
import { zoneBg } from "./workout";

/** Read-only list of a workout's blocks (series grouped, zone color per step). The coach's notes read in the same flow
 * (D-059): the workout's note first, a step's note in italics under that step. */
export function WorkoutSteps({ structure, sport, className }: { structure: Structure; sport: Sport; className?: string }) {
  const { club } = useClub();
  const lookup = useExerciseLookup(structure.blocks.some((b) => b.kind === "exercise") ? club?.id : undefined);
  return (
    <ol className={cn("grid gap-2", className)}>
      {structure.note && <li className="px-1 text-sm italic text-fg-muted">{structure.note}</li>}
      {structure.blocks.map((b, i) =>
        b.kind === "exercise" ? (
          <li key={i} className="flex items-start gap-3 rounded-md bg-sunken px-3 py-2"><span className="mt-0.5 font-bold tabular-nums text-fg-muted">{i + 1}</span><span className="min-w-0 flex-1"><span className="block font-semibold">{b.name}</span><span className="text-sm text-fg-muted">{exerciseText(b)}{b.note ? ` · ${b.note}` : ""}</span></span>{(() => { const ex = lookup(b); return ex && (ex.video_url || ex.cues) ? <HowToButton exercise={ex} /> : null; })()}</li>
        ) : b.kind === "repeat" ? (
          <li key={i} className="grid gap-1.5 rounded-md border border-dashed border-line-strong p-2.5">
            <span className="flex items-center gap-1.5 text-sm font-bold"><RepeatIcon className="size-4 text-fg-muted" />{repeatTitle(b)}{b.note && <span className="font-normal text-fg-muted">· {b.note}</span>}</span>
            {b.steps.map((s, j) => <StepLine key={j} step={s} sport={sport} className="pl-1" />)}
          </li>
        ) : (
          <li key={i}><StepLine step={b} sport={sport} className="px-1" /></li>
        ),
      )}
    </ol>
  );
}

/** One step: its zone dot and text, its note (when the coach wrote one) in italics under it. */
function StepLine({ step, sport, className }: { step: Step; sport: Sport; className?: string }) {
  return (
    <span className={cn("grid gap-0.5 text-sm", className)}>
      <span className="flex items-center gap-2.5"><i className={cn("size-2.5 shrink-0 rounded-[3px]", zoneBg[zoneOf(step, sport)])} />{stepText(step, sport)}</span>
      {step.note && <span className="pl-5 italic text-fg-muted">{step.note}</span>}
    </span>
  );
}

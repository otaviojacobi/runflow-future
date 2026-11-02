/** Exercise "how to" dialog: privacy-enhanced video embed (YouTube/Vimeo) + coaching cues. */
import { PlayCircle } from "lucide-react";
import { useState } from "react";
import type { LibraryExercise } from "@/api/types";
import { t } from "@/i18n";
import { embedUrl } from "@/lib/video";
import { Badge, Dialog } from "@/ui";

export const CATEGORY_LABEL: Record<LibraryExercise["category"], string> = { strength: "Força", core: "Core", mobility: "Mobilidade", stretch: "Alongamento", plyometrics: "Pliometria", drill: "Educativo" };

export function ExerciseHowTo({ exercise, open, onOpenChange }: { exercise: LibraryExercise | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const src = embedUrl(exercise?.video_url);
  return (
    <Dialog open={open && !!exercise} onOpenChange={onOpenChange} size="lg" title={exercise?.name ?? ""} description={exercise ? <span className="flex flex-wrap gap-1.5"><Badge>{t(CATEGORY_LABEL[exercise.category])}</Badge>{exercise.muscles.map((m) => <Badge key={m} tone="info">{m}</Badge>)}</span> : undefined}>
      {exercise && (
        <div className="grid gap-4">
          {src ? (
            <div className="aspect-video overflow-hidden rounded-lg bg-sunken">
              <iframe src={src} title={t("Vídeo: {name}", { name: exercise.name })} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          ) : <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-fg-muted">{t("Este exercício ainda não tem vídeo.")}</p>}
          {exercise.cues && <div><h3 className="mb-1 rf-text-title-sm">{t("Como fazer")}</h3><p className="text-[15px]">{exercise.cues}</p></div>}
          {exercise.equipment.length > 0 && <p className="text-sm text-fg-muted">{t("Equipamento: {e}", { e: exercise.equipment.join(", ") })}</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Small trigger used inside workout step lists. */
export function HowToButton({ exercise }: { exercise: LibraryExercise }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-brand-text hover:bg-soft">
        <PlayCircle className="size-4" />{exercise.video_url ? t("Ver vídeo") : t("Como fazer")}
      </button>
      <ExerciseHowTo exercise={exercise} open={open} onOpenChange={setOpen} />
    </>
  );
}

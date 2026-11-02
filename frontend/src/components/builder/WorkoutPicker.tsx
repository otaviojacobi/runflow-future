/** Pick a workout from the library or build one now → a draft (sport, title, structure, estimates). */
import { Library, Search, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTemplates } from "@/api/library";
import type { Club, Sport } from "@/api/types";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import { estimate, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { duration } from "@/lib/format";
import { Field, Input, Segmented, cn } from "@/ui";
import { SportPicker, WorkoutBuilder } from "./WorkoutBuilder";

export interface WorkoutDraft { sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; template_id: string | null }

export function WorkoutPicker({ club, initial, onChange }: { club: Club; initial?: WorkoutDraft | null; onChange: (d: WorkoutDraft | null) => void }) {
  const [source, setSource] = useState<"library" | "build">(initial && !initial.template_id ? "build" : "library");
  const [q, setQ] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(initial?.template_id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sport, setSport] = useState<Sport>(initial?.sport ?? club.modalities[0] ?? "run");
  const [structure, setStructure] = useState<Structure>(initial?.structure ?? { v: 1, blocks: [] });
  const templates = useTemplates(club.id);
  const list = useMemo(() => (templates.data ?? []).filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase())), [templates.data, q]);
  useEffect(() => {
    if (source === "library") {
      const w = templates.data?.find((x) => x.id === templateId);
      onChange(w ? { sport: w.sport, title: w.name, structure: w.structure, est_duration_s: w.est_duration_s, est_distance_m: w.est_distance_m, template_id: w.id } : null);
    } else {
      const e = estimate(structure, sport);
      onChange(title.trim() && structure.blocks.length ? { sport, title: title.trim(), structure, est_duration_s: e.duration_s || null, est_distance_m: e.distance_m, template_id: null } : null);
    }
  }, [source, templateId, title, sport, structure, templates.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid content-start gap-3">
      <Segmented label={t("Origem do treino")} value={source} onChange={setSource} options={[{ value: "library", label: t("Da biblioteca"), icon: <Library /> }, { value: "build", label: t("Montar agora"), icon: <Wand2 /> }]} />
      {source === "library" ? (
        <>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar na biblioteca")} placeholder={t("Buscar na biblioteca")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
          <ul className="grid max-h-[50vh] gap-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label={t("Treinos da biblioteca")}>
            {list.map((w) => (
              <li key={w.id}><button type="button" role="radio" aria-checked={templateId === w.id} onClick={() => setTemplateId(w.id)} className={cn("grid w-full gap-2 rounded-md border p-3 text-left", templateId === w.id ? "border-brand-ring bg-brand-soft" : "border-line bg-surface hover:bg-soft")}>
                <span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><SportChip sport={w.sport} size="sm" /><span className="truncate font-semibold">{w.name}</span></span><span className="shrink-0 text-xs text-fg-muted">{w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : ""}</span></span>
                <IntensityProfile structure={w.structure} sport={w.sport} height={22} />
              </button></li>
            ))}
          </ul>
        </>
      ) : (
        <div className="grid gap-3">
          <Field label={t("Nome do treino")}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Ex.: Rodagem 40′")} />}</Field>
          <SportPicker value={sport} onChange={(s) => { setSport(s); setStructure({ v: 1, blocks: [] }); }} allowed={club.modalities} />
          <WorkoutBuilder compact sport={sport} structure={structure} onChange={setStructure} />
        </div>
      )}
    </div>
  );
}

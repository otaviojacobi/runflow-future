/** W5 · Construtor de treino (library template). Routes: /library/new, /library/$id */
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSaveTemplate, useTemplate, useTemplates } from "@/api/library";
import type { Sport } from "@/api/types";
import { AiDescribe } from "@/components/AiAssist";
import { FitButton } from "@/components/FitExport";
import { TagInput } from "@/components/builder/TagInput";
import { SportPicker, WorkoutBuilder } from "@/components/builder/WorkoutBuilder";
import { cleanTags } from "@/domain/tags";
import { estimate, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { Button, ButtonLink, Field, Input, Skeleton, Textarea, toast } from "@/ui";

export function BuilderScreen() {
  const params = useParams({ strict: false }) as { id?: string };
  const isNew = !params.id;
  const { club } = useClub();
  const navigate = useNavigate();
  const tpl = useTemplate(club?.id, params.id);
  const save = useSaveTemplate(club?.id ?? "");
  const [name, setName] = useState("");
  const [sport, setSport] = useState<Sport>(club?.modalities[0] ?? "run");
  const [description, setDescription] = useState("");
  const [structure, setStructure] = useState<Structure>({ v: 1, blocks: [] });
  const [tags, setTags] = useState<string[]>([]);
  const library = useTemplates(club?.id);
  const known = useMemo(() => { const n = new Map<string, number>(); for (const w of library.data ?? []) for (const x of w.tags) n.set(x, (n.get(x) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1]).map(([x]) => x); }, [library.data]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    if (tpl.data && tpl.data.id !== loadedId) {
      setName(tpl.data.name); setSport(tpl.data.sport); setDescription(tpl.data.description ?? ""); setStructure(tpl.data.structure); setTags(tpl.data.tags); setLoadedId(tpl.data.id);
    }
  }, [tpl.data, loadedId]);
  if (!club) return null;
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = () => {
    const est = estimate(structure, sport);
    save.mutate({ id: params.id, data: { name, sport, description: description || null, structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m, tags } }, {
      onSuccess: (r) => { toast.success(isNew ? t("Treino salvo na biblioteca") : t("Alterações salvas")); if (isNew) navigate({ to: "/library/$id", params: { id: r.id }, replace: true }); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  if (!isNew && tpl.isPending) return <div className="mx-auto grid max-w-6xl gap-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink to="/library" variant="ghost" size="sm" icon={<ArrowLeft />}>{t("Biblioteca")}</ButtonLink>
        <div className="flex gap-2"><FitButton name={name} sport={sport} structure={structure} label={t(".FIT")} />
        <Button icon={<Save />} loading={save.isPending} onClick={submit}>{isNew ? t("Salvar na biblioteca") : t("Salvar alterações")}</Button></div>
      </div>
      <div className="grid gap-4">
        <Field label={t("Nome do treino")} error={err?.fieldError("name")}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Intervalado 6×1 km")} invalid={!!err?.fieldError("name")} className="h-12 font-display text-[22px] font-bold [font-stretch:108%]" autoFocus={isNew} />}
        </Field>
        <div className="grid items-end gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          <SportPicker value={sport} onChange={(s) => { setSport(s); if (s === "strength" || sport === "strength") setStructure({ v: 1, blocks: [] }); }} allowed={club.modalities} />
          <Field label={t("Tags")} optional hint={t("Para achar o treino na biblioteca. Também vale #tag na escrita rápida.")} error={err?.fieldError("tags")}>
            {(id, d) => <TagInput id={id} describedBy={d} value={tags} onChange={setTags} suggestions={known} />}
          </Field>
        </div>
        {err?.fieldError("structure") && <p className="rf-text-body-sm text-danger-text">{err.fieldError("structure")}</p>}
      </div>
      {club && <AiDescribe clubId={club.id} sport={sport} onResult={(w) => { setStructure(w.structure); if (!name.trim()) setName(w.name); }} />}
      <WorkoutBuilder sport={sport} structure={structure} onChange={setStructure} onTags={(x) => setTags((cur) => cleanTags([...cur, ...x]))} />
      <Field label={t("Descrição para o aluno")} optional hint={t("Aparece no app do aluno junto do treino.")}>
        {(id, d) => <Textarea id={id} aria-describedby={d} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Ex.: foco em manter o pace constante nos tiros.")} />}
      </Field>
    </div>
  );
}

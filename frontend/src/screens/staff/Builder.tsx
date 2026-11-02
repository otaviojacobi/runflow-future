/** W5 · Construtor de treino (library template). Routes: /library/new, /library/$id */
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useSaveTemplate, useTemplate } from "@/api/library";
import type { Sport } from "@/api/types";
import { AiDescribe } from "@/components/AiAssist";
import { FitButton } from "@/components/FitExport";
import { SportPicker, WorkoutBuilder } from "@/components/builder/WorkoutBuilder";
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
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    if (tpl.data && tpl.data.id !== loadedId) {
      setName(tpl.data.name); setSport(tpl.data.sport); setDescription(tpl.data.description ?? ""); setStructure(tpl.data.structure); setLoadedId(tpl.data.id);
    }
  }, [tpl.data, loadedId]);
  if (!club) return null;
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = () => {
    const est = estimate(structure, sport);
    save.mutate({ id: params.id, data: { name, sport, description: description || null, structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m, tags: [] } }, {
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SportPicker value={sport} onChange={(s) => { setSport(s); if (s === "strength" || sport === "strength") setStructure({ v: 1, blocks: [] }); }} allowed={club.modalities} />
        </div>
        {err?.fieldError("structure") && <p className="rf-text-body-sm text-danger-text">{err.fieldError("structure")}</p>}
      </div>
      {club && <AiDescribe clubId={club.id} sport={sport} onResult={(w) => { setStructure(w.structure); if (!name.trim()) setName(w.name); }} />}
      <WorkoutBuilder sport={sport} structure={structure} onChange={setStructure} />
      <Field label={t("Descrição para o aluno")} optional hint={t("Aparece no app do aluno junto do treino.")}>
        {(id, d) => <Textarea id={id} aria-describedby={d} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Ex.: foco em manter o pace constante nos tiros.")} />}
      </Field>
    </div>
  );
}

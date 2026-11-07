/** M5 · Feedback sheet: did it? effort (PSE), feeling, comment, activity link; once done, "Desfazer conclusão" (D-060),
 * confirmed in place (what goes and what stays) before the workout goes back to not done. */
import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSaveCompletion, useUndoCompletion } from "@/api/my";
import type { Activity, CompletionStatus, Feeling, PlannedWorkout } from "@/api/types";
import { t } from "@/i18n";
import { distance, duration, timeOf } from "@/lib/format";
import { Button, Dialog, Field, Segmented, Textarea, cn, toast } from "@/ui";

const FEELINGS: { v: Feeling; e: string; l: string }[] = [
  { v: "great", e: "😄", l: "Ótimo" }, { v: "good", e: "🙂", l: "Bem" }, { v: "ok", e: "😐", l: "Normal" }, { v: "bad", e: "😮‍💨", l: "Cansado" }, { v: "awful", e: "😣", l: "Muito mal" },
];
const RPE_LABEL = ["", "Muito leve", "Muito leve", "Leve", "Leve", "Moderado", "Moderado", "Difícil", "Muito difícil", "Quase máximo", "Máximo"];

export function FeedbackDialog({ clubId, workout, activities = [], open, onOpenChange }: { clubId: string; workout: PlannedWorkout; activities?: Activity[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const c = workout.completion;
  const [status, setStatus] = useState<CompletionStatus>(c?.status ?? "completed");
  const [rpe, setRpe] = useState(c?.rpe ?? 6);
  const [feeling, setFeeling] = useState<Feeling | null>(c?.feeling ?? null);
  const [comment, setComment] = useState(c?.comment ?? "");
  const [activityId, setActivityId] = useState<string | null>(c?.activity_id ?? null);
  const save = useSaveCompletion(clubId);
  const undo = useUndoCompletion(clubId);
  const [undoing, setUndoing] = useState(false);
  useEffect(() => { if (open) { setUndoing(false); setStatus(c?.status ?? "completed"); setRpe(c?.rpe ?? 6); setFeeling(c?.feeling ?? null); setComment(c?.comment ?? ""); setActivityId(c?.activity_id ?? null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const did = status === "completed" || status === "partial";
  const submit = () =>
    save.mutate({ id: workout.id, status, rpe: did ? rpe : null, feeling: did ? feeling : null, comment, activity_id: did ? activityId : null }, {
      onSuccess: () => { toast.success(did ? t("Treino registrado. Boa!") : t("Tudo bem, registramos."), t("Seu treinador foi avisado.")); onOpenChange(false); },
      onError: toast.error,
    });
  if (undoing) {
    const linked = c?.activity_id ? activities.find((a) => a.id === c.activity_id) : null;
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title={t("Desfazer conclusão?")} description={workout.title}
        footer={<>
          <Button variant="ghost" onClick={() => setUndoing(false)}>{t("Voltar")}</Button>
          <Button variant="danger" loading={undo.isPending} onClick={() => undo.mutate(workout.id, { onSuccess: () => { toast.success(t("Conclusão desfeita")); onOpenChange(false); }, onError: toast.error })}>{t("Desfazer")}</Button>
        </>}>
        <p className="text-fg-muted">
          {t("O treino volta a ficar como não feito, e o que você registrou (esforço, sensação e comentário) é apagado. A conversa com o treinador continua.")}
          {c?.activity_id ? " " + (linked ? t("A atividade “{x}” continua na sua lista, sem treino ligado.", { x: linked.name }) : t("A atividade ligada continua na sua lista, sem treino ligado.")) : ""}
        </p>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Como foi o treino?")} description={workout.title}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button size="lg" onClick={submit} loading={save.isPending}>{t("Salvar")}</Button></>}>
      <div className="grid gap-5">
        <Segmented label={t("Você fez o treino?")} value={status === "skipped" ? "missed" : status} onChange={(v) => setStatus(v as CompletionStatus)} className="w-full"
          options={[{ value: "completed", label: t("Fiz tudo") }, { value: "partial", label: t("Fiz parte") }, { value: "missed", label: t("Não fiz") }]} />
        {did && (
          <>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between"><span className="rf-text-label-sm">{t("Esforço percebido (PSE)")}</span><span className="text-sm font-semibold"><span className="font-display text-xl tabular-nums">{rpe}</span>/10 · {t(RPE_LABEL[rpe]!)}</span></div>
              <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} aria-label={t("Esforço percebido de 1 a 10")} className="w-full accent-brand" />
              <div className="flex justify-between text-xs text-fg-muted"><span>{t("Leve")}</span><span>{t("Máximo")}</span></div>
            </div>
            <fieldset className="grid gap-2"><legend className="mb-2 rf-text-label-sm">{t("Como você se sentiu?")}</legend>
              <div className="grid grid-cols-5 gap-1.5">
                {FEELINGS.map((f) => (
                  <button key={f.v} type="button" aria-pressed={feeling === f.v} onClick={() => setFeeling(f.v)}
                    className={cn("grid h-16 place-items-center rounded-lg border text-[11px] font-semibold transition-colors", feeling === f.v ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
                    <span className="text-2xl leading-none" aria-hidden>{f.e}</span>{t(f.l)}
                  </button>
                ))}
              </div>
            </fieldset>
            {activities.length > 0 && (
              <fieldset className="grid gap-1.5"><legend className="mb-2 rf-text-label-sm">{t("Atividade deste treino")}</legend>
                {activities.map((a) => (
                  <label key={a.id} className={cn("flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2", activityId === a.id ? "border-brand-ring bg-brand-soft" : "border-line")}>
                    <input type="radio" name="act" className="accent-brand" checked={activityId === a.id} onChange={() => setActivityId(a.id)} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.name}</span><span className="text-xs text-fg-muted">{timeOf(a.started_at)} · {[a.distance_m && distance(a.distance_m), duration(a.duration_s)].filter(Boolean).join(" · ")} · {a.source === "strava" ? "Strava" : t("manual")}</span></span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        <Field label={did ? t("Quer contar algo ao treinador?") : t("O que aconteceu?")} optional>
          {(id) => <Textarea id={id} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={did ? t("Ex.: senti a panturrilha no final") : t("Ex.: plantão no trabalho, compenso amanhã")} />}
        </Field>
        {/* Marked done by mistake: back to not done (D-060), after a confirmation. */}
        {c && <Button variant="ghost" size="sm" icon={<Undo2 />} className="w-fit text-danger-text" onClick={() => setUndoing(true)}>{t("Desfazer conclusão")}</Button>}
      </div>
    </Dialog>
  );
}

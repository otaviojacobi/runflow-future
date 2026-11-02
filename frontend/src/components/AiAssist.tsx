/** "Descrever com IA" for the builder: a sentence → structure. */
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { type AiWorkout, useAiFeedbackSummary, useAiWorkout } from "@/api/ai";
import type { Sport } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { Button, Card, Textarea, cn, toast } from "@/ui";

const EXAMPLES: Partial<Record<Sport, string>> = {
  run: "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento",
  swim: "10x100 metros com 20 s de descanso",
  strength: "agachamento 4x10 com 40 kg, remada curvada 3x12 e prancha 3x30",
};

export function AiDescribe({ clubId, sport, onResult }: { clubId: string; sport: Sport; onResult: (w: AiWorkout) => void }) {
  const ai = useAiWorkout(clubId);
  const [text, setText] = useState("");
  const err = ai.error instanceof ApiError ? ai.error : null;
  const go = () => ai.mutate({ text, sport }, { onSuccess: (w) => { onResult(w); toast.success(t("Treino montado"), t("Confira as etapas e ajuste o que precisar.")); }, onError: (e) => { if (!(e instanceof ApiError && e.status === 422)) toast.error(e); } });
  return (
    <Card edge="brand" className="grid gap-3 p-4">
      <div className="flex items-center gap-2"><Sparkles className="size-5 text-accent-text" /><h2 className="rf-text-title-sm">{t("Descrever com IA")}</h2><span className="text-xs text-fg-muted">{t("Escreva do seu jeito; a gente monta as etapas.")}</span></div>
      <Textarea aria-label={t("Descrição do treino")} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[sport] ?? EXAMPLES.run}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length > 4) { e.preventDefault(); go(); } }} />
      {err?.status === 422 && <p role="alert" className="text-sm text-danger-text">{err.title}. {err.detail}</p>}
      <div className="flex justify-end"><Button size="sm" icon={<Sparkles />} loading={ai.isPending} disabled={text.trim().length < 5} onClick={go}>{t("Montar treino")}</Button></div>
    </Card>
  );
}

/** Weekly feedback summary card (W8 + W17). Generated on demand. */
export function AiFeedbackSummaryCard({ clubId }: { clubId: string }) {
  const ai = useAiFeedbackSummary(clubId);
  const r = ai.data;
  const tone = { danger: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;
  return (
    <Card edge="brand" className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-5 text-accent-text" /><h2 className="rf-text-title-sm">{t("Resumo da semana")}</h2>
        <span className="text-xs text-fg-muted">{t("Esforço, constância e comentários que pedem atenção.")}</span>
        <Button size="sm" variant={r ? "ghost" : "secondary"} className="ml-auto" loading={ai.isPending} onClick={() => ai.mutate({}, { onError: toast.error })}>{r ? t("Atualizar") : t("Gerar resumo")}</Button>
      </div>
      {r && (
        <div className="grid gap-3">
          <ul className="grid gap-1 text-sm">{r.summary.map((s) => <li key={s}>{s}</li>)}</ul>
          {r.highlights.length > 0 && (
            <ul className="grid gap-1.5 border-t border-line-subtle pt-3">
              {r.highlights.map((x, i) => (
                <li key={i}><Link to="/students/$id" params={{ id: x.membership_id }} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-soft"><span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone[x.severity])} /><span>{x.text}</span></Link></li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-subtle">{t("Gerado automaticamente a partir dos registros dos alunos. Confira antes de agir.")}</p>
        </div>
      )}
    </Card>
  );
}

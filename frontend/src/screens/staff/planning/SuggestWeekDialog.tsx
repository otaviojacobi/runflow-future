/** W4 + W17: suggested week for one student (assistant), pick items and assign. */
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useAiWeekPlan } from "@/api/ai";
import type { AthleteSummary, Club } from "@/api/types";
import { useAssign } from "@/api/workouts";
import { sportBar } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { duration, shortDate } from "@/lib/format";
import { Button, Dialog, Skeleton, cn, toast } from "@/ui";

export function SuggestWeekDialog({ club, athlete, monday, onClose }: { club: Club; athlete: AthleteSummary | null; monday: string; onClose: () => void }) {
  return (
    <Dialog open={!!athlete} onOpenChange={(v) => !v && onClose()} size="lg" title={t("Sugestão de semana")} description={athlete ? t("{name} · semana de {d}", { name: athlete.user.name, d: shortDate(monday) }) : undefined}>
      {athlete && <Body club={club} athlete={athlete} monday={monday} onClose={onClose} key={athlete.membership.id + monday} />}
    </Dialog>
  );
}

function Body({ club, athlete, monday, onClose }: { club: Club; athlete: AthleteSummary; monday: string; onClose: () => void }) {
  const ai = useAiWeekPlan(club.id);
  const assign = useAssign(club.id);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => { ai.mutate({ membership_id: athlete.membership.id, week_start: monday }, { onSuccess: (r) => setPicked(new Set(r.items.map((_, i) => i))) }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = ai.data;
  const apply = async () => {
    if (!plan) return;
    try {
      for (const [i, it] of plan.items.entries()) if (picked.has(i)) await assign.mutateAsync({ athlete_ids: [athlete.membership.id], dates: [it.date], sport: it.sport, title: it.title, structure: it.structure, est_duration_s: it.est_duration_s, est_distance_m: it.est_distance_m, notes: null });
      toast.success(tn(picked.size, "{n} treino adicionado", "{n} treinos adicionados"), t("{name} já vê a semana no app.", { name: athlete.user.name.split(" ")[0] }));
      onClose();
    } catch (e) { toast.error(e); }
  };
  if (ai.isPending || (!plan && !ai.error)) return <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (ai.error) return <p role="alert" className="text-sm text-danger-text">{ai.error instanceof ApiError ? `${ai.error.title}. ${ai.error.detail}` : t("Algo deu errado")}</p>;
  return (
    <div className="grid gap-4">
      <ul className="grid gap-1 rounded-lg bg-sunken p-3 text-sm">{plan!.rationale.map((r) => <li key={r} className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-accent-text" />{r}</li>)}</ul>
      {plan!.items.length === 0 ? <p className="text-fg-muted">{t("A semana já está completa.")}</p> : (
        <ul className="grid gap-2">
          {plan!.items.map((it, i) => {
            const on = picked.has(i);
            return (
              <li key={it.date}>
                <button type="button" aria-pressed={on} onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                  className={cn("relative grid w-full gap-2 overflow-hidden rounded-lg border p-3 pl-4 text-left", on ? "border-brand-ring bg-surface" : "border-line bg-sunken opacity-70")}>
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", sportBar[it.sport])} />
                  <span className="flex items-center gap-3">
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", on ? "border-brand bg-brand text-on-brand" : "border-line-strong")}>{on && <Check className="size-4" />}</span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold uppercase text-fg-muted">{shortDate(it.date)}</span><span className="block font-semibold">{it.title}</span></span>
                    {it.est_duration_s ? <span className="text-sm text-fg-muted tabular-nums">≈ {duration(it.est_duration_s)}</span> : null}
                  </span>
                  <IntensityProfile structure={it.structure} sport={it.sport} height={28} />
                  <span className="text-sm text-fg-muted">{it.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-fg-muted">{t("Sugestão automática. Revise antes de enviar; você pode editar cada treino depois no planejamento.")}</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button icon={<Check />} disabled={!picked.size} loading={assign.isPending} onClick={apply}>{picked.size ? tn(picked.size, "Adicionar {n} treino", "Adicionar {n} treinos") : t("Escolha os treinos")}</Button></div>
    </div>
  );
}

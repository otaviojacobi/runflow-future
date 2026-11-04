/** W7 · Planilha editor: weeks × days, apply to students, assignments. Route: /plans/$id */
import { useParams } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, Eraser, Plus, Save, Send, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAthletes, useGroups } from "@/api/members";
import { useAssignPlan, usePlan, useSavePlanItems, useUnassignPlan, useUpdatePlan } from "@/api/plans";
import type { PlanItem } from "@/api/types";
import { WorkoutPicker, type WorkoutDraft } from "@/components/builder/WorkoutPicker";
import { sportBar, sportSoft } from "@/components/sport";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, duration, mondayOf, today as todayFn } from "@/lib/format";
import { Avatar, Button, ButtonLink, Card, DateInput, Dialog, Field, IconButton, ProgressBar, Skeleton, Textarea, cn, toast } from "@/ui";

const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
let seq = 0;

export function PlanEditorScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { club } = useClub();
  const q = usePlan(club?.id, id);
  const saveItems = useSavePlanItems(club?.id ?? "", id);
  const update = useUpdatePlan(club?.id ?? "", id);
  const unassign = useUnassignPlan(club?.id ?? "", id);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [cell, setCell] = useState<{ week: number; weekday: number; item?: PlanItem } | null>(null);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [notes, setNotes] = useState("");
  const [apply, setApply] = useState(false);
  useEffect(() => { if (q.data && !dirty) { setItems(q.data.items); setName(q.data.name); } }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = q.data?.weeks ?? 0;
  const byCell = useMemo(() => { const m = new Map<string, PlanItem[]>(); for (const i of items) m.set(`${i.week}-${i.weekday}`, [...(m.get(`${i.week}-${i.weekday}`) ?? []), i]); return m; }, [items]);
  if (!club) return null;
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-6xl" />;
  if (!q.data) return <p className="text-fg-muted">{t("Planilha não encontrada.")}</p>;
  const change = (next: PlanItem[]) => { setItems(next); setDirty(true); };
  const weekTotal = (w: number) => items.filter((i) => i.week === w).reduce((s, i) => s + (i.est_duration_s ?? 0), 0);
  const save = () => saveItems.mutate(items, { onSuccess: (r) => { setItems(r.items); setDirty(false); toast.success(t("Planilha salva")); }, onError: toast.error });
  const openCell = (week: number, weekday: number, item?: PlanItem) => { setCell({ week, weekday, item }); setDraft(item ? { ...item } : null); setNotes(item?.notes ?? ""); };
  const commitCell = () => {
    if (!cell || !draft) return;
    const next: PlanItem = { id: cell.item?.id ?? `new-${++seq}`, week: cell.week, weekday: cell.weekday, template_id: draft.template_id, sport: draft.sport, title: draft.title, structure: draft.structure, est_duration_s: draft.est_duration_s, est_distance_m: draft.est_distance_m, notes: notes || null };
    change(cell.item ? items.map((i) => (i.id === cell.item!.id ? next : i)) : [...items, next]);
    setCell(null);
  };
  const dupWeek = (w: number) => {
    if (w >= weeks) return toast.info(t("Esta é a última semana"), t("Aumente a duração para copiar."));
    change([...items.filter((i) => i.week !== w + 1), ...items.filter((i) => i.week === w).map((i) => ({ ...i, id: `new-${++seq}`, week: w + 1 }))]);
  };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <ButtonLink to="/plans" variant="ghost" size="sm" icon={<ArrowLeft />} className="w-fit">{t("Planilhas")}</ButtonLink>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <input aria-label={t("Nome da planilha")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== q.data!.name && update.mutate({ name })} className="rounded-md bg-transparent px-1 font-display text-[28px] font-bold leading-tight [font-stretch:108%] hover:bg-soft focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-ring" />
          <div className="flex items-center gap-2 px-1 text-sm text-fg-muted">
            {tn(items.length, "{n} treino", "{n} treinos")} ·
            <label className="flex items-center gap-1">{t("Semanas")}<input type="number" min={1} max={52} aria-label={t("Número de semanas")} defaultValue={weeks} onBlur={(e) => { const w = Number(e.target.value); if (w !== weeks && w >= 1 && w <= 52) update.mutate({ weeks: w }, { onSuccess: () => { setDirty(false); q.refetch(); } }); }} className="h-7 w-14 rounded-md border border-line-strong bg-surface px-1.5 text-center" /></label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Save />} disabled={!dirty} loading={saveItems.isPending} onClick={save}>{dirty ? t("Salvar alterações") : t("Salvo")}</Button>
          <Button icon={<Send />} disabled={dirty || !items.length} onClick={() => setApply(true)}>{t("Aplicar a alunos")}</Button>
        </div>
      </div>

      <Card className="relative min-w-0 overflow-x-auto">
        <div className="grid min-w-[1000px]" style={{ gridTemplateColumns: "96px repeat(7, minmax(110px, 1fr)) 100px" }}>
          <div className="border-b border-line bg-sunken px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">{t("Semana")}</div>
          {WD.map((d) => <div key={d} className="border-b border-l border-line-subtle bg-sunken py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">{t(d)}</div>)}
          <div className="border-b border-l border-line-subtle bg-sunken py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">{t("Volume")}</div>
          {Array.from({ length: weeks }, (_, wi) => wi + 1).map((w) => [
            <div key={`h${w}`} className="group/w flex flex-col justify-center gap-1 border-b border-line-subtle px-3 py-2">
              <span className="font-display text-lg font-bold tabular-nums">S{w}</span>
              <span className="flex gap-0.5 opacity-60 group-hover/w:opacity-100"><IconButton size="sm" label={t("Copiar para a semana seguinte")} onClick={() => dupWeek(w)}><Copy /></IconButton><IconButton size="sm" label={t("Limpar semana")} onClick={() => change(items.filter((i) => i.week !== w))}><Eraser /></IconButton></span>
            </div>,
            ...Array.from({ length: 7 }, (_, d) => {
              const list = byCell.get(`${w}-${d + 1}`) ?? [];
              return (
                <div key={`${w}-${d}`} className="group/c flex min-h-[64px] flex-col gap-1 border-b border-l border-line-subtle p-1.5">
                  {list.map((i) => (
                    <button key={i.id} onClick={() => openCell(w, d + 1, i)} className={cn("relative overflow-hidden rounded-[8px] py-1.5 pl-2.5 pr-1.5 text-left text-[11.5px] font-semibold leading-tight hover:shadow-md", sportSoft[i.sport])} title={i.title}>
                      <span className={cn("absolute inset-y-0 left-0 w-[3px]", sportBar[i.sport])} /><span className="line-clamp-2">{i.title}</span>
                    </button>
                  ))}
                  <button onClick={() => openCell(w, d + 1)} aria-label={t("Adicionar treino na semana {w}, {d}", { w, d: t(WD[d]!) })} className={cn("grid h-7 place-items-center rounded-md text-fg-subtle opacity-0 hover:bg-soft hover:text-fg focus-visible:opacity-100 group-hover/c:opacity-100", !list.length && "flex-1")}><Plus className="size-4" /></button>
                </div>
              );
            }),
            <div key={`v${w}`} className="flex items-center justify-center border-b border-l border-line-subtle text-sm font-semibold tabular-nums text-fg-muted">{weekTotal(w) ? duration(weekTotal(w)) : "–"}</div>,
          ])}
        </div>
      </Card>

      <Card className="grid gap-3 p-5">
        <h2 className="flex items-center gap-2 rf-text-title-md"><Users className="size-5" />{t("Quem está usando")}</h2>
        {q.data.assignments.length === 0 ? <p className="text-fg-muted">{t("Ninguém ainda. Use “Aplicar a alunos”.")}</p> : (
          <ul className="divide-y divide-line-subtle">
            {q.data.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar name={a.athlete.user.name} size={32} />
                <div className="min-w-40 flex-1"><div className="font-semibold">{a.athlete.user.name}</div><div className="text-xs text-fg-muted">{t("Começou em {d}", { d: dayMonth(a.start_date) })} · {t("termina em {d}", { d: dayMonth(addDays(a.start_date, weeks * 7 - 1)) })}</div></div>
                <div className="w-40"><div className="mb-1 text-xs text-fg-muted tabular-nums">{a.done}/{a.workouts} {t("feitos")}</div><ProgressBar value={a.done} max={Math.max(1, a.workouts)} /></div>
                <IconButton label={t("Remover aplicação")} onClick={() => unassign.mutate(a.id, { onSuccess: (r) => toast.success(t("Aplicação removida"), tn(r?.removed_workouts ?? 0, "{n} treino futuro saiu da agenda.", "{n} treinos futuros saíram da agenda.")) })}><Trash2 /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={!!cell} onOpenChange={(v) => !v && setCell(null)} size="lg" title={cell ? t("Semana {w} · {d}", { w: cell.week, d: t(WD[cell.weekday - 1]!) }) : ""}
        footer={<>{cell?.item && <Button variant="ghost" icon={<Trash2 />} className="mr-auto" onClick={() => { change(items.filter((i) => i.id !== cell.item!.id)); setCell(null); }}>{t("Remover")}</Button>}<Button variant="secondary" onClick={() => setCell(null)}>{t("Cancelar")}</Button><Button icon={<Check />} disabled={!draft} onClick={commitCell}>{cell?.item ? t("Atualizar") : t("Adicionar")}</Button></>}>
        {cell && <div className="grid gap-4"><WorkoutPicker key={`${cell.week}-${cell.weekday}-${cell.item?.id ?? "new"}`} club={club} initial={cell.item ? { ...cell.item } : null} onChange={setDraft} /><Field label={t("Recado")} optional>{(fid) => <Textarea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />}</Field></div>}
      </Dialog>
      <ApplyDialog clubId={club.id} planId={id} weeks={weeks} open={apply} onOpenChange={setApply} />
    </div>
  );
}

function ApplyDialog({ clubId, planId, weeks, open, onOpenChange }: { clubId: string; planId: string; weeks: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const athletes = useAthletes(open ? clubId : undefined);
  const groups = useGroups(clubId);
  const assign = useAssignPlan(clubId, planId);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const nextMonday = addDays(mondayOf(todayFn()), 7);
  const [start, setStart] = useState(nextMonday);
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Aplicar planilha")} description={t("Os treinos entram na agenda dos alunos a partir da data escolhida.")}
      footer={<><span className="mr-auto self-center text-sm text-fg-muted">{sel.size ? t("{n} alunos · até {d}", { n: sel.size, d: dayMonth(addDays(start, weeks * 7 - 1)) }) : ""}</span><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button disabled={!sel.size} loading={assign.isPending} onClick={() => assign.mutate({ athlete_ids: [...sel], start_date: start }, { onSuccess: (r) => { toast.success(tn(r.workouts, "{n} treino criado", "{n} treinos criados"), tn(r.assignments, "Para {n} aluno.", "Para {n} alunos.")); onOpenChange(false); setSel(new Set()); }, onError: toast.error })}>{t("Aplicar")}</Button></>}>
      <div className="grid gap-4">
        <Field label={t("Começa na segunda-feira")} hint={t("Semana 1 começa nesta data.")}>{(id, d) => <DateInput id={id} aria-describedby={d} value={start} onChange={(v) => v && setStart(mondayOf(v))} />}</Field>
        <div className="flex flex-wrap gap-1.5">{(groups.data ?? []).map((g) => <button key={g.id} type="button" onClick={() => { const n = new Set(sel); g.member_ids.forEach((x) => n.add(x)); setSel(n); }} className="h-7 rounded-full border border-line px-2.5 text-xs font-semibold text-fg-muted hover:bg-soft">+ {g.name}</button>)}</div>
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">{(athletes.data ?? []).map((a) => (
          <li key={a.membership.id}><label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-soft"><input type="checkbox" className="size-[18px] accent-brand" checked={sel.has(a.membership.id)} onChange={() => toggle(a.membership.id)} /><Avatar name={a.user.name} size={26} /><span className="text-sm font-medium">{a.user.name}</span></label></li>
        ))}</ul>
      </div>
    </Dialog>
  );
}

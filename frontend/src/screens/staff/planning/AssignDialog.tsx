/** Assign a workout (from the library or built on the spot) to students/groups on one or more days. */
import { Check, Library, Search, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTemplates } from "@/api/library";
import { useAthletes, useGroups } from "@/api/members";
import type { Club, Sport } from "@/api/types";
import { useAssign, type AssignInput } from "@/api/workouts";
import { SportPicker, WorkoutBuilder, WorkoutSummary } from "@/components/builder/WorkoutBuilder";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import { estimate, type Structure } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { addDays, duration, weekdayShort } from "@/lib/format";
import { Avatar, Button, Dialog, Field, Input, Segmented, Textarea, cn, toast } from "@/ui";

export interface AssignPrefill { athleteIds?: string[]; dates?: string[] }

export function AssignDialog({ club, monday, open, onOpenChange, prefill }: { club: Club; monday: string; open: boolean; onOpenChange: (v: boolean) => void; prefill?: AssignPrefill }) {
  return open ? <AssignBody club={club} monday={monday} onClose={() => onOpenChange(false)} prefill={prefill} /> : null;
}

function AssignBody({ club, monday, onClose, prefill }: { club: Club; monday: string; onClose: () => void; prefill?: AssignPrefill }) {
  const [source, setSource] = useState<"library" | "build">("library");
  const [q, setQ] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<Sport>(club.modalities[0] ?? "run");
  const [structure, setStructure] = useState<Structure>({ v: 1, blocks: [] });
  const [athletes, setAthletes] = useState<Set<string>>(new Set(prefill?.athleteIds ?? []));
  const [dates, setDates] = useState<Set<string>>(new Set(prefill?.dates ?? []));
  const [extraDate, setExtraDate] = useState("");
  const [notes, setNotes] = useState("");
  const [who, setWho] = useState("");
  const templates = useTemplates(club.id);
  const list = useAthletes(club.id);
  const groups = useGroups(club.id);
  const assign = useAssign(club.id);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const tpls = useMemo(() => (templates.data ?? []).filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase())), [templates.data, q]);
  const people = (list.data ?? []).filter((a) => !who || a.user.name.toLowerCase().includes(who.toLowerCase()));
  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const err = assign.error instanceof ApiError ? assign.error : null;
  const count = athletes.size * dates.size;
  const ready = count > 0 && (source === "library" ? !!templateId : !!title.trim() && structure.blocks.length > 0);

  const submit = () => {
    const base = { athlete_ids: [...athletes], dates: [...dates].sort(), notes: notes || null };
    const est = estimate(structure, sport);
    const v: AssignInput = source === "library" ? { ...base, template_id: templateId! } : { ...base, sport, title, structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m };
    assign.mutate(v, {
      onSuccess: (r) => { toast.success(tn(r.items.length, "{n} treino atribuído", "{n} treinos atribuídos"), t("Os alunos já veem na agenda.")); onClose(); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} size="xl" title={t("Atribuir treino")}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-fg-muted">{count ? tn(count, "{n} treino será criado", "{n} treinos serão criados") : t("Escolha alunos e dias")}</span>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{t("Cancelar")}</Button><Button onClick={submit} loading={assign.isPending} disabled={!ready}>{t("Atribuir")}</Button></div>
      </div>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="grid min-w-0 content-start gap-3">
          <Segmented label={t("Origem do treino")} value={source} onChange={setSource} options={[{ value: "library", label: t("Da biblioteca"), icon: <Library /> }, { value: "build", label: t("Montar agora"), icon: <Wand2 /> }]} />
          {source === "library" ? (
            <>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar na biblioteca")} placeholder={t("Buscar na biblioteca")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
              <ul className="grid max-h-[46vh] gap-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label={t("Treinos da biblioteca")}>
                {tpls.map((w) => (
                  <li key={w.id}>
                    <button type="button" role="radio" aria-checked={templateId === w.id} onClick={() => setTemplateId(w.id)}
                      className={cn("grid w-full gap-2 rounded-md border p-3 text-left transition-colors", templateId === w.id ? "border-brand-ring bg-brand-soft" : "border-line bg-surface hover:bg-soft")}>
                      <span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><SportChip sport={w.sport} size="sm" /><span className="truncate font-semibold">{w.name}</span></span><span className="shrink-0 text-xs text-fg-muted">{w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : ""}</span></span>
                      <IntensityProfile structure={w.structure} sport={w.sport} height={22} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="grid gap-3">
              <Field label={t("Nome do treino")} error={err?.fieldError("title")}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Ex.: Regenerativo 30′")} invalid={!!err?.fieldError("title")} />}</Field>
              <SportPicker value={sport} onChange={(s) => { setSport(s); setStructure({ v: 1, blocks: [] }); }} allowed={club.modalities} />
              <WorkoutBuilder compact sport={sport} structure={structure} onChange={setStructure} />
              {structure.blocks.length > 0 && <WorkoutSummary structure={structure} sport={sport} />}
            </div>
          )}
        </section>
        <section className="grid content-start gap-5">
          <fieldset className="grid gap-2">
            <legend className="mb-2 rf-text-label-sm">{t("Quando")} {err?.fieldError("dates") && <span className="font-normal text-danger-text">· {err.fieldError("dates")}</span>}</legend>
            <div className="grid grid-cols-7 gap-1">
              {week.map((d) => (
                <button key={d} type="button" aria-pressed={dates.has(d)} onClick={() => setDates(toggle(dates, d))}
                  className={cn("grid h-14 place-items-center rounded-md border text-xs font-semibold transition-colors", dates.has(d) ? "border-brand-edge bg-brand text-on-brand" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
                  <span>{weekdayShort(d)}</span><span className="text-base font-bold tabular-nums">{Number(d.slice(8))}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Input type="date" aria-label={t("Outra data")} value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className="h-9 w-44" />
              <Button size="sm" variant="secondary" disabled={!extraDate} onClick={() => { setDates(toggle(dates, extraDate)); setExtraDate(""); }}>{t("Adicionar data")}</Button>
            </div>
            {[...dates].filter((d) => !week.includes(d)).length > 0 && <p className="text-xs text-fg-muted">{t("Também em: {d}", { d: [...dates].filter((d) => !week.includes(d)).sort().map((d) => d.split("-").reverse().slice(0, 2).join("/")).join(", ") })}</p>}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2 flex w-full items-center justify-between rf-text-label-sm"><span>{t("Para quem")} · {athletes.size}</span>
              <button type="button" className="text-xs font-semibold text-brand-text hover:underline" onClick={() => setAthletes(athletes.size === (list.data?.length ?? 0) ? new Set() : new Set((list.data ?? []).map((a) => a.membership.id)))}>{athletes.size === (list.data?.length ?? 0) && athletes.size > 0 ? t("Limpar") : t("Todos")}</button>
            </legend>
            {(groups.data ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(groups.data ?? []).map((g) => {
                  const on = g.member_ids.length > 0 && g.member_ids.every((id) => athletes.has(id));
                  return <button key={g.id} type="button" aria-pressed={on} onClick={() => { const n = new Set(athletes); g.member_ids.forEach((id) => (on ? n.delete(id) : n.add(id))); setAthletes(n); }}
                    className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line text-fg-muted hover:bg-soft")}>{on && <Check className="size-3.5" />}{g.name}</button>;
                })}
              </div>
            )}
            <Input aria-label={t("Buscar aluno")} placeholder={t("Buscar aluno")} value={who} onChange={(e) => setWho(e.target.value)} className="h-9" />
            <ul className="grid max-h-56 gap-0.5 overflow-y-auto">
              {people.map((a) => (
                <li key={a.membership.id}><label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-soft">
                  <input type="checkbox" className="size-[18px] accent-brand" checked={athletes.has(a.membership.id)} onChange={() => setAthletes(toggle(athletes, a.membership.id))} />
                  <Avatar name={a.user.name} size={26} /><span className="text-sm font-medium">{a.user.name}</span>
                </label></li>
              ))}
            </ul>
            {err?.fieldError("athlete_ids") && <p className="rf-text-caption text-danger-text">{err.fieldError("athlete_ids")}</p>}
          </fieldset>
          <Field label={t("Recado para os alunos")} optional>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Ex.: foco nos últimos tiros")} className="min-h-20" />}</Field>
        </section>
      </div>
    </Dialog>
  );
}

/** Planning dialogs: workout detail (with completion and activity), edit, copy week. */
import { CalendarArrowUp, Check, Copy, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Club, Feeling, Sport } from "@/api/types";
import { useCopyWeek, useDeletePlanned, usePlannedDetail, useUpdatePlanned } from "@/api/workouts";
import { SportPicker, WorkoutBuilder, WorkoutSummary } from "@/components/builder/WorkoutBuilder";
import { SportChip } from "@/components/sport";
import { IntensityProfile, Stat, StatusBadge } from "@/components/workout";
import { WorkoutSteps } from "@/components/WorkoutSteps";
import { estimate, type Structure } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { addDays, dayMonth, distance, duration, longDate, pace, timeOf } from "@/lib/format";
import { Avatar, Button, Dialog, Field, Input, Select, Skeleton, Textarea, toast } from "@/ui";

export const FEELING: Record<Feeling, string> = { great: "Ótimo", good: "Bem", ok: "Normal", bad: "Cansado", awful: "Muito mal" };

export function DetailDialog({ club, id, onClose, onEdit }: { club: Club; id: string | null; onClose: () => void; onEdit: (id: string) => void }) {
  const d = usePlannedDetail(club.id, id);
  const update = useUpdatePlanned(club.id);
  const del = useDeletePlanned(club.id);
  const [confirm, setConfirm] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  useEffect(() => { setConfirm(false); setMoveTo(""); }, [id]);
  const w = d.data;
  const c = w?.completion;
  const a = w?.activity;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} size="lg" title={w?.title ?? t("Treino")}
      description={w ? `${w.athlete.user.name} · ${longDate(w.date)}` : undefined}
      footer={w && (confirm ? (
        <><span className="mr-auto self-center text-sm text-fg-muted">{t("Remover este treino da agenda do aluno?")}</span><Button variant="secondary" onClick={() => setConfirm(false)}>{t("Cancelar")}</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate(w.id, { onSuccess: () => { toast.success(t("Treino removido")); onClose(); }, onError: toast.error })}>{t("Remover")}</Button></>
      ) : (
        <><Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirm(true)} className="mr-auto">{t("Remover")}</Button><Button variant="secondary" icon={<Pencil />} onClick={() => onEdit(w.id)}>{t("Editar treino")}</Button></>
      ))}>
      {!w ? <div className="grid gap-3"><Skeleton className="h-12" /><Skeleton className="h-32" /></div> : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={w.athlete.user.name} size={32} /><SportChip sport={w.sport} size="sm" />
            {c ? <StatusBadge status={c.status} /> : <StatusBadge status="planned" />}
            <span className="ml-auto text-sm text-fg-muted">{[w.est_duration_s && `≈ ${duration(w.est_duration_s)}`, w.est_distance_m && distance(w.est_distance_m, { swim: w.sport === "swim" })].filter(Boolean).join(" · ")}</span>
          </div>
          <IntensityProfile structure={w.structure} sport={w.sport} height={56} />
          <WorkoutSteps structure={w.structure} sport={w.sport} />
          {w.notes && <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-on-brand-soft"><b>{t("Recado:")}</b> {w.notes}</p>}
          {c && (
            <section className="grid gap-3 rounded-lg border border-line p-4">
              <h3 className="rf-text-title-sm">{t("Como foi")}</h3>
              <div className="flex flex-wrap gap-6">
                {c.compliance_pct != null && <Stat value={`${c.compliance_pct}%`} label={t("Cumprido")} size="sm" />}
                {c.rpe != null && <Stat value={String(c.rpe)} unit="/10" label={t("Esforço (PSE)")} size="sm" />}
                {c.feeling && <Stat value={t(FEELING[c.feeling])} label={t("Sensação")} size="sm" />}
              </div>
              {c.comment && <blockquote className="border-l-2 border-brand-line pl-3 text-sm italic text-fg-muted">“{c.comment}”</blockquote>}
            </section>
          )}
          {a && (
            <section className="grid gap-3 rounded-lg border border-line p-4">
              <h3 className="flex items-center justify-between rf-text-title-sm">{t("Atividade sincronizada")}<span className="text-xs font-normal text-fg-muted">{a.source === "strava" ? "Strava" : t("Registro manual")} · {timeOf(a.started_at)}</span></h3>
              <div className="flex flex-wrap gap-6">
                {a.distance_m && <Stat value={distance(a.distance_m).replace(/ (km|m)$/, "")} unit={a.distance_m >= 1000 ? "km" : "m"} label={t("Distância")} size="sm" />}
                <Stat value={duration(a.duration_s)} label={t("Tempo")} size="sm" />
                {a.avg_pace_s_per_km && <Stat value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace médio")} size="sm" />}
                {a.avg_hr && <Stat value={String(a.avg_hr)} unit="bpm" label={t("FC média")} size="sm" />}
              </div>
            </section>
          )}
          {w.comments_count > 0 && <p className="flex items-center gap-2 text-sm text-fg-muted"><MessageSquare className="size-4" />{tn(w.comments_count, "{n} comentário nesta conversa", "{n} comentários nesta conversa")}</p>}
          <div className="flex flex-wrap items-end gap-2 border-t border-line-subtle pt-4">
            <Field label={t("Mover para outro dia")} className="w-48">{(fid) => <Input id={fid} type="date" value={moveTo || w.date} onChange={(e) => setMoveTo(e.target.value)} className="h-9" />}</Field>
            <Button size="sm" variant="secondary" icon={<CalendarArrowUp />} disabled={!moveTo || moveTo === w.date} loading={update.isPending}
              onClick={() => update.mutate({ id: w.id, date: moveTo }, { onSuccess: () => { toast.success(t("Treino movido para {d}", { d: dayMonth(moveTo) })); onClose(); }, onError: toast.error })}>{t("Mover")}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function EditDialog({ club, id, onClose }: { club: Club; id: string | null; onClose: () => void }) {
  const d = usePlannedDetail(club.id, id);
  const update = useUpdatePlanned(club.id);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<Sport>("run");
  const [structure, setStructure] = useState<Structure>({ v: 1, blocks: [] });
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => { if (d.data && d.data.id !== loaded) { setTitle(d.data.title); setSport(d.data.sport); setStructure(d.data.structure); setNotes(d.data.notes ?? ""); setLoaded(d.data.id); } }, [d.data, loaded]);
  const save = () => {
    const est = estimate(structure, sport);
    update.mutate({ id: id!, title, sport, structure, notes: notes || null, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m }, { onSuccess: () => { toast.success(t("Treino atualizado"), t("O aluno foi avisado.")); onClose(); }, onError: toast.error });
  };
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} size="xl" title={t("Editar treino")} description={d.data ? `${d.data.athlete.user.name} · ${longDate(d.data.date)}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>{t("Cancelar")}</Button><Button loading={update.isPending} onClick={save}>{t("Salvar")}</Button></>}>
      {loaded ? (
        <div className="grid gap-4">
          <Field label={t("Nome do treino")}>{(fid) => <Input id={fid} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <SportPicker value={sport} onChange={setSport} allowed={club.modalities} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><WorkoutBuilder compact sport={sport} structure={structure} onChange={setStructure} /><WorkoutSummary structure={structure} sport={sport} className="h-fit" /></div>
          <Field label={t("Recado para o aluno")} optional>{(fid) => <Textarea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
      ) : <Skeleton className="h-64" />}
    </Dialog>
  );
}

export function CopyWeekDialog({ club, monday, athleteIds, open, onOpenChange }: { club: Club; monday: string; athleteIds: string[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const copy = useCopyWeek(club.id);
  const [weeks, setWeeks] = useState(1);
  const target = addDays(monday, weeks * 7);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title={t("Copiar semana")} description={t("Copia todos os treinos desta semana dos alunos visíveis.")}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button icon={<Copy />} loading={copy.isPending} onClick={() => copy.mutate({ from_monday: monday, to_monday: target, athlete_ids: athleteIds }, { onSuccess: (r) => { toast.success(tn(r.copied, "{n} treino copiado", "{n} treinos copiados"), t("Para a semana de {d}.", { d: dayMonth(target) })); onOpenChange(false); }, onError: toast.error })}>{t("Copiar")}</Button></>}>
      <div className="grid gap-3">
        <Field label={t("Para a semana de")}>{(fid) => <Select id={fid} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{`${dayMonth(addDays(monday, n * 7))} – ${dayMonth(addDays(monday, n * 7 + 6))}`}{n === 1 ? ` (${t("próxima")})` : ""}</option>)}</Select>}</Field>
        <p className="flex items-center gap-2 text-sm text-fg-muted"><Check className="size-4 text-success-text" />{tn(athleteIds.length, "{n} aluno", "{n} alunos")}</p>
      </div>
    </Dialog>
  );
}

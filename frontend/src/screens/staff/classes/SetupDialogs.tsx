/** W9 dialogs (Aulas, D-052): recurring schedule, one-off session, class type, venue. */
import { Archive, MapPin, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { type NewSchedule, useArchiveVenue, useClassTypes, useCreateSchedule, useCreateSession, useSaveClassType, useSaveVenue, useVenues } from "@/api/classes";
import { useMembers } from "@/api/members";
import type { ClassType, Club, Sport, Venue, VenueKind } from "@/api/types";
import { TimeInput, VENUE_KINDS, VENUE_LABEL, WEEKDAY_LONG, WEEKDAY_SHORT, validTime } from "@/components/classes";
import { SPORT_LABEL } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { today as todayFn } from "@/lib/format";
import { Button, Card, DateInput, Dialog, Field, IconButton, Input, Menu, Select, Skeleton, Textarea, cn, toast } from "@/ui";

type Open = { open: boolean; onOpenChange: (v: boolean) => void };
const apiErr = (e: unknown) => (e instanceof ApiError ? e : null);
/** The sports a class type can be: the club's modalities that have classes, first (Funcional, Musculação, Natação). */
const CLASS_SPORTS: Sport[] = ["mobility", "strength", "swim", "run", "bike", "other"];

function useStaffOptions() {
  const { club } = useClub();
  const members = useMembers(club?.id);
  return (members.data ?? []).filter((m) => m.membership.role !== "student" && m.membership.status === "active");
}

type Draft = { class_type_id: string; duration_min: number; capacity: number; location_id: string; instructor_membership_id: string };

/** Shared "what / how long / how many / where / who" fields for schedules and one-off sessions. */
function SessionFields({ v, set, types, venues, err }: { v: Draft; set: (p: Partial<Draft>) => void; types: ClassType[]; venues: Venue[]; err: ApiError | null }) {
  const staff = useStaffOptions();
  return (
    <>
      <Field label={t("Tipo de aula")} error={err?.fieldError("class_type_id")} className="sm:col-span-2">
        {(id) => (
          <Select id={id} value={v.class_type_id} onChange={(e) => { const ct = types.find((x) => x.id === e.target.value); set({ class_type_id: e.target.value, ...(ct && { duration_min: ct.duration_min, capacity: ct.default_capacity }) }); }}>
            <option value="">{t("Escolha…")}</option>
            {types.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label={t("Duração (min)")} error={err?.fieldError("duration_min")}>{(id) => <Input id={id} type="number" inputMode="numeric" min={10} max={300} step={5} value={v.duration_min} onChange={(e) => set({ duration_min: Number(e.target.value) })} />}</Field>
      <Field label={t("Vagas")} error={err?.fieldError("capacity")}>{(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={500} value={v.capacity} onChange={(e) => set({ capacity: Number(e.target.value) })} />}</Field>
      <Field label={t("Local")} optional error={err?.fieldError("location_id")}>
        {(id) => <Select id={id} value={v.location_id} onChange={(e) => set({ location_id: e.target.value })}><option value="">{t("Sem local fixo")}</option>{venues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      </Field>
      <Field label={t("Instrutor")} optional error={err?.fieldError("instructor_membership_id")}>
        {(id) => <Select key={staff.length} id={id} value={v.instructor_membership_id} onChange={(e) => set({ instructor_membership_id: e.target.value })}><option value="">{t("A definir")}</option>{staff.map((m) => <option key={m.membership.id} value={m.membership.id}>{m.user.name}</option>)}</Select>}
      </Field>
    </>
  );
}

function useSessionDraft() {
  const { ctx } = useClub();
  const [v, setV] = useState<Draft>({ class_type_id: "", duration_min: 60, capacity: 20, location_id: "", instructor_membership_id: ctx?.membership.id ?? "" });
  return [v, (p: Partial<Draft>) => setV((o) => ({ ...o, ...p }))] as const;
}

export function ScheduleDialog({ open, onOpenChange }: Open) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t("Nova grade recorrente")} description={t("Repete toda semana. As aulas das próximas 8 semanas já ficam abertas para reserva.")}>
      {open && <ScheduleBody onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}
function ScheduleBody({ onClose }: { onClose: () => void }) {
  const { club } = useClub();
  const types = useClassTypes(club?.id), venues = useVenues(club?.id);
  const create = useCreateSchedule(club?.id ?? "");
  const [v, set] = useSessionDraft();
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState("07:00");
  const err = apiErr(create.error);
  const submit = () => {
    const body: NewSchedule = { ...v, weekdays: days, start_time: time, location_id: v.location_id || null, instructor_membership_id: v.instructor_membership_id || null };
    create.mutate(body, { onSuccess: (r) => { toast.success(t("Grade criada"), tn(r.sessions, "{n} aula nas próximas 8 semanas", "{n} aulas nas próximas 8 semanas")); onClose(); } });
  };
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <SessionFields v={v} set={set} types={types.data ?? []} venues={venues.data ?? []} err={err} />
      <fieldset className="grid gap-1.5 sm:col-span-2">
        <legend className="mb-1.5 rf-text-label-sm">{t("Dias da semana")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()))}
              className={cn("relative h-11 min-w-12 rounded-md border px-3 text-sm font-semibold", days.includes(d) ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
              <span aria-hidden>{t(WEEKDAY_SHORT[d])}</span><span className="sr-only">{t(WEEKDAY_LONG[d])}</span>
            </button>
          ))}
        </div>
        {err?.fieldError("weekdays") && <p className="rf-text-caption text-danger-text">{err.fieldError("weekdays")}</p>}
      </fieldset>
      <Field label={t("Horário de início")} hint={t("24 horas, ex.: 18:30")} error={err?.fieldError("start_time")}>{(id) => <TimeInput id={id} value={time} onChange={setTime} />}</Field>
      <div className="flex items-end justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button>
        <Button type="submit" loading={create.isPending} disabled={!v.class_type_id || !days.length || !validTime(time)}>{days.length > 1 ? t("Criar {n} horários", { n: days.length }) : t("Criar grade")}</Button>
      </div>
      {err && !err.errors.length && <p role="alert" className="text-sm text-danger-text sm:col-span-2">{err.title}. {err.detail}</p>}
    </form>
  );
}

export function OneOffDialog({ open, onOpenChange, date }: Open & { date?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t("Aula avulsa")} description={t("Uma aula em uma data só: aulão, treino especial, reposição.")}>
      {open && <OneOffBody date={date} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}
function OneOffBody({ onClose, date: initial }: { onClose: () => void; date?: string }) {
  const { club } = useClub();
  const types = useClassTypes(club?.id), venues = useVenues(club?.id);
  const create = useCreateSession(club?.id ?? "");
  const [v, set] = useSessionDraft();
  const today = todayFn(club?.timezone);
  const [date, setDate] = useState(initial ?? today);
  const [time, setTime] = useState("07:00");
  const [notes, setNotes] = useState("");
  const err = apiErr(create.error);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ ...v, date, time, notes: notes.trim() || undefined, location_id: v.location_id || null, instructor_membership_id: v.instructor_membership_id || null }, { onSuccess: () => { toast.success(t("Aula criada"), t("Os alunos já podem reservar.")); onClose(); } }); }}>
      <SessionFields v={v} set={set} types={types.data ?? []} venues={venues.data ?? []} err={err} />
      <Field label={t("Data")} error={err?.fieldError("date")}>{(id) => <DateInput id={id} value={date} min={today} onChange={setDate} />}</Field>
      <Field label={t("Horário")} hint={t("24 horas, ex.: 18:30")}>{(id) => <TimeInput id={id} value={time} onChange={setTime} />}</Field>
      <Field label={t("Recado para os alunos")} optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Ex.: traga a toalha")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button>
        <Button type="submit" loading={create.isPending} disabled={!v.class_type_id || !date || !validTime(time)}>{t("Criar aula")}</Button>
      </div>
      {err && !err.errors.length && <p role="alert" className="text-sm text-danger-text sm:col-span-2">{err.title}. {err.detail}</p>}
    </form>
  );
}

export function ClassTypeDialog({ open, onOpenChange, value }: Open & { value?: ClassType | null }) {
  return <Dialog open={open} onOpenChange={onOpenChange} title={value ? t("Editar tipo de aula") : t("Novo tipo de aula")}>{open && <ClassTypeBody value={value} onClose={() => onOpenChange(false)} />}</Dialog>;
}
function ClassTypeBody({ value, onClose }: { value?: ClassType | null; onClose: () => void }) {
  const { club } = useClub();
  const save = useSaveClassType(club?.id ?? "");
  // The club's class modalities first; the rest stay possible (a running club can still hold a class).
  const own = CLASS_SPORTS.filter((s) => club?.modalities.includes(s));
  const sports = [...own, ...CLASS_SPORTS.filter((s) => !own.includes(s))];
  const [v, setV] = useState({ name: value?.name ?? "", sport: value?.sport ?? sports[0] ?? ("mobility" as Sport), description: value?.description ?? "", default_capacity: value?.default_capacity ?? 20, duration_min: value?.duration_min ?? 60 });
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const err = apiErr(save.error);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: value?.id, ...v, name: v.name.trim(), description: v.description.trim() || null }, { onSuccess: () => { toast.success(value ? t("Tipo de aula salvo") : t("Tipo de aula criado")); onClose(); } }); }}>
      <Field label={t("Nome")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Ex.: Funcional 45'")} autoFocus />}</Field>
      <Field label={t("Modalidade")} error={err?.fieldError("sport")}>{(id) => <Select id={id} value={v.sport} onChange={(e) => set({ sport: e.target.value as Sport })}>{sports.map((s) => <option key={s} value={s}>{t(SPORT_LABEL[s])}</option>)}</Select>}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Vagas")} error={err?.fieldError("default_capacity")}>{(id) => <Input id={id} type="number" inputMode="numeric" min={1} value={v.default_capacity} onChange={(e) => set({ default_capacity: Number(e.target.value) })} />}</Field>
        <Field label={t("Minutos")} error={err?.fieldError("duration_min")}>{(id) => <Input id={id} type="number" inputMode="numeric" min={10} step={5} value={v.duration_min} onChange={(e) => set({ duration_min: Number(e.target.value) })} />}</Field>
      </div>
      <Field label={t("Descrição")} optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("O que o aluno vai encontrar nessa aula")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{t("Salvar")}</Button></div>
    </form>
  );
}

export function VenueDialog({ open, onOpenChange, value }: Open & { value?: Venue | null }) {
  return <Dialog open={open} onOpenChange={onOpenChange} title={value ? t("Editar local") : t("Novo local")}>{open && <VenueBody value={value} onClose={() => onOpenChange(false)} />}</Dialog>;
}
function VenueBody({ value, onClose }: { value?: Venue | null; onClose: () => void }) {
  const { club } = useClub();
  const save = useSaveVenue(club?.id ?? "");
  const [v, setV] = useState({ name: value?.name ?? "", kind: value?.kind ?? ("gym" as VenueKind), address: value?.address ?? "", lanes: value?.lanes ?? 0 });
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const err = apiErr(save.error);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: value?.id, name: v.name.trim(), kind: v.kind, address: v.address.trim() || null, lanes: v.kind === "pool" && v.lanes ? v.lanes : null }, { onSuccess: () => { toast.success(value ? t("Local salvo") : t("Local criado")); onClose(); } }); }}>
      <Field label={t("Nome")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Ex.: Sala 2")} autoFocus />}</Field>
      <Field label={t("Tipo")} error={err?.fieldError("kind")}>{(id) => <Select id={id} value={v.kind} onChange={(e) => set({ kind: e.target.value as VenueKind })}>{VENUE_KINDS.map((k) => <option key={k} value={k}>{t(VENUE_LABEL[k])}</option>)}</Select>}</Field>
      {v.kind === "pool" ? <Field label={t("Raias")} optional error={err?.fieldError("lanes")}>{(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={12} value={v.lanes || ""} onChange={(e) => set({ lanes: Number(e.target.value) })} />}</Field> : <div />}
      <Field label={t("Endereço")} optional className="sm:col-span-2">{(id) => <Input id={id} value={v.address} onChange={(e) => set({ address: e.target.value })} placeholder={t("Rua, número, cidade")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{t("Salvar")}</Button></div>
    </form>
  );
}

/** Venues: create, edit, archive (W9 "Tipos e locais"). */
export function VenuesCard({ club }: { club: Club }) {
  const venues = useVenues(club.id);
  const archiveVenue = useArchiveVenue(club.id);
  const [venue, setVenue] = useState<Venue | null | undefined>(undefined);
  return (
    <>
      <Card className="grid content-start gap-3 p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="rf-text-title-md">{t("Locais")}</h2><Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setVenue(null)}>{t("Novo local")}</Button></div>
        {venues.isPending ? <Skeleton className="h-32" /> : !venues.data?.length ? <p className="text-sm text-fg-muted">{t("Nenhum local cadastrado.")}</p> : (
          <ul className="divide-y divide-line-subtle">
            {venues.data.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-soft text-fg-muted"><MapPin className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="font-semibold">{l.name}</div><div className="truncate text-xs text-fg-muted">{[t(VENUE_LABEL[l.kind]), l.lanes ? tn(l.lanes, "{n} raia", "{n} raias") : null, l.address].filter(Boolean).join(" · ")}</div></div>
                <Menu trigger={<IconButton size="sm" label={t("Ações de {name}", { name: l.name })}><MoreHorizontal /></IconButton>} items={[
                  { label: t("Editar"), icon: <Pencil />, onSelect: () => setVenue(l) },
                  { label: t("Arquivar"), icon: <Archive />, danger: true, onSelect: () => archiveVenue.mutate(l.id, { onSuccess: () => toast.success(t("Local arquivado")), onError: toast.error }) },
                ]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <VenueDialog open={venue !== undefined} onOpenChange={(v) => !v && setVenue(undefined)} value={venue} />
    </>
  );
}

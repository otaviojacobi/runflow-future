/** W14 · Avaliações e testes: protocols, record a test with live result, apply zones, history with change vs previous. Route: /assessments (?athlete=<membership id>) */
import { Gauge, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useAssessments, useCreateAssessment, useDeleteAssessment } from "@/api/assessments";
import { useAthletes } from "@/api/members";
import type { Assessment, Club } from "@/api/types";
import { ASSESSMENT_NAME as NAME, PROTOCOLS, headline } from "@/components/assessments";
import { ZoneTable } from "@/components/workout";
import { type AssessmentData, type AssessmentKind, ZONE_KIND, computeAssessment, zonesFrom } from "@/domain/assessments";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { fullDate, number, today as todayFn } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, PageHeader, Select, Skeleton, Switch, Textarea, cn, toast } from "@/ui";
import { parseTime } from "../onboarding/Welcome";

export function AssessmentsScreen() {
  const { club } = useClub();
  const [athlete, setAthlete] = useState(() => new URLSearchParams(location.search).get("athlete") ?? "");
  const [kind, setKind] = useState("");
  const [record, setRecord] = useState<AssessmentKind | null>(null);
  const athletes = useAthletes(club?.id);
  const list = useAssessments(club?.id, { membership_id: athlete || undefined, kind: kind || undefined });
  const del = useDeleteAssessment(club?.id ?? "");
  // Change vs the previous test of the same kind (and exercise) for the same athlete.
  const deltas = useMemo(() => {
    const m = new Map<string, number | null>();
    const all = [...(list.data ?? [])].reverse();
    const last = new Map<string, number>();
    for (const a of all) {
      const key = `${a.membership_id}|${a.kind}|${a.data.exercise ?? ""}`;
      const v = headline(a.kind, a.result, a.data).value;
      m.set(a.id, v != null && last.has(key) ? v - last.get(key)! : null);
      if (v != null) last.set(key, v);
    }
    return m;
  }, [list.data]);
  if (!club) return null;
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Avaliações e testes")} subtitle={t("Registre testes de campo e avaliações físicas. Os testes podem atualizar as zonas do aluno na hora.")} />
      <section className="grid gap-3" aria-labelledby="proto-h">
        <h2 id="proto-h" className="rf-text-title-md">{t("Registrar")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROTOCOLS.map((p) => (
            <button key={p.kind} type="button" onClick={() => setRecord(p.kind)} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-left shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-ring">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-on-brand-soft"><p.icon className="size-5" /></span>
              <span className="min-w-0"><span className="block font-semibold">{t(p.name)}</span><span className="block text-sm text-fg-muted">{t(p.how)}</span>{p.zones && <span className="mt-1 block text-xs font-semibold text-brand-text">{t("Atualiza {z}", { z: t(p.zones) })}</span>}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="grid gap-3" aria-labelledby="hist-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="hist-h" className="rf-text-title-md">{t("Histórico")}</h2>
          <div className="flex flex-wrap gap-2">
            <Select aria-label={t("Aluno")} value={athlete} onChange={(e) => setAthlete(e.target.value)} className="w-52"><option value="">{t("Todos os alunos")}</option>{(athletes.data ?? []).map((a) => <option key={a.membership.id} value={a.membership.id}>{a.user.name}</option>)}</Select>
            <Select aria-label={t("Tipo")} value={kind} onChange={(e) => setKind(e.target.value)} className="w-48"><option value="">{t("Todos os testes")}</option>{PROTOCOLS.map((p) => <option key={p.kind} value={p.kind}>{t(p.name)}</option>)}</Select>
          </div>
        </div>
        <Card className="overflow-x-auto">
          {list.isPending ? <Skeleton className="m-4 h-40" /> : !list.data?.length ? <EmptyState icon={<Gauge />} title={t("Nenhuma avaliação ainda")}>{t("Escolha um protocolo acima para registrar a primeira.")}</EmptyState> : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><th className="px-4 py-2.5 font-semibold">{t("Data")}</th><th className="px-4 py-2.5 font-semibold">{t("Aluno")}</th><th className="px-4 py-2.5 font-semibold">{t("Teste")}</th><th className="px-4 py-2.5 font-semibold">{t("Resultado")}</th><th className="px-4 py-2.5 font-semibold">{t("Variação")}</th><th className="px-4 py-2.5"><span className="sr-only">{t("Ações")}</span></th></tr></thead>
              <tbody className="divide-y divide-line-subtle">
                {list.data.map((a) => <Row key={a.id} a={a} delta={deltas.get(a.id) ?? null} onDelete={() => del.mutate(a.id, { onSuccess: () => toast.success(t("Avaliação apagada")) })} />)}
              </tbody>
            </table>
          )}
        </Card>
      </section>
      <RecordDialog club={club} kind={record} athleteId={athlete} onClose={() => setRecord(null)} />
    </div>
  );
}

function Row({ a, delta, onDelete }: { a: Assessment; delta: number | null; onDelete: () => void }) {
  const h = headline(a.kind, a.result, a.data);
  const good = delta != null && delta !== 0 && h.better ? (h.better === "up" ? delta > 0 : delta < 0) : null;
  const fmtDelta = (d: number) => (a.kind === "css" ? `${d > 0 ? "+" : "−"}${number(Math.abs(d), 1)} s` : `${d > 0 ? "+" : "−"}${number(Math.abs(d), 1)}`);
  return (
    <tr>
      <td className="px-4 py-3 tabular-nums">{fullDate(a.date)}</td>
      <td className="px-4 py-3"><span className="flex items-center gap-2"><Avatar name={a.athlete.user.name} src={a.athlete.user.avatar_url} size={26} /><span className="font-semibold">{a.athlete.user.name}</span></span></td>
      <td className="px-4 py-3">{t(NAME[a.kind])}{a.zones && <Badge tone="success" className="ml-2">{t("Zonas aplicadas")}</Badge>}</td>
      <td className="px-4 py-3 tabular-nums">{h.text}{a.notes && <div className="text-xs text-fg-muted">{a.notes}</div>}</td>
      <td className={cn("px-4 py-3 font-semibold tabular-nums", good === true ? "text-success-text" : good === false ? "text-danger-text" : "text-fg-muted")}>{delta == null || delta === 0 ? "–" : fmtDelta(delta)}</td>
      <td className="px-4 py-3 text-right"><IconButton size="sm" label={t("Apagar avaliação")} onClick={onDelete}><Trash2 /></IconButton></td>
    </tr>
  );
}

// ---------------------------------------------------------------- record
function RecordDialog({ club, kind, athleteId, onClose }: { club: Club; kind: AssessmentKind | null; athleteId: string; onClose: () => void }) {
  return <Dialog open={!!kind} onOpenChange={(v) => !v && onClose()} size="lg" title={kind ? t(NAME[kind]) : ""} description={kind ? t(PROTOCOLS.find((p) => p.kind === kind)!.how) : undefined}>{kind && <RecordBody club={club} kind={kind} athleteId={athleteId} onClose={onClose} key={kind} />}</Dialog>;
}
function RecordBody({ club, kind, athleteId, onClose }: { club: Club; kind: AssessmentKind; athleteId: string; onClose: () => void }) {
  const athletes = useAthletes(club.id);
  const create = useCreateAssessment(club.id);
  const today = todayFn(club.timezone);
  const [who, setWho] = useState(athleteId);
  const [date, setDate] = useState(today);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [apply, setApply] = useState(true);
  const [notes, setNotes] = useState("");
  const num = (k: string) => (raw[k] ? Number(raw[k].replace(",", ".")) : undefined);
  const data: AssessmentData = {
    body: { weight_kg: num("weight_kg"), height_cm: num("height_cm"), body_fat_pct: num("body_fat_pct"), waist_cm: num("waist_cm"), resting_hr: num("resting_hr") },
    cooper: { distance_m: num("distance_m") },
    run_3k: { time_s: raw.time ? parseTime(raw.time) ?? undefined : undefined },
    css: { t400_s: raw.t400 ? parseTime(raw.t400) ?? undefined : undefined, t200_s: raw.t200 ? parseTime(raw.t200) ?? undefined : undefined },
    ftp: { avg_power_w: num("avg_power_w") },
    one_rm: { exercise: raw.exercise, weight_kg: num("weight_kg"), reps: num("reps") },
    hr_max: { max_hr: num("max_hr") },
  }[kind];
  const result = computeAssessment(kind, data);
  const zoneKind = ZONE_KIND[kind];
  const err = create.error instanceof ApiError ? create.error : null;
  const f = (k: string, label: string, opts: { placeholder?: string; hint?: string; optional?: boolean; mode?: "numeric" | "decimal" | "text" } = {}) => (
    <Field label={label} optional={opts.optional} hint={opts.hint} error={err?.fieldError(`data.${k}`)}>{(id, d) => <Input id={id} aria-describedby={d} value={raw[k] ?? ""} onChange={(e) => setRaw((r) => ({ ...r, [k]: e.target.value }))} placeholder={opts.placeholder} inputMode={opts.mode ?? "decimal"} />}</Field>
  );
  const fields = {
    body: <>{f("weight_kg", t("Peso (kg)"), { placeholder: "68,5" })}{f("height_cm", t("Altura (cm)"), { placeholder: "172", mode: "numeric" })}{f("body_fat_pct", t("Gordura (%)"), { optional: true })}{f("waist_cm", t("Cintura (cm)"), { optional: true })}{f("resting_hr", t("FC de repouso (bpm)"), { optional: true, mode: "numeric" })}</>,
    cooper: f("distance_m", t("Distância em 12 min (m)"), { placeholder: "2800", mode: "numeric" }),
    run_3k: f("time", t("Tempo dos 3 km"), { placeholder: "12:30", mode: "numeric" }),
    css: <>{f("t400", t("Tempo dos 400 m"), { placeholder: "6:20", mode: "numeric" })}{f("t200", t("Tempo dos 200 m"), { placeholder: "2:58", mode: "numeric" })}</>,
    ftp: f("avg_power_w", t("Potência média em 20 min (W)"), { placeholder: "240", mode: "numeric" }),
    one_rm: <>{f("exercise", t("Exercício"), { placeholder: t("Ex.: Agachamento livre"), mode: "text" })}{f("weight_kg", t("Carga (kg)"))}{f("reps", t("Repetições até a falha"), { placeholder: "5", mode: "numeric", hint: t("De 1 a 15. Quanto menos repetições, mais preciso.") })}</>,
    hr_max: f("max_hr", t("FC máxima (bpm)"), { placeholder: "186", mode: "numeric" }),
  }[kind];
  const submit = () => create.mutate({ membership_id: who, kind, date, data, notes: notes || undefined, apply_zones: !!zoneKind && apply }, {
    onSuccess: (a) => { toast.success(t("Avaliação registrada"), a.zones ? t("As zonas de {name} foram atualizadas.", { name: a.athlete.user.name.split(" ")[0] }) : undefined); onClose(); },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  const preview = result ? zonesFrom(kind, result) : null;
  return (
    <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Aluno")} error={err?.fieldError("membership_id")}>{(id) => <Select id={id} value={who} onChange={(e) => setWho(e.target.value)}><option value="">{t("Escolha…")}</option>{(athletes.data ?? []).map((a) => <option key={a.membership.id} value={a.membership.id}>{a.user.name}</option>)}</Select>}</Field>
        <Field label={t("Data")} error={err?.fieldError("date")}>{(id) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}</Field>
        {fields}
      </div>
      <div className="grid gap-3 rounded-lg bg-sunken p-4" aria-live="polite">
        <div className="rf-text-overline text-fg-muted">{t("Resultado")}</div>
        {result ? <div className="font-display text-xl font-bold">{headline(kind, result, data).text}</div> : <p className="text-sm text-fg-muted">{t("Preencha os campos para ver o resultado.")}</p>}
        {preview && zoneKind && <ZoneTable z={{ bounds: preview }} unit={zoneKind} />}
      </div>
      {zoneKind && <Switch checked={apply} onCheckedChange={setApply} label={t("Atualizar as zonas do aluno com este teste")} description={t("Os treinos com alvo por zona passam a usar os novos valores.")} />}
      <Field label={t("Observações")} optional>{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Ex.: vento forte, pista molhada")} />}</Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" disabled={!who || !result} loading={create.isPending}>{t("Registrar")}</Button></div>
    </form>
  );
}

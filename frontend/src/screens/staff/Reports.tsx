/** W16 · Relatórios: training compliance and volume per student/group, class attendance (Aulas, D-052); CSV and print/PDF. Route: /reports */
import { Download, Printer, ShieldOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useGroups } from "@/api/members";
import { useAttendanceReport, useTrainingReport } from "@/api/reports";
import type { AttendanceReport, Club, TrainingReport } from "@/api/types";
import { ComplianceTrend } from "@/components/ComplianceTrend";
import { ComplianceBar } from "@/components/workout";
import { t } from "@/i18n";
import { downloadCsv } from "@/lib/csv";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { addDays, duration, fullDate, km, mondayOf, today as todayFn } from "@/lib/format";
import { Avatar, Button, Card, DateInput, Field, PageHeader, Segmented, Skeleton, Tabs, cn } from "@/ui";

type Preset = "4w" | "month" | "last_month" | "3m" | "custom";
function range(p: Preset, today: string): { from: string; to: string } {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  if (p === "month") return { from: first(y, m), to: today };
  if (p === "last_month") return { from: first(y, m - 1), to: addDays(first(y, m), -1) };
  if (p === "3m") return { from: addDays(mondayOf(today), -7 * 12), to: today };
  return { from: addDays(mondayOf(today), -21), to: today };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card data-print="avoid-break" className="p-4"><div className="text-sm text-fg-muted">{label}</div><div className="font-display text-[28px] font-bold leading-tight tabular-nums [font-stretch:110%]">{value}</div>{sub && <div className="text-xs text-fg-muted">{sub}</div>}</Card>;
}
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={cn("px-4 py-2.5 font-semibold", right && "text-right")}>{children}</th>;
const pct = (v: number | null) => (v == null ? "–" : `${v}%`);

export function ReportsScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [preset, setPreset] = useState<Preset>("4w");
  const [custom, setCustom] = useState(() => range("4w", today));
  const [group, setGroup] = useState("");
  const groups = useGroups(club?.id);
  const f = { ...(preset === "custom" ? custom : range(preset, today)), group_id: group || undefined };
  const training = useTrainingReport(club?.id, f);
  // Class attendance only for clubs with Aulas (D-052).
  const classes = has(club, "classes");
  const [tab, setTab] = useState("training");
  const attendance = useAttendanceReport(club?.id, f, classes);
  if (!club) return null;
  const groupName = group ? groups.data?.find((g) => g.id === group)?.name : t("Todos os alunos");
  const onClasses = classes && tab === "classes";
  const exportCsv = () => (onClasses ? attendance.data && csvAttendance(club, attendance.data) : training.data && csvTraining(club, training.data));
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader title={t("Relatórios")} subtitle={<span>{fullDate(f.from)} – {fullDate(f.to)} · {groupName}</span>}
        actions={<div data-print="hide" className="flex gap-2"><Button variant="secondary" icon={<Download />} onClick={exportCsv}>{t("Exportar CSV")}</Button><Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>{t("Imprimir ou PDF")}</Button></div>} />
      <div data-print="hide" className="flex flex-wrap items-end gap-3">
        <Segmented label={t("Período")} value={preset} onChange={setPreset} size="sm" options={[{ value: "4w", label: t("4 semanas") }, { value: "month", label: t("Este mês") }, { value: "last_month", label: t("Mês passado") }, { value: "3m", label: t("3 meses") }, { value: "custom", label: t("Outro") }]} />
        {preset === "custom" && <div className="flex gap-2"><Field label={t("De")}>{(id) => <DateInput id={id} value={custom.from} max={custom.to} onChange={(from) => from && setCustom({ ...custom, from })} className="h-9" />}</Field><Field label={t("Até")}>{(id) => <DateInput id={id} value={custom.to} min={custom.from} max={today} onChange={(to) => to && setCustom({ ...custom, to })} className="h-9" />}</Field></div>}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Grupo")}>
          {[{ id: "", name: t("Todos") }, ...(groups.data ?? [])].map((g) => <button key={g.id} onClick={() => setGroup(g.id)} aria-pressed={group === g.id} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", group === g.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>)}
        </div>
      </div>
      {classes ? (
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List data-print="hide"><Tabs.Trigger value="training">{t("Treinos")}</Tabs.Trigger><Tabs.Trigger value="classes">{t("Aulas")}</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="training">{training.data ? <Training r={training.data} volume={has(club, "strava")} /> : <Skeleton className="h-96" />}</Tabs.Content>
          <Tabs.Content value="classes">{attendance.data ? <Attendance r={attendance.data} /> : <Skeleton className="h-96" />}</Tabs.Content>
        </Tabs.Root>
      ) : training.data ? <Training r={training.data} volume={has(club, "strava")} /> : <Skeleton className="h-96" />}
    </div>
  );
}

/** `volume`: time and distance from synced activities, only for clubs whose modalities sync them (D-052). */
function Training({ r, volume }: { r: TrainingReport; volume: boolean }) {
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const rows = useMemo(() => [...r.athletes].sort((a, b) => (sort === "name" ? a.user.name.localeCompare(b.user.name) : (a.compliance_pct ?? 101) - (b.compliance_pct ?? 101))), [r.athletes, sort]);
  const T = r.totals;
  return (
    <div className="grid gap-5">
      <div className={cn("grid grid-cols-2 gap-3", volume ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <Kpi label={t("Aderência")} value={pct(T.compliance_pct)} sub={t("parcial conta meio treino")} />
        <Kpi label={t("Treinos feitos")} value={`${T.done + T.partial}/${T.planned}`} sub={t("{n} não realizados", { n: T.missed })} />
        {volume ? <>
          <Kpi label={t("Tempo de treino")} value={duration(T.done_s)} sub={t("planejado: {d}", { d: duration(T.planned_s) })} />
          <Kpi label={t("Distância")} value={`${km(T.distance_m)} km`} sub={t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes })} />
        </> : <Kpi label={t("Tempo planejado")} value={duration(T.planned_s)} sub={t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes })} />}
      </div>
      <Card data-print="avoid-break" className="grid gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3"><h2 className="rf-text-title-md">{t("Aderência por semana")}</h2><span className="text-sm text-fg-muted">{t("alunos do filtro")}</span></div>
        <ComplianceTrend data={r.weekly} />
      </Card>
      <Card className="relative min-w-0 overflow-x-auto">
        <div data-print="hide" className="flex justify-end border-b border-line-subtle px-4 py-2"><Segmented label={t("Ordenar")} value={sort} onChange={setSort} size="sm" options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} /></div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><Th>{t("Aluno")}</Th><Th>{t("Aderência")}</Th><Th right>{t("Feitos")}</Th><Th right>{t("Parciais")}</Th><Th right>{t("Faltas")}</Th><Th right>{t("Planejado")}</Th>{volume && <><Th right>{t("Treinado")}</Th><Th right>{t("Distância")}</Th></>}</tr></thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((a) => (
              <tr key={a.membership_id}>
                <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={a.user.name} src={a.user.avatar_url} size={26} /><span className="font-semibold">{a.user.name}</span></span></td>
                <td className="w-44 px-4 py-2.5"><ComplianceBar pct={a.compliance_pct} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a.done}/{a.planned}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a.partial}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", a.missed > 2 && "font-semibold text-danger-text")}>{a.missed}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{duration(a.planned_s)}</td>
                {!volume ? null : a.shares_data ? <><td className="px-4 py-2.5 text-right tabular-nums">{duration(a.done_s)}</td><td className="px-4 py-2.5 text-right tabular-nums">{km(a.distance_m)} km</td></> : <td colSpan={2} className="px-4 py-2.5 text-right text-xs text-fg-muted"><span className="inline-flex items-center gap-1"><ShieldOff className="size-3.5" />{t("não compartilha")}</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const hours = (s: number | null) => (s == null ? null : Math.round((s / 3600) * 10) / 10);
function csvTraining(club: Club, r: TrainingReport) {
  // The activity columns only where the club's modalities sync activities (D-052).
  const volume = has(club, "strava");
  downloadCsv(`${club.slug}-treinos-${r.from}-a-${r.to}.csv`,
    [t("Aluno"), t("E-mail"), t("Aderência (%)"), t("Planejados"), t("Feitos"), t("Parciais"), t("Não realizados"), t("Horas planejadas"), ...(volume ? [t("Horas treinadas"), t("Distância (km)"), t("Atividades")] : [])],
    r.athletes.map((a) => [a.user.name, a.user.email, a.compliance_pct, a.planned, a.done, a.partial, a.missed, hours(a.planned_s), ...(volume ? [hours(a.done_s), a.distance_m == null ? null : Math.round(a.distance_m / 100) / 10, a.activities] : [])]));
}

const pctOf = (v: number | null) => (v == null ? "–" : `${v}%`);
/** Aulas attendance: classes held in the period, by class type and by student. */
function Attendance({ r }: { r: AttendanceReport }) {
  const T = r.totals;
  if (!T.sessions && !T.cancelled) return <Card className="p-8 text-center text-fg-muted">{t("Nenhuma aula no período.")}</Card>;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("Aulas dadas")} value={String(T.sessions)} sub={T.cancelled ? t("{n} canceladas", { n: T.cancelled }) : undefined} />
        <Kpi label={t("Ocupação")} value={pctOf(T.occupancy_pct)} sub={t("reservas sobre vagas")} />
        <Kpi label={t("Presença")} value={pctOf(T.attendance_pct)} sub={t("{a} presenças · {n} faltas", { a: T.attended, n: T.no_show })} />
        <Kpi label={t("Reservas")} value={String(T.booked)} />
      </div>
      <Card className="relative min-w-0 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><Th>{t("Aula")}</Th><Th right>{t("Aulas")}</Th><Th right>{t("Canceladas")}</Th><Th right>{t("Ocupação")}</Th><Th right>{t("Presentes")}</Th><Th right>{t("Faltas")}</Th><Th right>{t("Presença")}</Th></tr></thead>
          <tbody className="divide-y divide-line-subtle">{r.by_type.map((x) => (
            <tr key={x.class_type.id}><td className="px-4 py-2.5 font-semibold">{x.class_type.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.sessions}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.cancelled}</td><td className="px-4 py-2.5 text-right tabular-nums">{pctOf(x.occupancy_pct)}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.attended}</td><td className="px-4 py-2.5 text-right tabular-nums">{x.no_show}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{pctOf(x.attendance_pct)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card className="relative min-w-0 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><Th>{t("Aluno")}</Th><Th right>{t("Reservas")}</Th><Th right>{t("Presentes")}</Th><Th right>{t("Faltas")}</Th><Th right>{t("Presença")}</Th></tr></thead>
          <tbody className="divide-y divide-line-subtle">{r.athletes.map((a) => (
            <tr key={a.membership_id}><td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={a.user.name} src={a.user.avatar_url} size={26} /><span className="font-semibold">{a.user.name}</span></span></td><td className="px-4 py-2.5 text-right tabular-nums">{a.booked}</td><td className="px-4 py-2.5 text-right tabular-nums">{a.attended}</td><td className={cn("px-4 py-2.5 text-right tabular-nums", a.no_show > 1 && "font-semibold text-danger-text")}>{a.no_show}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{pctOf(a.attendance_pct)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
function csvAttendance(club: Club, r: AttendanceReport) {
  downloadCsv(`${club.slug}-aulas-${r.from}-a-${r.to}.csv`,
    [t("Aluno"), t("E-mail"), t("Reservas"), t("Presentes"), t("Faltas"), t("Presença (%)")],
    r.athletes.map((a) => [a.user.name, a.user.email, a.booked, a.attended, a.no_show, a.attendance_pct]));
}

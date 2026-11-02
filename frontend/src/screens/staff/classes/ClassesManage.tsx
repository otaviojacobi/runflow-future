/** W9 · Gestão de aulas: week view, recurring schedules, class types and venues. Route: /classes/manage */
import { Archive, Ban, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, MapPin, MoreHorizontal, Pencil, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { useArchiveClassType, useClassTypes, useEndSchedule, useSchedules, useSessions } from "@/api/classes";
import type { ClassSchedule, ClassSession, ClassType, Club } from "@/api/types";
import { Occupancy, WEEKDAY_LONG, isPast, timeRange } from "@/components/classes";
import { SportChip, sportBar } from "@/components/sport";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, localDate, mondayOf, today as todayFn, weekdayShort } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, IconButton, Menu, PageHeader, Skeleton, Tabs, cn, toast } from "@/ui";
import { SessionDialog } from "./SessionDialog";
import { ClassTypeDialog, OneOffDialog, ScheduleDialog, VenuesCard } from "./SetupDialogs";

export function ClassesManageScreen() {
  const { club } = useClub();
  const [tab, setTab] = useState("week");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [oneOff, setOneOff] = useState<{ date?: string } | null>(null);
  const types = useClassTypes(club?.id);
  if (!club) return null;
  const noTypes = types.isSuccess && types.data.length === 0;
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader title={t("Aulas")} subtitle={t("Grade semanal, reservas, lista de espera e presença")}
        actions={<><Button variant="secondary" icon={<CalendarPlus />} onClick={() => setOneOff({})} disabled={noTypes}>{t("Aula avulsa")}</Button><Button icon={<Repeat />} onClick={() => setScheduleOpen(true)} disabled={noTypes}>{t("Nova grade")}</Button></>} />
      {noTypes ? (
        <Card><EmptyState icon={<CalendarClock />} title={t("Comece criando um tipo de aula")} action={<Button icon={<Plus />} onClick={() => setTab("setup")}>{t("Criar tipo de aula")}</Button>}>{t("Ex.: Treino coletivo de pista, Natação adulto, Funcional. Depois é só montar a grade da semana.")}</EmptyState></Card>
      ) : null}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List>
          <Tabs.Trigger value="week">{t("Semana")}</Tabs.Trigger>
          <Tabs.Trigger value="schedules">{t("Grade recorrente")}</Tabs.Trigger>
          <Tabs.Trigger value="setup">{t("Tipos e locais")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="week"><Week club={club} onAdd={(date) => setOneOff({ date })} /></Tabs.Content>
        <Tabs.Content value="schedules"><Schedules club={club} onNew={() => setScheduleOpen(true)} /></Tabs.Content>
        <Tabs.Content value="setup"><Setup club={club} /></Tabs.Content>
      </Tabs.Root>
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <OneOffDialog open={!!oneOff} onOpenChange={(v) => !v && setOneOff(null)} date={oneOff?.date} />
    </div>
  );
}

// ---------------------------------------------------------------- week
function Week({ club, onAdd }: { club: Club; onAdd: (date: string) => void }) {
  const today = todayFn(club.timezone);
  const [monday, setMonday] = useState(mondayOf(today));
  const [open, setOpen] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sessions = useSessions(club.id, monday, days[6]!);
  const byDay = useMemo(() => {
    const m = new Map<string, ClassSession[]>();
    for (const s of sessions.data ?? []) { const d = localDate(s.starts_at, club.timezone); m.set(d, [...(m.get(d) ?? []), s]); }
    return m;
  }, [sessions.data, club.timezone]);
  const live = (sessions.data ?? []).filter((s) => s.status === "scheduled");
  const booked = live.reduce((n, s) => n + s.booked, 0), cap = live.reduce((n, s) => n + s.capacity, 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <IconButton variant="secondary" label={t("Semana anterior")} onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft /></IconButton>
          <Button variant="secondary" onClick={() => setMonday(mondayOf(today))} disabled={monday === mondayOf(today)}>{t("Esta semana")}</Button>
          <IconButton variant="secondary" label={t("Próxima semana")} onClick={() => setMonday(addDays(monday, 7))}><ChevronRight /></IconButton>
        </div>
        <span className="text-sm font-semibold">{t("{a} a {b}", { a: dayMonth(monday), b: dayMonth(days[6]!) })}</span>
        {live.length > 0 && <span className="text-sm text-fg-muted">{tn(live.length, "{n} aula", "{n} aulas")} · {t("{p}% de ocupação", { p: Math.round((booked / Math.max(1, cap)) * 100) })}</span>}
      </div>
      {sessions.isPending ? <Skeleton className="h-80" /> : (
        <div className="grid gap-3 lg:grid-cols-7 lg:gap-2">
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const isToday = d === today;
            return (
              <section key={d} aria-label={`${weekdayShort(d)}, ${dayMonth(d)}`} className={cn("group/day grid content-start gap-2 rounded-xl p-2 lg:min-h-64", isToday ? "bg-brand-soft/50" : "bg-sunken", !items.length && "max-lg:hidden")}>
                <header className="flex items-baseline justify-between px-1">
                  <span className={cn("text-[11px] font-bold uppercase tracking-[0.06em]", isToday ? "text-brand-text" : "text-fg-muted")}>{weekdayShort(d)}</span>
                  <span className={cn("text-sm font-bold tabular-nums", isToday && "text-brand-text")}>{dayMonth(d)}</span>
                </header>
                {items.map((s) => <SessionCard key={s.id} s={s} tz={club.timezone} onOpen={() => setOpen(s.id)} />)}
                {d >= today && <button type="button" onClick={() => onAdd(d)} aria-label={t("Nova aula avulsa em {d}", { d: dayMonth(d) })} className="grid h-8 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-soft hover:text-fg focus-visible:opacity-100 group-hover/day:opacity-100"><Plus className="size-4" /></button>}
              </section>
            );
          })}
          {byDay.size === 0 && <Card className="lg:col-span-7"><EmptyState title={t("Nenhuma aula nesta semana")}>{t("Crie uma grade recorrente ou uma aula avulsa.")}</EmptyState></Card>}
        </div>
      )}
      <SessionDialog club={club} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SessionCard({ s, tz, onOpen }: { s: ClassSession; tz: string; onOpen: () => void }) {
  const cancelled = s.status === "cancelled";
  return (
    <button type="button" onClick={onOpen} className={cn("relative grid gap-1.5 overflow-hidden rounded-lg border border-line bg-surface py-2 pl-3 pr-2 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-ring", (cancelled || isPast(s)) && "opacity-60")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", sportBar[s.class_type.sport])} />
      <span className="text-xs font-bold tabular-nums text-fg-muted">{timeRange(s, tz)}</span>
      <span className={cn("line-clamp-2 text-[13px] font-semibold leading-tight", cancelled && "line-through")}>{s.class_type.name}</span>
      {s.location && <span className="flex items-center gap-1 truncate text-[11px] text-fg-muted"><MapPin className="size-3 shrink-0" />{s.location.name}</span>}
      {cancelled ? <Badge tone="danger" icon={<Ban />}>{t("Cancelada")}</Badge> : <Occupancy s={s} />}
    </button>
  );
}

// ---------------------------------------------------------------- recurring schedules
function Schedules({ club, onNew }: { club: Club; onNew: () => void }) {
  const list = useSchedules(club.id);
  const end = useEndSchedule(club.id);
  const [ending, setEnding] = useState<ClassSchedule | null>(null);
  if (list.isPending) return <Skeleton className="h-64" />;
  const items = list.data ?? [];
  if (!items.length) return <Card><EmptyState icon={<Repeat />} title={t("Nenhuma grade ainda")} action={<Button icon={<Plus />} onClick={onNew}>{t("Nova grade")}</Button>}>{t("A grade repete toda semana e as aulas aparecem para os alunos reservarem.")}</EmptyState></Card>;
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, rows: items.filter((x) => x.weekday === d) })).filter((g) => g.rows.length);
  return (
    <Card className="divide-y divide-line-subtle">
      {byDay.map(({ d, rows }) => (
        <div key={d} className="grid gap-1 p-4 sm:grid-cols-[120px_1fr]">
          <h3 className="pt-2 text-sm font-bold">{t(WEEKDAY_LONG[d])}</h3>
          <ul className="grid gap-1">
            {rows.map((sc) => (
              <li key={sc.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-soft">
                <span className="w-12 shrink-0 font-bold tabular-nums">{sc.start_time.slice(0, 5)}</span>
                <i aria-hidden className={cn("h-8 w-1 shrink-0 rounded-full", sportBar[sc.class_type.sport])} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{sc.class_type.name}</div>
                  <div className="truncate text-xs text-fg-muted">{[`${sc.duration_min} min`, tn(sc.capacity, "{n} vaga", "{n} vagas"), sc.location?.name, sc.instructor?.name].filter(Boolean).join(" · ")}</div>
                </div>
                <Menu trigger={<IconButton size="sm" label={t("Ações")}><MoreHorizontal /></IconButton>} items={[{
                  label: t("Encerrar grade"), icon: <Archive />, danger: true,
                  onSelect: () => setEnding(sc),
                }]} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="px-4 py-3 text-xs text-fg-muted">{t("As aulas ficam sempre geradas para as próximas 8 semanas. Para mudar horário, encerre e crie de novo: quem já reservou é avisado.")}</p>
      <Dialog open={!!ending} onOpenChange={(v) => !v && setEnding(null)} size="sm" title={t("Encerrar grade?")}
        description={ending ? t("{name} · {d} às {h}. As próximas aulas serão canceladas e quem reservou será avisado.", { name: ending.class_type.name, d: t(WEEKDAY_LONG[ending.weekday]).toLowerCase(), h: ending.start_time.slice(0, 5) }) : undefined}
        footer={<><Button variant="ghost" onClick={() => setEnding(null)}>{t("Voltar")}</Button><Button variant="danger" loading={end.isPending} onClick={() => ending && end.mutate(ending.id, { onSuccess: (r) => { toast.success(t("Grade encerrada"), tn(r.cancelled_sessions, "{n} aula futura cancelada.", "{n} aulas futuras canceladas.")); setEnding(null); }, onError: toast.error })}>{t("Encerrar grade")}</Button></>} />
    </Card>
  );
}

// ---------------------------------------------------------------- class types & venues
function Setup({ club }: { club: Club }) {
  const types = useClassTypes(club.id);
  const archiveType = useArchiveClassType(club.id);
  const [type, setType] = useState<ClassType | null | undefined>(undefined);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="grid content-start gap-3 p-5">
        <div className="flex items-center justify-between"><h2 className="rf-text-title-md">{t("Tipos de aula")}</h2><Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setType(null)}>{t("Novo tipo")}</Button></div>
        {types.isPending ? <Skeleton className="h-32" /> : !types.data?.length ? <p className="text-sm text-fg-muted">{t("Nenhum tipo de aula.")}</p> : (
          <ul className="divide-y divide-line-subtle">
            {types.data.map((ct) => (
              <li key={ct.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{ct.name}</span><SportChip sport={ct.sport} size="sm" /></div><div className="text-xs text-fg-muted">{ct.duration_min} min · {tn(ct.default_capacity, "{n} vaga", "{n} vagas")}{ct.description ? ` · ${ct.description}` : ""}</div></div>
                <Menu trigger={<IconButton size="sm" label={t("Ações de {name}", { name: ct.name })}><MoreHorizontal /></IconButton>} items={[
                  { label: t("Editar"), icon: <Pencil />, onSelect: () => setType(ct) },
                  { label: t("Arquivar"), icon: <Archive />, danger: true, onSelect: () => archiveType.mutate(ct.id, { onSuccess: () => toast.success(t("Tipo de aula arquivado"), t("As aulas já criadas continuam na agenda.")) }) },
                ]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <VenuesCard club={club} />
      <ClassTypeDialog open={type !== undefined} onOpenChange={(v) => !v && setType(undefined)} value={type} />
    </div>
  );
}


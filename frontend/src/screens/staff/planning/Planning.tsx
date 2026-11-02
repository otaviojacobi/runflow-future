/** W4 · Planejamento: students × week grid. Route: /planning */
import { Check, ChevronLeft, ChevronRight, Copy, EyeOff, Flag, MessageSquare, Minus, Plus, Printer, Search, Sparkles, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAthletes, useGroups } from "@/api/members";
import { useRaces } from "@/api/races";
import type { AthleteSummary, PlannedWorkout } from "@/api/types";
import { usePlanned, useUpdatePlanned } from "@/api/workouts";
import { distanceLabel } from "@/components/races";
import { sportBar, sportSoft } from "@/components/sport";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, duration, mondayOf, today as todayFn, weekdayShort } from "@/lib/format";
import { Avatar, Button, Card, EmptyState, IconButton, Input, PageHeader, Skeleton, cn, toast } from "@/ui";
import { isTyping } from "@/components/shell/AppShell";
import { AssignDialog, type AssignPrefill } from "./AssignDialog";
import { SuggestWeekDialog } from "./SuggestWeekDialog";
import { WeekRelease } from "./WeekRelease";
import { CopyWeekDialog, DetailDialog, EditDialog } from "./WorkoutDialogs";

function Chip({ w, onOpen, today }: { w: PlannedWorkout; onOpen: () => void; today: string }) {
  const st = w.completion?.status;
  const Icon = st === "completed" ? Check : st === "partial" ? Minus : st === "missed" ? X : null;
  const pending = !st && w.date < today;
  return (
    <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", `${w.id}|${w.athlete_membership_id}`); e.dataTransfer.effectAllowed = "move"; }} onClick={onOpen}
      className={cn("group relative flex w-full items-center gap-1 overflow-hidden rounded-[8px] py-1.5 pl-2.5 pr-1.5 text-left text-[11.5px] font-semibold leading-tight transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-ring", sportSoft[w.sport], pending && "opacity-60", !w.visible && "border border-dashed border-line-strong")}
      title={w.visible ? w.title : `${w.title} · ${t("rascunho: o aluno ainda não vê")}`}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", sportBar[w.sport])} />
      <span className="line-clamp-2 min-w-0 flex-1">{w.title}</span>
      {!w.visible && <EyeOff className="size-3 shrink-0 opacity-70" aria-label={t("Rascunho")} />}
      {w.unread_count > 0 && <span className="grid size-4 shrink-0 place-items-center rounded-full bg-danger text-[9px] font-bold text-on-danger" aria-label={t("{n} comentário(s) novo(s)", { n: w.unread_count })}>{w.unread_count}</span>}
      {w.unread_count === 0 && w.comments_count > 0 && <MessageSquare className="size-3 shrink-0 opacity-70" />}
      {Icon && <Icon className={cn("size-3.5 shrink-0 stroke-[3]", st === "completed" ? "text-success-text" : st === "partial" ? "text-warning-text" : "text-danger-text")} aria-label={t(st === "completed" ? "Concluído" : st === "partial" ? "Parcial" : "Não realizado")} />}
    </button>
  );
}

export function PlanningScreen() {
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [monday, setMonday] = useState(mondayOf(today));
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [assign, setAssign] = useState<AssignPrefill | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<AthleteSummary | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Keyboard: ← → weeks, T this week, A assign, C copy week, / search, P print (see "?" in the shell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft") setMonday((m) => addDays(m, -7));
      else if (k === "arrowright") setMonday((m) => addDays(m, 7));
      else if (k === "t") setMonday(mondayOf(today));
      else if (k === "a") setAssign({});
      else if (k === "c") setCopyOpen(true);
      else if (k === "p") window.print();
      else if (k === "/") searchRef.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today]);
  const sunday = addDays(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const groups = useGroups(club?.id);
  const athletes = useAthletes(club?.id, { group_id: group === "all" ? undefined : group });
  const planned = usePlanned(club?.id, { from: monday, to: sunday, group_id: group === "all" ? undefined : group });
  const update = useUpdatePlanned(club?.id ?? "");
  const races = useRaces(club?.id, { from: monday, to: sunday });
  const raceByCell = useMemo(() => {
    const m = new Map<string, { name: string; label: string; goal: boolean }>();
    for (const r of races.data ?? []) for (const e of r.entries ?? []) m.set(`${e.membership_id}|${r.date}`, { name: r.name, label: distanceLabel(e.distance_m, r.sport), goal: e.is_goal });
    return m;
  }, [races.data]);
  const rows = useMemo(() => (athletes.data ?? []).filter((a) => !q || a.user.name.toLowerCase().includes(q.toLowerCase())), [athletes.data, q]);
  const byCell = useMemo(() => {
    const m = new Map<string, PlannedWorkout[]>();
    for (const w of planned.data ?? []) { const k = `${w.athlete_membership_id}|${w.date}`; m.set(k, [...(m.get(k) ?? []), w]); }
    return m;
  }, [planned.data]);
  if (!club) return null;
  const total = planned.data?.length ?? 0;
  const done = (planned.data ?? []).filter((w) => w.completion?.status === "completed" || w.completion?.status === "partial").length;

  const onDrop = (athleteId: string, date: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const [id, from] = e.dataTransfer.getData("text/plain").split("|");
    if (!id) return;
    if (from !== athleteId) return toast.info(t("Arraste dentro da linha do aluno"), t("Para outro aluno, use Atribuir treino."));
    const w = planned.data?.find((x) => x.id === id);
    if (!w || w.date === date) return;
    update.mutate({ id, date }, { onSuccess: () => toast.success(t("Treino movido para {d}", { d: `${weekdayShort(date)}, ${dayMonth(date)}` })), onError: toast.error });
  };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader eyebrow={t("Semana de {a} a {b}", { a: dayMonth(monday), b: dayMonth(sunday) })} title={t("Planejamento")}
        subtitle={total ? t("{done} de {total} treinos feitos nesta semana", { done, total }) : t("Nenhum treino nesta semana ainda")}
        actions={<div data-print="hide" className="flex flex-wrap gap-2"><IconButton variant="secondary" label={t("Imprimir a semana")} onClick={() => window.print()}><Printer /></IconButton><Button variant="secondary" icon={<Copy />} onClick={() => setCopyOpen(true)} disabled={!total}>{t("Copiar semana")}</Button><Button icon={<Plus />} onClick={() => setAssign({})}>{t("Atribuir treino")}</Button></div>} />
      <div data-print="hide" className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <IconButton variant="secondary" label={t("Semana anterior")} onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft /></IconButton>
          <Button variant="secondary" onClick={() => setMonday(mondayOf(today))} disabled={monday === mondayOf(today)}>{t("Esta semana")}</Button>
          <IconButton variant="secondary" label={t("Próxima semana")} onClick={() => setMonday(addDays(monday, 7))}><ChevronRight /></IconButton>
        </div>
        <div className="relative w-56"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input ref={searchRef} aria-label={t("Buscar aluno")} placeholder={t("Buscar aluno")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" /></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por grupo")}>
          {[{ id: "all", name: t("Todos") }, ...(groups.data ?? [])].map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} aria-pressed={group === g.id} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", group === g.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>
          ))}
        </div>
      </div>

      <WeekRelease club={club} monday={monday} />

      {athletes.isPending ? <Skeleton className="h-96" /> : rows.length === 0 ? (
        <Card><EmptyState title={t("Nenhum aluno aqui")}>{t("Convide alunos ou escolha outro grupo.")}</EmptyState></Card>
      ) : (
        <Card className="relative min-w-0 overflow-x-auto print:overflow-visible print:shadow-none">
          <div className="grid min-w-[980px] print:min-w-0 print:text-[10px]" style={{ gridTemplateColumns: "200px repeat(7, minmax(110px, 1fr))" }}>
            <div className="sticky left-0 z-10 border-b border-line bg-sunken px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">{t("Aluno")}</div>
            {days.map((d) => (
              <div key={d} className={cn("border-b border-l border-line-subtle bg-sunken px-2 py-2 text-center", d === today && "bg-brand-soft")}>
                <div className={cn("text-[11px] font-bold uppercase tracking-[0.06em]", d === today ? "text-brand-text" : "text-fg-muted")}>{weekdayShort(d)}</div>
                <div className={cn("text-sm font-bold tabular-nums", d === today ? "text-brand-text" : "text-fg")}>{Number(d.slice(8))}</div>
              </div>
            ))}
            {rows.map((a) => {
              const mine = (planned.data ?? []).filter((w) => w.athlete_membership_id === a.membership.id);
              const mins = mine.reduce((s, w) => s + (w.est_duration_s ?? 0), 0);
              return [
                <div key={a.membership.id} className="group/row sticky left-0 z-10 flex items-center gap-2.5 border-b border-line-subtle bg-surface px-3 py-2">
                  <Avatar name={a.user.name} src={a.user.avatar_url} size={30} />
                  <IconButton size="sm" label={t("Sugerir semana para {name}", { name: a.user.name })} onClick={() => setSuggest(a)} className="order-last ml-auto opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"><Sparkles /></IconButton>
                  <div className="min-w-0"><div className="truncate text-sm font-semibold">{a.user.name}</div><div className="text-[11px] text-fg-muted tabular-nums">{mine.length ? `${tn(mine.length, "{n} treino", "{n} treinos")} · ${duration(mins)}` : t("Sem treinos")}</div></div>
                </div>,
                ...days.map((d) => {
                  const key = `${a.membership.id}|${d}`;
                  const items = byCell.get(key) ?? [];
                  return (
                    <div key={key} onDragOver={(e) => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver((o) => (o === key ? null : o))} onDrop={onDrop(a.membership.id, d)}
                      className={cn("group/cell relative flex min-h-[60px] flex-col gap-1 border-b border-l border-line-subtle p-1.5", d === today && "bg-brand-soft/40", over === key && "bg-brand-soft ring-2 ring-inset ring-brand-ring")}>
                      {raceByCell.get(key) && (() => { const rc = raceByCell.get(key)!; return (
                        <span title={rc.name} className="flex items-center gap-1 rounded-[8px] bg-accent-soft px-2 py-1 text-[11px] font-bold leading-tight text-on-accent-soft ring-1 ring-inset ring-accent-line">
                          {rc.goal ? <Star className="size-3 shrink-0 fill-current" aria-label={t("Prova principal")} /> : <Flag className="size-3 shrink-0" aria-hidden />}<span className="truncate">{t("Prova")} · {rc.label}</span>
                        </span>
                      ); })()}
                      {items.map((w) => <Chip key={w.id} w={w} today={today} onOpen={() => setDetail(w.id)} />)}
                      <button type="button" onClick={() => setAssign({ athleteIds: [a.membership.id], dates: [d] })} aria-label={t("Adicionar treino para {name} em {d}", { name: a.user.name, d: dayMonth(d) })}
                        className={cn("grid h-7 w-full place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-soft hover:text-fg focus-visible:opacity-100 group-hover/cell:opacity-100", items.length === 0 && "flex-1")}>
                        <Plus className="size-4" />
                      </button>
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </Card>
      )}
      <p data-print="hide" className="text-xs text-fg-muted">{t("Dica: arraste um treino para outro dia. Clique em um espaço vazio para adicionar. Tecle ? para ver os atalhos.")}</p>

      <AssignDialog club={club} monday={monday} open={!!assign} onOpenChange={(v) => !v && setAssign(null)} prefill={assign ?? undefined} />
      <DetailDialog club={club} id={detail} onClose={() => setDetail(null)} onEdit={(id) => { setDetail(null); setEdit(id); }} />
      <EditDialog club={club} id={edit} onClose={() => setEdit(null)} />
      <SuggestWeekDialog club={club} athlete={suggest} monday={monday} onClose={() => setSuggest(null)} />
      <CopyWeekDialog club={club} monday={monday} athleteIds={rows.map((a) => a.membership.id)} open={copyOpen} onOpenChange={setCopyOpen} />
    </div>
  );
}

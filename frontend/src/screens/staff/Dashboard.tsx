/** W1 · Painel (trainer home). Route: /dashboard */
import { Link } from "@tanstack/react-router";
import {
  Activity, AlertTriangle, ArrowRight, Cake, Check, CircleCheck, Circle, Info, MessageSquare, Plus, ShieldOff, Sparkles, UserPlus, Users, X,
} from "lucide-react";
import { useState } from "react";
import { useDashboard } from "@/api/dashboard";
import type { Dashboard } from "@/api/types";
import { ComplianceTrend } from "@/components/ComplianceTrend";
import { InviteDialog } from "@/components/club/InviteDialog";
import { sportBar } from "@/components/sport";
import { StatusBadge } from "@/components/workout";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { duration, km, longDate, shortDate } from "@/lib/format";
import { Avatar, Button, ButtonLink, Card, ProgressBar, Skeleton, cn } from "@/ui";
import { FEELING } from "./planning/WorkoutDialogs";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

function Kpi({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const body = (<><div className="text-sm text-fg-muted">{label}</div><div className="font-display text-[30px] font-bold leading-tight tabular-nums [font-stretch:110%]">{value}</div>{sub && <div className="text-xs text-fg-muted">{sub}</div>}</>);
  return to ? <Link to={to} className="rounded-lg border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">{body}</Link> : <Card className="p-4">{body}</Card>;
}

const ALERT_ICON = { missed_streak: X, high_rpe: AlertTriangle, no_sync: Activity, birthday: Cake, new_member: UserPlus, plan_limit: Users, sharing_off: ShieldOff } as const;
const ALERT_TONE: Record<Dashboard["alerts"][number]["severity"], string> = {
  danger: "bg-danger-soft text-on-danger-soft", warning: "bg-warning-soft text-on-warning-soft", info: "bg-info-soft text-on-info-soft", accent: "bg-accent-soft text-on-accent-soft", brand: "bg-brand-soft text-on-brand-soft",
};

function Onboarding({ o }: { o: Dashboard["onboarding"] }) {
  const items = [
    { ok: o.colors || o.logo, label: t("Personalize o clube com logo e cores"), to: "/club/studio" },
    { ok: o.students, label: t("Convide os primeiros alunos"), to: "/club/members" },
    { ok: o.workouts, label: t("Monte a semana no planejamento"), to: "/planning" },
    { ok: o.groups, label: t("Organize os alunos em grupos"), to: "/students" },
    { ok: o.strava, label: t("Peça aos alunos para conectar o Strava"), to: "/students" },
  ];
  const done = items.filter((i) => i.ok).length;
  if (done === items.length) return null;
  return (
    <Card edge="brand" className="grid gap-3 p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 rf-text-title-md"><Sparkles className="size-5 text-accent-text" />{t("Primeiros passos")}</h2><span className="text-sm text-fg-muted">{done}/{items.length}</span></div>
      <ProgressBar value={done} max={items.length} label={t("Primeiros passos")} />
      <ul className="grid gap-1 sm:grid-cols-2">{items.map((i) => <li key={i.label}><Link to={i.to} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-soft", i.ok && "text-fg-muted line-through")}>{i.ok ? <CircleCheck className="size-5 text-success-text" /> : <Circle className="size-5 text-fg-subtle" />}{i.label}</Link></li>)}</ul>
    </Card>
  );
}

export function DashboardScreen() {
  const { me, club } = useClub();
  const d = useDashboard(club?.id);
  const [invite, setInvite] = useState(false);
  if (!club || !me) return null;
  const x = d.data;
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm text-fg-muted first-letter:uppercase">{x ? longDate(x.date) : " "}</p><h1 className="rf-text-display-sm">{t(greet())}, {me.user.name.split(" ")[0]}</h1></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" icon={<UserPlus />} onClick={() => setInvite(true)}>{t("Convidar")}</Button><ButtonLink to="/library/new" variant="secondary" icon={<Plus />}>{t("Novo treino")}</ButtonLink><ButtonLink to="/planning" icon={<ArrowRight />}>{t("Planejamento")}</ButtonLink></div>
      </header>
      {!x ? <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}<Skeleton className="h-72 sm:col-span-4" /></div> : (
        <>
          <Onboarding o={x.onboarding} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("Treinos hoje")} value={`${x.today.done}/${x.today.planned}`} sub={x.today.planned ? t("feitos até agora") : t("nenhum treino hoje")} to="/planning" />
            <Kpi label={t("Aderência da semana")} value={x.week.compliance_pct != null ? `${x.week.compliance_pct}%` : "–"} sub={t("{done} de {planned} treinos", { done: x.week.done, planned: x.week.planned })} />
            <Kpi label={t("Feedbacks para ver")} value={String(x.feedback.length)} sub={t("últimos 7 dias")} to="/feedback" />
            <Kpi label={t("Alunos ativos")} value={String(x.students)} sub={x.subscription.student_limit === null ? t("{n} incluídos no plano", { n: x.subscription.included_students }) : t("de {n} no plano", { n: x.subscription.student_limit })} to="/students" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-6">
              <Card className="grid gap-3 p-5">
                <div className="flex items-center justify-between"><h2 className="rf-text-title-md">{t("Hoje")}</h2><Link to="/planning" className="text-sm font-semibold text-brand-text">{t("Ver semana")}</Link></div>
                {x.today.items.length === 0 ? <p className="text-fg-muted">{t("Nenhum treino marcado para hoje.")}</p> : (
                  <ul className="divide-y divide-line-subtle">
                    {x.today.items.map(({ workout: w, athlete: a }) => (
                      <li key={w.id} className="flex items-center gap-3 py-2.5">
                        <Avatar name={a.user.name} src={a.user.avatar_url} size={34} />
                        <div className="min-w-0 flex-1"><Link to="/students/$id" params={{ id: a.membership_id }} className="block truncate font-semibold hover:underline">{a.user.name}</Link>
                          <span className="flex items-center gap-1.5 text-sm text-fg-muted"><i className={cn("h-3 w-1 rounded-full", sportBar[w.sport])} /><span className="truncate">{w.title}</span>{w.est_duration_s ? <span className="shrink-0">· {duration(w.est_duration_s)}</span> : null}</span></div>
                        {w.completion ? <div className="grid justify-items-end gap-0.5"><StatusBadge status={w.completion.status} />{w.completion.feeling && <span className="text-xs text-fg-muted">{t(FEELING[w.completion.feeling])}{w.completion.rpe ? ` · ${t("PSE {n}", { n: w.completion.rpe })}` : ""}</span>}</div> : <span className="text-xs font-semibold text-fg-subtle">{t("Ainda não")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="grid gap-4 p-5">
                <div className="flex items-baseline justify-between gap-3"><h2 className="rf-text-title-md">{t("Aderência por semana")}</h2><span className="text-sm text-fg-muted">{t("últimas 8 semanas · todos os alunos")}</span></div>
                <ComplianceTrend data={x.compliance_trend} />
                <div className="flex flex-wrap gap-6 border-t border-line-subtle pt-3 text-sm"><span className="text-fg-muted">{t("Esta semana:")} <b className="text-fg tabular-nums">{duration(x.week.duration_s)}</b> {t("planejadas")}{x.week.distance_m ? <> · <b className="text-fg tabular-nums">{km(x.week.distance_m)} km</b></> : null}</span></div>
              </Card>
            </div>
            <div className="grid content-start gap-6">
              <Card className="grid gap-3 p-5">
                <h2 className="rf-text-title-md">{t("Atenção")}</h2>
                {x.alerts.length === 0 ? <p className="flex items-center gap-2 text-fg-muted"><Check className="size-5 text-success-text" />{t("Tudo em dia por aqui.")}</p> : (
                  <ul className="grid gap-2">
                    {x.alerts.map((al, i) => { const I = ALERT_ICON[al.kind] ?? Info; return (
                      <li key={i}><Link to={al.link} className="flex items-start gap-3 rounded-md p-1.5 hover:bg-soft"><span className={cn("grid size-8 shrink-0 place-items-center rounded-full", ALERT_TONE[al.severity])}><I className="size-4" /></span><span className="pt-1 text-sm">{al.text}</span></Link></li>
                    ); })}
                  </ul>
                )}
              </Card>
              <Card className="grid gap-3 p-5">
                <div className="flex items-center justify-between"><h2 className="rf-text-title-md">{t("Feedbacks")}</h2><Link to="/feedback" className="text-sm font-semibold text-brand-text">{t("Abrir caixa")}</Link></div>
                {x.feedback.length === 0 ? <p className="text-fg-muted">{t("Nenhum feedback novo.")}</p> : (
                  <ul className="grid gap-3">
                    {x.feedback.map(({ workout: w, athlete: a, last_comment }) => (
                      <li key={w.id}><Link to="/feedback" search={{ workout: w.id }} className="flex gap-3 rounded-md p-1 hover:bg-soft">
                        <Avatar name={a.user.name} size={32} />
                        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{a.user.name}</span>{w.unread_count > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-on-danger">{w.unread_count}</span>}<span className="ml-auto shrink-0 text-xs text-fg-muted">{shortDate(w.date)}</span></div>
                          <p className="line-clamp-2 text-sm text-fg-muted"><MessageSquare className="mr-1 inline size-3.5" />{last_comment?.body ?? w.completion?.comment ?? w.title}</p></div>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
      <InviteDialog club={club} open={invite} onOpenChange={setInvite} />
    </div>
  );
}

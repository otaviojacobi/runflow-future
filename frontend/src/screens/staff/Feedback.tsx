/** W8 · Feedbacks: inbox of completions and conversations, with the thread beside it. Route: /feedback */
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CheckCheck, Inbox, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useFeedback, useMarkAllRead, useMarkFeedbackRead } from "@/api/feedback";
import type { FeedbackFilter, FeedbackItem } from "@/api/types";
import { usePlannedDetail } from "@/api/workouts";
import { StravaAttribution } from "@/components/strava";
import { AiFeedbackSummaryCard } from "@/components/AiAssist";
import { SportChip } from "@/components/sport";
import { Thread } from "@/components/Thread";
import { IntensityProfile, Stat, StatusBadge } from "@/components/workout";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago, distance, duration, pace, shortDate } from "@/lib/format";
import { Avatar, Button, Card, EmptyState, PageHeader, Skeleton, cn, toast } from "@/ui";
import { FEELING } from "./planning/WorkoutDialogs";

const QUICK = ["Ótimo treino! 💪", "Boa! Segue assim.", "Vamos ajustar o próximo treino.", "Descansa bem hoje.", "Me conta mais?"];

function Detail({ item, clubId, meId, onBack }: { item: FeedbackItem; clubId: string; meId: string; onBack: () => void }) {
  const d = usePlannedDetail(clubId, item.workout.id);
  const w = d.data;
  const c = item.workout.completion;
  // Opening it reads it: the item and the Feedbacks count clear, even before (or without) a reply.
  const markRead = useMarkFeedbackRead(clubId);
  useEffect(() => { if (item.unread) markRead.mutate(item.workout.id); }, [item.workout.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid content-start gap-4">
      <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm font-semibold text-fg-muted lg:hidden"><ArrowLeft className="size-4" />{t("Voltar")}</button>
      <div className="flex items-center gap-3">
        <Avatar name={item.athlete.user.name} src={item.athlete.user.avatar_url} size={44} />
        <div className="min-w-0 flex-1"><Link to="/students/$id" params={{ id: item.athlete.membership_id }} className="block truncate font-bold hover:underline">{item.athlete.user.name}</Link><span className="text-sm text-fg-muted">{item.workout.title} · {shortDate(item.workout.date)}</span></div>
        <SportChip sport={item.workout.sport} size="sm" />
      </div>
      <Card className="grid gap-3 p-4">
        <IntensityProfile structure={item.workout.structure} sport={item.workout.sport} height={40} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {c ? <StatusBadge status={c.status} /> : <StatusBadge status="planned" />}
          {c?.compliance_pct != null && <Stat size="sm" value={`${c.compliance_pct}%`} label={t("Cumprido")} />}
          {c?.rpe && <Stat size="sm" value={String(c.rpe)} unit="/10" label={t("PSE")} />}
          {c?.feeling && <Stat size="sm" value={t(FEELING[c.feeling])} label={t("Sensação")} />}
          {w?.activity?.distance_m && <Stat size="sm" value={distance(w.activity.distance_m)} label={t("Distância")} />}
          {w?.activity && <Stat size="sm" value={duration(w.activity.duration_s)} label={t("Tempo")} />}
          {w?.activity?.avg_pace_s_per_km && <Stat size="sm" value={pace(w.activity.avg_pace_s_per_km)} unit="/km" label={t("Pace")} />}
        </div>
        {w?.activity && (w.activity.source === "strava" ? <StravaAttribution externalId={w.activity.external_id} /> : <p className="text-xs text-fg-muted">{t("Atividade registrada manualmente")}</p>)}
        {c?.comment && <blockquote className="border-l-2 border-brand-line pl-3 italic text-fg-muted">“{c.comment}”</blockquote>}
      </Card>
      <Card className="p-4"><Thread clubId={clubId} workoutId={item.workout.id} meMembershipId={meId} quickReplies={QUICK} placeholder={t("Responder para {name}", { name: item.athlete.user.name.split(" ")[0]! })} /></Card>
    </div>
  );
}

export function FeedbackScreen() {
  const { club, ctx } = useClub();
  // `?workout=<id>` (a notification, the dashboard) opens that conversation; "Todos" so it's there even if answered.
  const target = useRouterState({ select: (s) => (s.location.search as { workout?: string }).workout });
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FeedbackFilter>(target ? "all" : "needs_reply");
  const [sel, setSel] = useState<string | null>(target ?? null);
  useEffect(() => { if (target) { setFilter("all"); setSel(target); } }, [target]);
  const q = useFeedback(club?.id, filter);
  const readAll = useMarkAllRead(club?.id ?? "");
  const items = q.data?.items ?? [];
  const current = items.find((i) => i.workout.id === sel) ?? null;
  useEffect(() => { if (!sel && items[0] && window.matchMedia("(min-width: 1024px)").matches) setSel(items[0].workout.id); }, [items, sel]);
  const back = () => { setSel(null); if (target) navigate({ to: "/feedback", search: {}, replace: true }); };
  if (!club || !ctx) return null;
  const tabs: { v: FeedbackFilter; l: string }[] = [{ v: "needs_reply", l: "Para responder" }, { v: "unread", l: "Não lidos" }, { v: "flagged", l: "Sinais de alerta" }, { v: "all", l: "Todos" }];
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader title={t("Feedbacks")} subtitle={t("Como os alunos estão se sentindo nos últimos 30 dias.")} actions={<Button variant="secondary" icon={<CheckCheck />} loading={readAll.isPending} onClick={() => readAll.mutate(undefined, { onSuccess: () => toast.success(t("Tudo marcado como lido")) })}>{t("Marcar tudo como lido")}</Button>} />
      {club && <AiFeedbackSummaryCard clubId={club.id} />}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("Filtro")}>
        {tabs.map((x) => (
          <button key={x.v} role="tab" aria-selected={filter === x.v} onClick={() => { setFilter(x.v); setSel(null); }} className={cn("inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold", filter === x.v ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
            {t(x.l)}{q.data && <span className="rounded-full bg-surface px-1.5 text-xs tabular-nums text-fg">{q.data.counts[x.v]}</span>}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className={cn("max-h-[calc(100dvh-240px)] overflow-y-auto p-1.5", current && "hidden lg:block")}>
          {q.isPending ? <div className="grid gap-2 p-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div> : items.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t("Caixa em dia")}>{t("Nenhum feedback neste filtro.")}</EmptyState>
          ) : (
            <ul className="grid gap-0.5">
              {items.map((i) => (
                <li key={i.workout.id}>
                  <button onClick={() => setSel(i.workout.id)} className={cn("flex w-full gap-3 rounded-md p-2.5 text-left transition-colors", sel === i.workout.id ? "bg-brand-soft" : "hover:bg-soft")}>
                    <Avatar name={i.athlete.user.name} src={i.athlete.user.avatar_url} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate font-semibold">{i.athlete.user.name}</span>{i.flagged && <AlertTriangle className="size-3.5 shrink-0 text-warning-text" aria-label={t("Sinal de alerta")} />}<span className="ml-auto shrink-0 text-xs text-fg-muted">{i.last_comment ? ago(i.last_comment.created_at) : shortDate(i.workout.date)}</span></span>
                      <span className="block truncate text-xs text-fg-muted">{i.workout.title}{i.workout.completion?.feeling ? ` · ${t(FEELING[i.workout.completion.feeling])}` : ""}{i.workout.completion?.rpe ? ` · ${t("PSE {n}", { n: i.workout.completion.rpe })}` : ""}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-sm"><MessageSquare className="size-3.5 shrink-0 text-fg-subtle" /><span className={cn("min-w-0 truncate", (i.unread ?? i.workout.unread_count > 0) ? "font-semibold text-fg" : "text-fg-muted")}>{i.last_comment?.body ?? i.workout.completion?.comment ?? t("Sem comentário")}</span>{(i.unread ?? i.workout.unread_count > 0) && <span className="ml-auto size-2 shrink-0 rounded-full bg-brand" aria-label={t("Não lido")} />}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {current ? <Detail key={current.workout.id} item={current} clubId={club.id} meId={ctx.membership.id} onBack={back} /> : <Card className="hidden lg:block"><EmptyState icon={<MessageSquare />} title={t("Escolha uma conversa")} /></Card>}
      </div>
    </div>
  );
}

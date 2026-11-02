/** W11 · Notificações: list, unread filter, mark all read, deep links (switching club when needed). Route: /notifications */
import { useNavigate } from "@tanstack/react-router";
import { Bell, CalendarCheck, CheckCheck, ClipboardList, CreditCard, Megaphone, MessageCircle, MessageSquare, Pencil, UserPlus, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarkNotificationsRead, useNotifications } from "@/api/account";
import type { AppNotification, NotificationKind } from "@/api/types";
import { t } from "@/i18n";
import { selectClub, useClub } from "@/lib/club";
import { addDays, ago, localDate, today as todayFn } from "@/lib/format";
import { Button, Card, EmptyState, PageHeader, Segmented, Skeleton, cn } from "@/ui";

const KIND: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  workout_assigned: { icon: ClipboardList, tone: "bg-brand-soft text-on-brand-soft" },
  workout_changed: { icon: Pencil, tone: "bg-info-soft text-on-info-soft" },
  week_released: { icon: CalendarCheck, tone: "bg-success-soft text-on-success-soft" },
  comment: { icon: MessageSquare, tone: "bg-info-soft text-on-info-soft" },
  feedback: { icon: MessageSquare, tone: "bg-accent-soft text-on-accent-soft" },
  member_joined: { icon: UserPlus, tone: "bg-success-soft text-on-success-soft" },
  billing: { icon: CreditCard, tone: "bg-warning-soft text-on-warning-soft" },
  message: { icon: MessageCircle, tone: "bg-brand-soft text-on-brand-soft" },
  announcement: { icon: Megaphone, tone: "bg-accent-soft text-on-accent-soft" },
};

function groupOf(n: AppNotification, today: string): string {
  const d = localDate(n.created_at);
  if (d === today) return "Hoje";
  if (d === addDays(today, -1)) return "Ontem";
  if (d >= addDays(today, -6)) return "Últimos 7 dias";
  return "Anteriores";
}

export function NotificationsScreen() {
  const { me, club } = useClub();
  const navigate = useNavigate();
  const q = useNotifications();
  const read = useMarkNotificationsRead();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const today = todayFn(club?.timezone);
  const items = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const shown = filter === "unread" ? items.filter((n) => !n.read_at) : items;
  const groups = useMemo(() => {
    const m = new Map<string, AppNotification[]>();
    for (const n of shown) { const g = groupOf(n, today); m.set(g, [...(m.get(g) ?? []), n]); }
    return [...m.entries()];
  }, [shown, today]);
  const unread = items.filter((n) => !n.read_at).length;
  const clubName = (id: string | null) => (id && me && me.memberships.length > 1 ? me.memberships.find((m) => m.club.id === id)?.club.name : null);

  const open = (n: AppNotification) => {
    if (!n.read_at) read.mutate([n.id]);
    if (n.club_id && n.club_id !== club?.id) { const m = me?.memberships.find((x) => x.club.id === n.club_id); if (m) selectClub(m); }
    if (n.link) {
      const [to, query] = n.link.split("?");
      navigate({ to, search: query ? Object.fromEntries(new URLSearchParams(query)) : undefined } as never);
    }
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <PageHeader title={t("Notificações")} subtitle={unread ? t("{n} não lidas", { n: unread }) : t("Tudo lido por aqui")}
        actions={<Button variant="secondary" icon={<CheckCheck />} disabled={!unread} loading={read.isPending} onClick={() => read.mutate(undefined)}>{t("Marcar todas como lidas")}</Button>} />
      <Segmented label={t("Filtro")} value={filter} onChange={setFilter} options={[{ value: "all", label: t("Todas") }, { value: "unread", label: t("Não lidas") }]} className="w-fit" />
      {q.isPending ? <div className="grid gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div> : shown.length === 0 ? (
        <Card><EmptyState icon={<Bell />} title={filter === "unread" ? t("Nenhuma notificação não lida") : t("Nenhuma notificação ainda")}>{t("Treinos novos, comentários e avisos de aulas aparecem aqui.")}</EmptyState></Card>
      ) : groups.map(([g, list]) => (
        <section key={g} className="grid gap-2" aria-labelledby={`g-${g}`}>
          <h2 id={`g-${g}`} className="rf-text-overline text-fg-muted">{t(g)}</h2>
          <Card className="divide-y divide-line-subtle overflow-hidden">
            {list.map((n) => {
              const k = KIND[n.kind] ?? KIND.workout_changed;
              const I = k.icon;
              const other = n.club_id !== club?.id ? clubName(n.club_id) : null;
              return (
                <button key={n.id} type="button" onClick={() => open(n)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft focus-visible:bg-soft focus-visible:outline-none", !n.read_at && "bg-brand-soft/30")}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", k.tone)}><I className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.read_at ? "font-medium" : "font-semibold")}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-sm text-fg-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-xs text-fg-subtle">{ago(n.created_at)}{other ? ` · ${other}` : ""}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand" aria-label={t("Não lida")} />}
                </button>
              );
            })}
          </Card>
        </section>
      ))}
      {q.hasNextPage && <Button variant="ghost" className="justify-self-center" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{t("Carregar mais")}</Button>}
    </div>
  );
}

/**
 * W11 · Notificações (everyone, from the bell): newest first in Hoje / Ontem / Últimos 7 dias / Anteriores, unread
 * filter, mark all read, pull to refresh, more pages as you scroll. Tapping one marks it read and follows its link:
 * into the app when a screen here opens that path (switching to the notification's club first), else on the web
 * (desktop tools such as Plano e cobrança).
 */
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, SectionList, StyleSheet, View } from "react-native";
import { meKey } from "@/api/me";
import { useMarkNotificationsRead, useNotifications } from "@/api/notifications";
import type { AppNotification, NotificationKind } from "@/api/types";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { addDays, ago, localDate, today as todayFn } from "@/lib/format";
import { useAppLink } from "@/lib/links";
import { openOnWeb } from "@/lib/web";
import { queryClient } from "@/queryClient";
import { alpha, toneColors, weight, type Tone } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Segmented, Skeleton, Spinner, Text, type Icon } from "@/ui";
import {
  Bell, CalendarCheck, CalendarX, CheckCheck, CircleAlert, ClipboardList, CreditCard, ExternalLink, Megaphone, MessageCircle, MessageSquare, Pencil, Ticket, UserPlus, Watch,
} from "@/ui/icons";

const KIND: Record<NotificationKind, { icon: Icon; tone: Tone }> = {
  workout_assigned: { icon: ClipboardList, tone: "brand" },
  workout_changed: { icon: Pencil, tone: "info" },
  week_released: { icon: CalendarCheck, tone: "success" },
  comment: { icon: MessageSquare, tone: "info" },
  feedback: { icon: MessageSquare, tone: "accent" },
  member_joined: { icon: UserPlus, tone: "success" },
  billing: { icon: CreditCard, tone: "warning" },
  message: { icon: MessageCircle, tone: "brand" },
  announcement: { icon: Megaphone, tone: "accent" },
  class_cancelled: { icon: CalendarX, tone: "danger" },
  waitlist_promoted: { icon: Ticket, tone: "success" },
  activity_synced: { icon: Watch, tone: "success" },
};
const GROUPS = ["Hoje", "Ontem", "Últimos 7 dias", "Anteriores"] as const;
function groupOf(n: AppNotification, today: string, tz: string): (typeof GROUPS)[number] {
  const d = localDate(n.created_at, tz);
  if (d === today) return "Hoje";
  if (d === addDays(today, -1)) return "Ontem";
  if (d >= addDays(today, -6)) return "Últimos 7 dias";
  return "Anteriores";
}

export default function NotificationsScreen() {
  const { theme } = useTheme();
  const { me, club } = useClub();
  const q = useNotifications();
  const read = useMarkNotificationsRead();
  const appLink = useAppLink();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [pulling, setPulling] = useState(false);
  const tz = club?.timezone ?? "America/Sao_Paulo";
  const today = todayFn(tz);
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const shown = filter === "unread" ? items.filter((n) => !n.read_at) : items;
  const sections = GROUPS.map((g) => ({ title: g, data: shown.filter((n) => groupOf(n, today, tz) === g) })).filter((s) => s.data.length > 0);
  const loadedUnread = items.filter((n) => !n.read_at).length;
  // Everything loaded: count what's here; else the account's count (more unread may sit on later pages).
  const unread = q.hasNextPage ? Math.max(loadedUnread, me?.unread_notifications ?? 0) : loadedUnread;
  const clubName = (id: string | null) => (id && me && me.memberships.length > 1 ? me.memberships.find((m) => m.club.id === id)?.club.name ?? null : null);

  const open = (n: AppNotification) => {
    if (!n.read_at) read.mutate([n.id]);
    const target = appLink(n.link);
    if (target) {
      const m = n.club_id && n.club_id !== club?.id ? me?.memberships.find((x) => x.club.id === n.club_id) : null;
      if (m) selectClub(m);
      // After a club switch the tabs re-render for that club's role first.
      setTimeout(() => router.push(target), 0);
    } else if (n.link) void openOnWeb(n.link);
  };
  const refresh = async () => {
    setPulling(true);
    await Promise.all([q.refetch(), queryClient.invalidateQueries({ queryKey: meKey })]).catch(() => undefined);
    setPulling(false);
  };

  const header = (
    <View style={{ gap: theme.space[4], paddingBottom: theme.space[2] }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Text variant="bodyMd" tone="muted" style={styles.flex} accessibilityLiveRegion="polite">
          {q.isPending ? " " : unread ? tn(unread, "{n} não lida", "{n} não lidas") : t("Tudo lido por aqui")}
        </Text>
        <Button variant="secondary" size="sm" icon={CheckCheck} disabled={!unread} onPress={() => read.mutate(undefined)}>{t("Marcar todas como lidas")}</Button>
      </View>
      <Segmented size="sm" label={t("Filtro")} value={filter} onChange={setFilter} options={[{ value: "all", label: t("Todas") }, { value: "unread", label: t("Não lidas") }]} />
    </View>
  );
  const empty = q.isPending ? (
    <View style={{ gap: theme.space[2] }}>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[16] }} />)}</View>
  ) : q.error ? (
    <Card>
      <EmptyState icon={CircleAlert} title={q.error instanceof ApiError ? q.error.title : t("Algo deu errado")}
        action={<Button variant="secondary" loading={q.isFetching} onPress={() => void q.refetch()}>{t("Tentar de novo")}</Button>}>
        {q.error instanceof ApiError ? q.error.detail : t("Tente novamente em instantes.")}
      </EmptyState>
    </Card>
  ) : (
    <Card>
      <EmptyState icon={Bell} title={filter === "unread" ? t("Nenhuma notificação não lida") : t("Nenhuma notificação ainda")}>
        {t("Treinos novos, comentários, mensagens e avisos do clube aparecem aqui.")}
      </EmptyState>
    </Card>
  );

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: theme.color.canvas }}
      contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[5], paddingBottom: theme.space[8], width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center" }}
      sections={sections}
      keyExtractor={(n) => n.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      renderSectionHeader={({ section }) => (
        <Text variant="overline" tone="subtle" accessibilityRole="header" style={{ paddingHorizontal: theme.space[1], paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>{t(section.title)}</Text>
      )}
      renderItem={({ item, index, section }) => (
        <Row n={item} first={index === 0} last={index === section.data.length - 1} club={item.club_id !== club?.id ? clubName(item.club_id) : null}
          web={!!item.link && !appLink(item.link)} onPress={() => open(item)} />
      )}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
      ListFooterComponent={q.isFetchingNextPage ? <View style={{ paddingVertical: theme.space[4] }}><Spinner delay={0} /></View> : undefined}
      refreshing={pulling}
      onRefresh={refresh}
    />
  );
}

function Row({ n, first, last, club, web, onPress }: { n: AppNotification; first: boolean; last: boolean; club: string | null; web: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const k = KIND[n.kind] ?? KIND.workout_changed;
  const tc = toneColors(theme, k.tone);
  const I = k.icon;
  const unread = !n.read_at;
  const when = ago(n.created_at) + (club ? ` · ${club}` : "");
  const shape = {
    borderTopWidth: first ? 1 : StyleSheet.hairlineWidth, borderTopColor: first ? c.line : c.lineSubtle, borderBottomWidth: last ? 1 : 0,
    borderTopLeftRadius: first ? theme.radius.lg : 0, borderTopRightRadius: first ? theme.radius.lg : 0,
    borderBottomLeftRadius: last ? theme.radius.lg : 0, borderBottomRightRadius: last ? theme.radius.lg : 0,
  };
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      accessibilityLabel={[unread ? t("Não lida") : null, n.title, n.body, when].filter(Boolean).join(". ")}
      accessibilityHint={web ? t("Abre no Runflow pela web") : undefined}
      style={({ pressed }) => [styles.item, shape, {
        gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], minHeight: theme.size.touchMin + theme.space[4],
        borderLeftColor: c.line, borderRightColor: c.line, borderBottomColor: c.line,
        backgroundColor: pressed ? c.soft : unread ? alpha(c.brand.subtle, 0.4) : c.surface,
      }]}>
      <View style={[styles.center, { width: theme.space[10] - theme.space[1], height: theme.space[10] - theme.space[1], borderRadius: theme.radius.full, backgroundColor: tc.softBg }]}>
        <I size={theme.size.iconSm} color={tc.softFg} aria-hidden />
      </View>
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="bodySm" style={{ fontWeight: weight(unread ? "bold" : "medium") }}>{n.title}</Text>
        {n.body ? <Text variant="bodySm" tone="muted" numberOfLines={2}>{n.body}</Text> : null}
        <View style={[styles.row, { gap: theme.space[1] }]}>
          <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.shrink}>{when}</Text>
          {web && <ExternalLink size={theme.size.iconSm - 4} color={c.fgSubtle} aria-hidden />}
        </View>
      </View>
      {unread && <View style={{ width: theme.space[2] + theme.space["0.5"], height: theme.space[2] + theme.space["0.5"], marginTop: theme.space["1.5"], borderRadius: theme.radius.full, backgroundColor: c.brand.solid }} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  item: { flexDirection: "row", alignItems: "flex-start", borderLeftWidth: 1, borderRightWidth: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
});

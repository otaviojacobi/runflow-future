/**
 * M10 / W13 · Mensagens (students' tab; staff reach it from "Mais").
 * Students: their one conversation with the club staff, then the mural (announcements seen on screen count as read).
 * Staff: every student's conversation (unread first, search) and the mural (receipts, "Novo aviso").
 * Open screens poll (the contract has no live channel); pull to refresh. `?c=<id>` (notification links) opens that
 * conversation, `?tab=mural` the mural.
 */
import { router, useIsFocused, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, RefreshControl, StyleSheet, View, type ListViewToken } from "react-native";
import { useAnnouncements, useConversations, useGroups, useMarkAnnouncementsRead, useOpenConversation } from "@/api/messages";
import type { Announcement, ConversationSummary, MembershipContext } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { AnnouncementCard } from "@/components/messages/AnnouncementCard";
import { ConversationRow } from "@/components/messages/ConversationRow";
import { usePullToRefresh, useRefetchOnFocus } from "@/components/messages/hooks";
import { CardListItem, LoadError, SearchField, SectionTitle } from "@/components/messages/parts";
import { BackHeader, ShellHeader, backFallback } from "@/components/shell/Shell";
import { fold, previewOf, staffPlural } from "@/components/messages/util";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, ButtonLink, Card, EmptyState, PageHeader, Segmented, Skeleton, Text, toast } from "@/ui";
import { Megaphone, Plus, Search, Users } from "@/ui/icons";

type Tab = "chats" | "mural";

export default function MessagesScreen() {
  const { ctx, isStaff } = useClub();
  const { c, tab } = useLocalSearchParams<{ c?: string; tab?: string }>();
  const navigation = useNavigation();
  // A notification's link (/messages?c=<id>): open the conversation on top of this screen, once.
  useEffect(() => {
    if (!c) return;
    navigation.setParams({ c: undefined } as never);
    router.push({ pathname: "/messages/[id]", params: { id: c } });
  }, [c, navigation]);
  if (!ctx) return null;
  // The tab's header is off inside the Mensagens stack, so the list draws the shell's bar itself.
  return (
    <View style={styles.fill}>
      {isStaff ? <BackHeader title={t("Mensagens")} fallback={backFallback("messages", ctx.membership.role)} /> : <ShellHeader />}
      {isStaff ? <StaffMessages ctx={ctx} tabParam={tab} /> : <StudentMessages ctx={ctx} />}
    </View>
  );
}

/** FlatList padding = the Screen component's gutters and rhythm. */
function useListStyle() {
  const { theme } = useTheme();
  return {
    contentContainerStyle: { paddingHorizontal: theme.space[4], paddingTop: theme.space[5], paddingBottom: theme.space[8], width: "100%" as const, maxWidth: theme.size.readingMax, alignSelf: "center" as const },
    refreshColors: { tintColor: theme.color.brand.solid, colors: [theme.color.brand.solid], progressBackgroundColor: theme.color.surface },
  };
}
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

// ---------------------------------------------------------------- students

function StudentMessages({ ctx }: { ctx: MembershipContext }) {
  const { theme } = useTheme();
  const club = ctx.club;
  const focused = useIsFocused();
  const convs = useConversations(club.id, focused);
  const mural = useAnnouncements(club.id, focused);
  const markRead = useMarkAnnouncementsRead(club.id);
  useRefetchOnFocus(focused, convs.refetch, mural.refetch);
  const pull = usePullToRefresh(convs.refetch, mural.refetch);
  const list = useListStyle();
  const conv = convs.data?.[0];
  const items = mural.data ?? [];

  // Announcements count as read once they've been on screen for a moment (the "Novo" badge shows on arrival).
  const [visible, setVisible] = useState<string[]>([]);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => setVisible(viewableItems.map((v) => (v.item as Announcement).id))).current;
  const toMark = items.filter((a) => !a.read_at && visible.includes(a.id)).map((a) => a.id).join(",");
  useEffect(() => {
    if (!focused || !toMark) return;
    const timer = setTimeout(() => markRead.mutate(toMark.split(",")), 2000);
    return () => clearTimeout(timer);
  }, [focused, toMark]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = () => conv?.id && router.push({ pathname: "/messages/[id]", params: { id: conv.id } });
  const staffNote = club.trainer_label === "professor" ? t("Todos os professores do clube veem esta conversa.") : t("Todos os treinadores do clube veem esta conversa.");
  const header = (
    <View style={{ gap: theme.space[5], marginBottom: theme.space[3] }}>
      <PageHeader title={t("Mensagens")} subtitle={t("Fale com a equipe e acompanhe os avisos do clube.")} />
      <View style={{ gap: theme.space[2] }}>
        <SectionTitle>{staffPlural(club)}</SectionTitle>
        {conv?.id ? (
          <Card style={{ padding: theme.space[1] }}>
            <ConversationRow avatar={<ClubLogo club={club} branding={ctx.branding} size={theme.space[10]} />} title={t("Equipe {club}", { club: club.name })}
              preview={conv.last_message ? previewOf(conv.last_message, ctx.membership.id, true) : t("Mande uma mensagem para a equipe")}
              time={conv.last_message_at ? ago(conv.last_message_at) : null} unread={conv.unread_count} onPress={openChat} chevron
              style={{ borderRadius: theme.radius.md }} />
          </Card>
        ) : convs.error ? (
          <LoadError error={convs.error} retrying={convs.isFetching} retry={() => void convs.refetch()} />
        ) : (
          <Skeleton style={{ height: theme.size.touchMin + theme.space[5] + theme.space[2], borderRadius: theme.radius.lg }} />
        )}
        <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.space[1] }}>{staffNote}</Text>
      </View>
      <SectionTitle>{t("Mural")}</SectionTitle>
    </View>
  );
  return (
    <FlatList
      data={items}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={header}
      ItemSeparatorComponent={Gap}
      renderItem={({ item }) => <AnnouncementCard a={item} staff={false} onPress={() => router.push({ pathname: "/messages/mural/[id]", params: { id: item.id } })} />}
      ListEmptyComponent={mural.error ? <LoadError error={mural.error} retrying={mural.isFetching} retry={() => void mural.refetch()} />
        : mural.isPending ? <MuralSkeleton />
        : <Card><EmptyState icon={Megaphone} title={t("Nenhum aviso no mural")}>{t("Os avisos da equipe aparecem aqui.")}</EmptyState></Card>}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      style={{ backgroundColor: theme.color.canvas }}
      contentContainerStyle={list.contentContainerStyle}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} {...list.refreshColors} />}
    />
  );
}

// ---------------------------------------------------------------- staff

function StaffMessages({ ctx, tabParam }: { ctx: MembershipContext; tabParam?: string }) {
  const { theme } = useTheme();
  const club = ctx.club;
  const [tab, setTab] = useState<Tab>(tabParam === "mural" ? "mural" : "chats");
  useEffect(() => { if (tabParam === "mural" || tabParam === "chats") setTab(tabParam); }, [tabParam]);
  const focused = useIsFocused();
  const convs = useConversations(club.id, focused && tab === "chats");
  const mural = useAnnouncements(club.id, focused && tab === "mural");
  const groups = useGroups(club.id);
  useRefetchOnFocus(focused, tab === "chats" ? convs.refetch : mural.refetch);
  const pull = usePullToRefresh(convs.refetch, mural.refetch);
  const list = useListStyle();
  const [q, setQ] = useState("");

  const all = convs.data ?? [];
  const unread = all.reduce((n, x) => n + x.unread_count, 0);
  // Unread first, then the API's order (newest conversation first, then the rest by name).
  const rows = useMemo(() => {
    const needle = fold(q);
    const shown = needle ? all.filter((x) => fold(x.student.user.name).includes(needle)) : all;
    return [...shown].sort((a, b) => Number(b.unread_count > 0) - Number(a.unread_count > 0));
  }, [all, q]);

  const segmented = (
    <Segmented<Tab> label={t("Seção")} value={tab} onChange={setTab} style={styles.stretch}
      options={[{ value: "chats", label: unread ? t("Conversas ({n})", { n: unread }) : t("Conversas") }, { value: "mural", label: t("Mural") }]} />
  );
  const refresh = <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} {...list.refreshColors} />;

  if (tab === "mural") {
    return (
      <FlatList
        key="mural"
        data={mural.data ?? []}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={(
          <View style={{ gap: theme.space[4], marginBottom: theme.space[4] }}>
            {segmented}
            <ButtonLink href="/messages/compose" icon={Plus} variant="primary">{t("Novo aviso")}</ButtonLink>
          </View>
        )}
        ItemSeparatorComponent={Gap}
        renderItem={({ item }) => <AnnouncementCard a={item} staff groups={groups.data} onPress={() => router.push({ pathname: "/messages/mural/[id]", params: { id: item.id } })} />}
        ListEmptyComponent={mural.error ? <LoadError error={mural.error} retrying={mural.isFetching} retry={() => void mural.refetch()} />
          : mural.isPending ? <MuralSkeleton />
          : <Card><EmptyState icon={Megaphone} title={t("Nenhum aviso no mural")}>{t("Avisos chegam para todo o clube ou só para alguns grupos, com confirmação de leitura.")}</EmptyState></Card>}
        style={{ backgroundColor: theme.color.canvas }}
        contentContainerStyle={list.contentContainerStyle}
        refreshControl={refresh}
      />
    );
  }
  return (
    <FlatList
      key="chats"
      data={rows}
      keyExtractor={(x) => x.student_membership_id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={(
        <View style={{ gap: theme.space[4], marginBottom: theme.space[4] }}>
          {segmented}
          <View style={{ gap: theme.space[2] }}>
            <SearchField value={q} onChange={setQ} label={t("Buscar aluno")} />
            <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.space[1] }}>{t("Toda a equipe do clube vê estas conversas.")}</Text>
          </View>
        </View>
      )}
      renderItem={({ item, index }) => (
        <CardListItem first={index === 0} last={index === rows.length - 1} inset={theme.space[3] + theme.space[10] + theme.space[3]}>
          <StudentRow c={item} ctx={ctx} />
        </CardListItem>
      )}
      ListEmptyComponent={convs.error ? <LoadError error={convs.error} retrying={convs.isFetching} retry={() => void convs.refetch()} />
        : convs.isPending ? <RowsSkeleton />
        : q ? <Card><EmptyState icon={Search} title={t("Nenhum aluno encontrado")}>{t("Confira o nome digitado.")}</EmptyState></Card>
        : <Card><EmptyState icon={Users} title={t("Nenhum aluno ainda")}>{t("Quando alunos entrarem no clube, as conversas com eles aparecem aqui.")}</EmptyState></Card>}
      style={{ backgroundColor: theme.color.canvas }}
      contentContainerStyle={list.contentContainerStyle}
      refreshControl={refresh}
    />
  );
}

/** A student in the staff list: opens the conversation, creating it on the first message (`id: null`). */
function StudentRow({ c, ctx }: { c: ConversationSummary; ctx: MembershipContext }) {
  const { theme } = useTheme();
  const open = useOpenConversation(ctx.club.id);
  const go = (id: string) => router.push({ pathname: "/messages/[id]", params: { id } });
  const press = () => {
    if (c.id) return go(c.id);
    open.mutate(c.student_membership_id, { onSuccess: (r) => r.id && go(r.id), onError: toast.error });
  };
  return (
    <ConversationRow avatar={<Avatar name={c.student.user.name} src={c.student.user.avatar_url} size={theme.space[10]} />} title={c.student.user.name}
      preview={c.last_message ? previewOf(c.last_message, ctx.membership.id) : t("Começar conversa")}
      time={c.last_message_at ? ago(c.last_message_at) : null} unread={c.unread_count} busy={open.isPending} onPress={press}
      style={{ borderRadius: theme.radius.md }} />
  );
}

function Gap() {
  const { theme } = useTheme();
  return <View style={{ height: theme.space[3] }} />;
}

function MuralSkeleton(): ReactElement {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      {[0, 1].map((i) => <Skeleton key={i} style={{ height: theme.space[16] * 2, borderRadius: theme.radius.lg }} />)}
    </View>
  );
}

function RowsSkeleton(): ReactElement {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: theme.size.touchMin + theme.space[5], borderRadius: theme.radius.md }} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stretch: { alignSelf: "stretch" },
});

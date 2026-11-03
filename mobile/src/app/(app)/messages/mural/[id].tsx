/**
 * M10 / W13 · an announcement from the mural, whole. Students: reading it marks it read. Staff: who it's for, the
 * receipts (who read and when, who hasn't yet), and edit, pin/unpin and delete. The contract has no single-announcement
 * GET, so it comes from the mural list (`GET /announcements`, usually already cached).
 */
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  type AnnouncementRead, useAnnouncementReads, useAnnouncements, useDeleteAnnouncement, useGroups, useMarkAnnouncementsRead, useSaveAnnouncement,
} from "@/api/messages";
import type { Announcement, MembershipContext } from "@/api/types";
import { audienceLabel } from "@/components/messages/AnnouncementCard";
import { usePullToRefresh, useRefetchOnFocus } from "@/components/messages/hooks";
import { LoadError, SectionTitle } from "@/components/messages/parts";
import { TopBar, goBack } from "@/components/messages/TopBar";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, IconButton, Menu, ProgressBar, Screen, Skeleton, Text, toast } from "@/ui";
import { Ellipsis, Megaphone, Pencil, Pin, PinOff, Trash2, Users } from "@/ui/icons";

const MURAL = { pathname: "/messages", params: { tab: "mural" } } as const;

export default function AnnouncementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ctx } = useClub();
  return ctx && id ? <Detail key={id} ctx={ctx} id={id} /> : null;
}

function Detail({ ctx, id }: { ctx: MembershipContext; id: string }) {
  const { theme } = useTheme();
  const club = ctx.club;
  const staff = ctx.membership.role !== "student";
  const focused = useIsFocused();
  const mural = useAnnouncements(club.id, false);
  const a = mural.data?.find((x) => x.id === id);
  // Receipts only for an announcement that (still) exists: not for a deleted one while its screen closes.
  const reads = useAnnouncementReads(staff && a ? club.id : undefined, id);
  const groups = useGroups(staff ? club.id : undefined);
  const save = useSaveAnnouncement(club.id);
  const del = useDeleteAnnouncement(club.id);
  const markRead = useMarkAnnouncementsRead(club.id);
  const [confirm, setConfirm] = useState(false);
  useRefetchOnFocus(focused, mural.refetch, ...(staff ? [reads.refetch] : []));
  const pull = usePullToRefresh(mural.refetch, ...(staff ? [reads.refetch] : []));

  // Students: opening the announcement is reading it.
  useEffect(() => {
    if (!staff && focused && a && !a.read_at) markRead.mutate([a.id]);
  }, [staff, focused, a?.id, a?.read_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePin = (x: Announcement) =>
    save.mutate({ id: x.id, pinned: !x.pinned }, { onSuccess: () => toast.success(x.pinned ? t("Aviso desafixado") : t("Aviso fixado no topo do mural")), onError: toast.error });
  const remove = () =>
    del.mutate(id, {
      onSuccess: () => { setConfirm(false); toast.success(t("Aviso apagado")); goBack(MURAL); },
      onError: (e) => { setConfirm(false); toast.error(e); },
    });

  const actions = staff && a ? (
    <Menu title={t("Ações do aviso")} trigger={(open) => <IconButton icon={Ellipsis} label={t("Ações do aviso")} onPress={open} />} items={[
      { label: t("Editar"), icon: Pencil, onSelect: () => router.push({ pathname: "/messages/compose", params: { id: a.id } }) },
      { label: a.pinned ? t("Desafixar") : t("Fixar no topo"), icon: a.pinned ? PinOff : Pin, onSelect: () => togglePin(a) },
      "separator",
      { label: t("Apagar"), icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
    ]} />
  ) : undefined;

  return (
    <Screen insetBottom header={<TopBar title={t("Aviso")} subtitle={t("Mural · {club}", { club: club.name })} actions={actions} fallback={MURAL} />}
      refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      {a ? (
        <>
          <Card style={{ padding: theme.space[5], gap: theme.space[4] }}>
            {a.pinned && <Badge tone="brand" icon={Pin}>{t("Fixado")}</Badge>}
            <Text variant="titleLg" accessibilityRole="header">{a.title}</Text>
            <View style={[styles.row, { gap: theme.space[3] }]}>
              <Avatar name={a.author.user.name} src={a.author.user.avatar_url} size={theme.space[10]} />
              <View style={styles.flex}>
                <Text variant="labelMd" numberOfLines={1}>{a.author.user.name}</Text>
                <Text variant="caption" tone="muted">{[ago(a.created_at), a.edited_at ? t("editado {when}", { when: ago(a.edited_at) }) : null].filter(Boolean).join(" · ")}</Text>
              </View>
            </View>
            <Text variant="bodyLg" selectable>{a.body}</Text>
          </Card>
          {staff && <Receipts a={a} reads={reads.data} error={reads.error} retry={() => void reads.refetch()} retrying={reads.isFetching} audience={audienceLabel(a, groups.data)} />}
        </>
      ) : mural.error ? (
        <LoadError error={mural.error} retrying={mural.isFetching} retry={() => void mural.refetch()} />
      ) : mural.isPending ? (
        <Skeleton style={{ height: theme.space[16] * 3, borderRadius: theme.radius.lg }} />
      ) : (
        <Card>
          <EmptyState icon={Megaphone} title={t("Aviso não encontrado")}
            action={<Button variant="secondary" onPress={() => goBack(MURAL)}>{t("Voltar ao mural")}</Button>}>
            {t("Ele pode ter sido apagado.")}
          </EmptyState>
        </Card>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title={t("Apagar aviso?")} description={t("Ele sai do mural de todos os alunos. Não dá para desfazer.")}
        footer={(
          <>
            <Button variant="ghost" onPress={() => setConfirm(false)}>{t("Cancelar")}</Button>
            <Button variant="danger" icon={Trash2} loading={del.isPending} onPress={remove}>{t("Apagar")}</Button>
          </>
        )} />
    </Screen>
  );
}

/** Staff: who it's for, how many read it, and the two lists. */
function Receipts({ a, reads, error, retry, retrying, audience }: {
  a: Announcement; reads: AnnouncementRead[] | undefined; error: Error | null; retry: () => void; retrying: boolean; audience: string;
}) {
  const { theme } = useTheme();
  const seen = (reads ?? []).filter((r) => r.read_at);
  const pending = (reads ?? []).filter((r) => !r.read_at);
  const total = a.audience_count ?? reads?.length ?? 0;
  const done = a.reads_count ?? seen.length;
  return (
    <View style={{ gap: theme.space[3] }}>
      <SectionTitle>{t("Leitura")}</SectionTitle>
      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Users size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{t("Para: {who}", { who: audience })}</Text>
        </View>
        <Text variant="titleSm">{t("Lido por {r} de {n}", { r: done, n: total })}</Text>
        <ProgressBar value={done} max={Math.max(total, 1)} label={t("Lido por {r} de {n}", { r: done, n: total })} />
      </Card>
      {error ? <LoadError error={error} retrying={retrying} retry={retry} /> : !reads ? (
        <Skeleton style={{ height: theme.space[16] * 2, borderRadius: theme.radius.lg }} />
      ) : (
        <>
          {seen.length > 0 && <People title={t("Leram ({n})", { n: seen.length })} list={seen} />}
          {pending.length > 0 && <People title={t("Ainda não leram ({n})", { n: pending.length })} list={pending} />}
        </>
      )}
    </View>
  );
}

function People({ title, list }: { title: string; list: AnnouncementRead[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ paddingVertical: theme.space[1] }}>
        {list.map((r, i) => (
          <View key={r.membership_id} accessible accessibilityLabel={r.read_at ? `${r.user.name}, ${t("leu {when}", { when: ago(r.read_at) })}` : r.user.name}
            style={[styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[1], paddingHorizontal: theme.space[4] },
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.lineSubtle }]}>
            <Avatar name={r.user.name} src={r.user.avatar_url} size={theme.space[8]} />
            <Text variant="labelMd" numberOfLines={1} style={styles.flex}>{r.user.name}</Text>
            {r.read_at && <Text variant="caption" tone="muted">{ago(r.read_at)}</Text>}
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

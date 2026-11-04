/**
 * M10 / W13 · a conversation between a student and the club staff (every staff member sees it). Polls while on
 * screen, marks it read on open and when a new message arrives, sends with the message shown at once, and lets the
 * author delete their own messages. The keyboard never covers the composer (ui KeyboardAvoid: padding on both
 * platforms, since Android is edge-to-edge and the window no longer shrinks for the keyboard, measured from where the
 * view starts in the window).
 */
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useConversation, useDeleteMessage, useMarkConversationRead, useSendMessage } from "@/api/messages";
import type { Club, MembershipContext, Message } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { Composer } from "@/components/messages/Composer";
import { Thread, type PendingMessage } from "@/components/messages/Thread";
import { TopBar, goBack } from "@/components/messages/TopBar";
import { useRefetchOnFocus } from "@/components/messages/hooks";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Dialog, EmptyState, KeyboardAvoid, Skeleton, Text, toast } from "@/ui";
import { CircleAlert, MessageCircle, Trash2 } from "@/ui/icons";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ctx } = useClub();
  return ctx && id ? <Conversation key={id} ctx={ctx} id={id} /> : null;
}

function Conversation({ ctx, id }: { ctx: MembershipContext; id: string }) {
  const { theme } = useTheme();
  const club = ctx.club;
  const myId = ctx.membership.id;
  const staff = ctx.membership.role !== "student";
  const focused = useIsFocused();
  const q = useConversation(club.id, id, focused);
  const send = useSendMessage(club.id, id);
  const read = useMarkConversationRead(club.id);
  const del = useDeleteMessage(club.id);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [target, setTarget] = useState<Message | null>(null);
  const c = q.data;

  useRefetchOnFocus(focused, q.refetch);

  // Read marks: on open and whenever someone else's message arrives, only while on screen.
  const marked = useRef<string | null>(null);
  const lastId = c?.messages.at(-1)?.id ?? "";
  useEffect(() => {
    if (!focused || !c || c.unread_count === 0 || marked.current === lastId) return;
    marked.current = lastId;
    read.mutate(c.id, { onError: () => { marked.current = null; } });
  }, [focused, c, lastId, read]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    const p: PendingMessage = { key: `pending-${Date.now()}`, body, created_at: new Date().toISOString() };
    setPending((l) => [...l, p]);
    setDraft("");
    send.mutateAsync(body).then(
      () => setPending((l) => l.filter((x) => x.key !== p.key)),
      (e: unknown) => {
        setPending((l) => l.filter((x) => x.key !== p.key));
        setDraft((d) => (d ? d : body));
        toast.error(e);
      },
    );
  };

  const remove = () => {
    if (!target) return;
    del.mutate(target.id, { onSuccess: () => setTarget(null), onError: (e) => { setTarget(null); toast.error(e); } });
  };

  const studentName = c?.student.user.name;
  const header = staff ? (
    <TopBar title={studentName ?? t("Conversa")} subtitle={t("Toda a equipe do clube vê esta conversa")}
      leading={studentName ? <Avatar name={studentName} src={c?.student.user.avatar_url} size={theme.space[8]} /> : undefined} />
  ) : (
    <TopBar title={t("Equipe {club}", { club: club.name })} leading={<ClubLogo club={club} branding={ctx.branding} size={theme.space[8]} />}
      subtitle={club.trainer_label === "professor" ? t("Para todos os professores do clube") : t("Para todos os treinadores do clube")} />
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.canvas }]}>
      {header}
      <KeyboardAvoid>
        {c ? (
          <Thread c={c} pending={pending} myId={myId} club={club} onDelete={setTarget} empty={<Empty staff={staff} club={club} name={studentName} />} />
        ) : q.error ? (
          <ThreadError error={q.error} retrying={q.isFetching} retry={() => void q.refetch()} />
        ) : (
          <Loading />
        )}
        {(c || !q.error) && <Composer value={draft} onChange={setDraft} onSend={submit} />}
      </KeyboardAvoid>
      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} title={t("Apagar mensagem?")}
        description={t("Ela some para todos na conversa e fica como “Mensagem apagada”.")}
        footer={(
          <>
            <Button variant="ghost" onPress={() => setTarget(null)}>{t("Cancelar")}</Button>
            <Button variant="danger" icon={Trash2} loading={del.isPending} onPress={remove}>{t("Apagar")}</Button>
          </>
        )}>
        {target && (
          <View style={{ backgroundColor: theme.color.sunken, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <Text numberOfLines={4} tone="muted">{target.body}</Text>
          </View>
        )}
      </Dialog>
    </View>
  );
}

function Empty({ staff, club, name }: { staff: boolean; club: Club; name?: string }) {
  const first = name?.split(" ")[0];
  return staff ? (
    <EmptyState icon={MessageCircle} title={t("Nenhuma mensagem ainda")} style={styles.center}>
      {first ? t("Diga oi para {name}. Toda a equipe do clube vê esta conversa.", { name: first }) : t("Diga oi! Toda a equipe do clube vê esta conversa.")}
    </EmptyState>
  ) : (
    <EmptyState icon={MessageCircle} title={t("Fale com a equipe")} style={styles.center}>
      {club.trainer_label === "professor"
        ? t("Mande uma mensagem para a equipe. Todos os professores do clube veem esta conversa.")
        : t("Mande uma mensagem para a equipe. Todos os treinadores do clube veem esta conversa.")}
    </EmptyState>
  );
}

function Loading() {
  const { theme } = useTheme();
  return (
    <View style={[styles.fill, styles.bottom, { padding: theme.space[4], gap: theme.space[3] }]} accessibilityLabel={t("Carregando…")}>
      <Skeleton style={{ height: theme.space[12], width: "62%", borderRadius: theme.radius.lg }} />
      <Skeleton style={{ height: theme.space[10], width: "48%", alignSelf: "flex-end", borderRadius: theme.radius.lg }} />
      <Skeleton style={{ height: theme.space[16], width: "70%", borderRadius: theme.radius.lg }} />
    </View>
  );
}

function ThreadError({ error, retrying, retry }: { error: Error; retrying: boolean; retry: () => void }) {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <EmptyState icon={CircleAlert} title={error instanceof ApiError ? error.title : t("Algo deu errado")} style={styles.center}
      action={gone
        ? <Button variant="secondary" onPress={() => goBack("/messages")}>{t("Voltar às mensagens")}</Button>
        : <Button variant="secondary" loading={retrying} onPress={retry}>{t("Tentar de novo")}</Button>}>
      {error instanceof ApiError ? error.detail : t("Tente novamente em instantes.")}
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottom: { justifyContent: "flex-end" },
  center: { flex: 1, justifyContent: "center" },
});

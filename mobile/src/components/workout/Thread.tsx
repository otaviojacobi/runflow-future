/**
 * The conversation on a planned workout, student ⇄ trainers (the web's components/Thread.tsx): bubbles (own on the
 * right in the club's color), a composer that grows with the text, and the send button. Reading it marks it as read.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useComments, usePostComment } from "@/api/my";
import type { Club, Comment } from "@/api/types";
import { t } from "@/i18n";
import { ago } from "@/lib/format";
import { isOfflineError } from "@/lib/offline";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, IconButton, Input, Skeleton, Text, toast } from "@/ui";
import { Send } from "@/ui/icons";

export function Thread({ club, workoutId, day, meMembershipId, placeholder, onComposerFocus }: {
  club: Pick<Club, "id" | "trainer_label">; workoutId: string; day: string | undefined; meMembershipId: string; placeholder?: string; onComposerFocus?: () => void;
}) {
  const { theme } = useTheme();
  const list = useComments(club.id, workoutId, day);
  const post = usePostComment(club.id, workoutId);
  const [text, setText] = useState("");
  const send = () => {
    const body = text.trim();
    if (!body || post.isPending) return;
    post.mutate(body, { onSuccess: () => setText(""), onError: toast.error });
  };
  const items = list.data ?? [];
  return (
    <View style={{ gap: theme.space[3] }}>
      {!list.data && (list.fetchStatus === "paused" || list.isError) ? (
        // Offline (the query waits for the network) or it failed: say so instead of an endless skeleton.
        <Text variant="bodySm" tone="muted">{list.isError && !isOfflineError(list.error) ? t("Não foi possível carregar a conversa.") : t("A conversa aparece quando houver conexão.")}</Text>
      ) : list.isPending ? <Skeleton style={{ height: theme.space[16] }} /> : items.length ? (
        <Bubbles items={items} mine={meMembershipId} trainerLabel={club.trainer_label} />
      ) : (
        <Text variant="bodySm" tone="muted">{t("Nenhuma mensagem ainda.")}</Text>
      )}
      <View style={[styles.row, styles.end, { gap: theme.space[2] }]}>
        <Input value={text} onChangeText={setText} multiline maxLength={4000} accessibilityLabel={t("Mensagem")} placeholder={placeholder ?? t("Escreva uma mensagem")}
          onFocus={onComposerFocus}
          style={[styles.flex, { minHeight: theme.size.controlLg, maxHeight: theme.space[20] + theme.space[8], borderRadius: theme.radius.xl, paddingTop: theme.space[3], paddingBottom: theme.space[3] }]} />
        <IconButton icon={Send} label={t("Enviar")} variant="primary" size="lg" onPress={send} disabled={!text.trim() || post.isPending}
          style={{ borderRadius: theme.radius.full }} />
      </View>
    </View>
  );
}

/** A thread's messages: own on the right in the club's color, the rest on the left with who wrote them (student and staff threads). */
export function Bubbles({ items, mine, trainerLabel }: { items: Comment[]; mine: string; trainerLabel: Club["trainer_label"] }) {
  const { theme } = useTheme();
  const c = theme.color;
  const staffLabel = trainerLabel === "professor" ? t("professor(a)") : t("treinador(a)");
  const avatar = theme.space[6] + theme.space[1];
  return (
    <View accessibilityRole="list" style={{ gap: theme.space[3] }}>
      {items.map((m) => {
        const own = m.author_membership_id === mine;
        const who = own ? t("Você") : `${m.author.user.name.split(" ")[0]}${m.author.role !== "student" ? ` · ${staffLabel}` : ""}`;
        return (
          <View key={m.id} accessible accessibilityLabel={`${who}, ${ago(m.created_at)}: ${m.body}`} style={[styles.row, own && styles.reverse, { gap: theme.space[2] }]}>
            <Avatar name={m.author.user.name} src={m.author.user.avatar_url} size={avatar} />
            <View style={[styles.bubble, {
              paddingHorizontal: theme.space[3] + theme.space["0.5"], paddingVertical: theme.space[2], borderRadius: theme.radius.xl,
              backgroundColor: own ? c.brand.solid : c.soft,
              borderBottomRightRadius: own ? theme.radius.xs : theme.radius.xl, borderBottomLeftRadius: own ? theme.radius.xl : theme.radius.xs,
            }]}>
              {!own && <Text variant="caption" color={c.fgMuted} style={styles.bold}>{who}</Text>}
              <Text variant="bodyMd" color={own ? c.brand.onSolid : c.fg}>{m.body}</Text>
              <Text variant="caption" color={own ? c.brand.onSolid : c.fgMuted} style={own && styles.soft}>{ago(m.created_at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end" },
  reverse: { flexDirection: "row-reverse" },
  end: { alignItems: "flex-end" },
  bubble: { maxWidth: "80%", flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: weight("bold") },
  soft: { opacity: 0.85 },
});

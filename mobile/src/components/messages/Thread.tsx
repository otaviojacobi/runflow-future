/**
 * A conversation's messages, newest at the bottom (an inverted list, so it opens at the end and stays there as
 * messages arrive): day separators, the author's name on the first of a run, "Mensagem apagada", messages still being
 * sent, and "Visto" under my last message once the other side read past it. Long press on my message deletes it
 * (also an accessibility action).
 */
import { useMemo, type ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import type { Club, ConversationDetail, Message } from "@/api/types";
import { t } from "@/i18n";
import { localDate, timeOf, today as todayOf } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Text } from "@/ui";
import { CheckCheck, Clock } from "@/ui/icons";
import { dayLabel, firstName, roleTag } from "./util";

/** A message the thread shows before the server has it. */
export interface PendingMessage { key: string; body: string; created_at: string }

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; m: Message; mine: boolean; first: boolean; last: boolean; seen: string | null }
  | { kind: "pending"; key: string; p: PendingMessage; last: boolean };

function buildRows(c: ConversationDetail, pending: PendingMessage[], myId: string, club: Club): Row[] {
  const today = todayOf(club.timezone);
  const studentSide = myId === c.student_membership_id;
  // "Visto" under my last message: students see which staff members read it; staff see whether the student did.
  const myLast = [...c.messages].reverse().find((m) => m.author_membership_id === myId && !m.deleted_at);
  const readers = myLast ? c.reads.filter((r) => r.last_read_at >= myLast.created_at && (studentSide || r.membership_id === c.student_membership_id)) : [];
  const seen = readers.length ? (studentSide ? t("Visto por {names}", { names: readers.map((r) => firstName(r.user.name)).join(", ") }) : t("Visto")) : null;

  const rows: Row[] = [];
  let day = "";
  c.messages.forEach((m, i) => {
    const d = localDate(m.created_at, club.timezone);
    if (d !== day) { day = d; rows.push({ kind: "day", key: `day-${d}`, label: dayLabel(d, today) }); }
    const prev = c.messages[i - 1], next = c.messages[i + 1];
    const sameDay = (x: Message | undefined) => !!x && localDate(x.created_at, club.timezone) === d;
    rows.push({
      kind: "msg", key: m.id, m, mine: m.author_membership_id === myId,
      first: !sameDay(prev) || prev!.author_membership_id !== m.author_membership_id,
      last: !sameDay(next) || next!.author_membership_id !== m.author_membership_id,
      seen: m.id === myLast?.id && !pending.length ? seen : null,
    });
  });
  if (pending.length && day !== today) rows.push({ kind: "day", key: `day-${today}`, label: t("Hoje") });
  pending.forEach((p, i) => rows.push({ kind: "pending", key: p.key, p, last: i === pending.length - 1 }));
  return rows;
}

export function Thread({ c, pending, myId, club, onDelete, empty }: {
  c: ConversationDetail; pending: PendingMessage[]; myId: string; club: Club; onDelete: (m: Message) => void; empty: ReactElement;
}) {
  const { theme } = useTheme();
  const rows = useMemo(() => buildRows(c, pending, myId, club).reverse(), [c, pending, myId, club]);
  if (!rows.length) return <View style={styles.fill}>{empty}</View>;
  return (
    <FlatList
      inverted
      data={rows}
      keyExtractor={(r) => r.key}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={styles.fill}
      contentContainerStyle={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center" }}
      renderItem={({ item }) => <RowView row={item} club={club} onDelete={onDelete} />}
    />
  );
}

function RowView({ row, club, onDelete }: { row: Row; club: Club; onDelete: (m: Message) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  if (row.kind === "day") {
    return (
      <View style={[styles.day, { marginVertical: theme.space[3] }]} accessibilityRole="header">
        <Text variant="labelSm" tone="muted" style={{ backgroundColor: c.soft, borderRadius: theme.radius.full, paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], overflow: "hidden" }}>{row.label}</Text>
      </View>
    );
  }
  if (row.kind === "pending") {
    return (
      <View style={[styles.mine, { marginTop: theme.space["0.5"], marginBottom: row.last ? theme.space[2] : 0 }]}>
        <Bubble mine body={row.p.body} meta={t("Enviando…")} pending last={row.last} accessibilityLabel={t("Você: {text}. Enviando…", { text: row.p.body })} />
      </View>
    );
  }
  const { m, mine, first, last, seen } = row;
  const deleted = !!m.deleted_at;
  const time = timeOf(m.created_at, club.timezone);
  const tag = roleTag(club, m.author.role);
  const author = mine ? t("Você") : m.author.user.name;
  const name = !mine && first ? (tag ? `${firstName(m.author.user.name)} · ${tag}` : firstName(m.author.user.name)) : null;
  const canDelete = mine && !deleted;
  const label = `${author}${tag && !mine ? `, ${tag}` : ""}: ${deleted ? t("Mensagem apagada") : m.body}. ${time}${seen ? `. ${seen}` : ""}`;
  return (
    <View style={{ marginTop: first ? theme.space[2] : theme.space["0.5"] }}>
      <View style={[mine ? styles.mine : styles.theirs, { gap: theme.space[2] }]}>
        {!mine && (
          <View style={{ width: theme.space[8] }}>
            {first && <Avatar name={m.author.user.name} src={m.author.user.avatar_url} size={theme.space[8]} />}
          </View>
        )}
        <Bubble mine={mine} name={name} body={deleted ? null : m.body} meta={time} last={last} accessibilityLabel={label}
          onLongPress={canDelete ? () => onDelete(m) : undefined}
          accessibilityActions={canDelete ? [{ name: "delete", label: t("Apagar mensagem") }] : undefined}
          onAccessibilityAction={canDelete ? (e) => e.nativeEvent.actionName === "delete" && onDelete(m) : undefined} />
      </View>
      {seen && (
        <View style={[styles.seen, { gap: theme.space[1], marginTop: theme.space[1] }]}>
          <CheckCheck size={theme.size.iconSm - 2} color={c.info.text} aria-hidden />
          <Text variant="caption" tone="muted" importantForAccessibility="no" accessibilityElementsHidden>{seen}</Text>
        </View>
      )}
    </View>
  );
}

function Bubble({ mine, name, body, meta, last, pending, onLongPress, accessibilityLabel, accessibilityActions, onAccessibilityAction }: {
  mine: boolean; name?: string | null; body: string | null; meta: string; last: boolean; pending?: boolean; onLongPress?: () => void; accessibilityLabel: string;
  accessibilityActions?: { name: string; label: string }[]; onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const r = theme.radius.lg, tail = theme.radius.xs;
  const deleted = body === null;
  // My messages are filled with the club's color; others' and deleted ones (either side) are plain.
  const filled = mine && !deleted;
  const fg = filled ? c.brand.onSolid : deleted ? c.fgMuted : c.fg;
  return (
    <Pressable accessible accessibilityLabel={accessibilityLabel} accessibilityActions={accessibilityActions} onAccessibilityAction={onAccessibilityAction}
      accessibilityHint={onLongPress ? t("Toque duas vezes e segure para apagar") : undefined}
      onLongPress={onLongPress} delayLongPress={350} disabled={!onLongPress}
      style={({ pressed }) => [styles.bubble, {
        paddingHorizontal: theme.space[3], paddingTop: theme.space[2], paddingBottom: theme.space["1.5"], borderRadius: r, gap: theme.space["0.5"],
        backgroundColor: filled ? (pressed ? c.brand.solidActive : c.brand.solid) : deleted ? "transparent" : pressed ? c.soft : c.surface,
        borderColor: filled ? c.brand.solidBorder : c.line,
      }, deleted && styles.dashed, last && (mine ? { borderBottomRightRadius: tail } : { borderBottomLeftRadius: tail }), pending && styles.pending]}>
      {name ? <Text variant="labelSm" color={c.brand.text}>{name}</Text> : null}
      {deleted
        ? <Text variant="bodyMd" color={fg} style={styles.italic}>{t("Mensagem apagada")}</Text>
        : <Text variant="bodyMd" color={fg}>{body}</Text>}
      <View style={[styles.meta, { gap: theme.space[1] }]}>
        {pending && <Clock size={theme.size.iconSm - 4} color={fg} style={styles.dim} aria-hidden />}
        <Text variant="caption" color={filled ? c.brand.onSolid : c.fgSubtle} style={[styles.tabular, filled && styles.dim]}>{meta}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  day: { alignItems: "center" },
  mine: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end" },
  theirs: { flexDirection: "row", justifyContent: "flex-start", alignItems: "flex-end" },
  bubble: { maxWidth: "80%", borderWidth: 1, flexShrink: 1 },
  italic: { fontStyle: "italic" },
  dashed: { borderStyle: "dashed" },
  meta: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end" },
  tabular: { fontVariant: ["tabular-nums"] },
  dim: { opacity: 0.8 },
  pending: { opacity: 0.7 },
  seen: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
});

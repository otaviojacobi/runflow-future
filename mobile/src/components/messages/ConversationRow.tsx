/** A conversation in a list: avatar, name, last message, when, and the unread count (bold while unread). */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { t, tn } from "@/i18n";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";
import { ChevronRight } from "@/ui/icons";

export function UnreadCount({ n }: { n: number }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View aria-hidden style={[styles.count, { minWidth: theme.space[5], height: theme.space[5], paddingHorizontal: theme.space["1.5"], borderRadius: theme.radius.full, backgroundColor: c.brand.solid }]}>
      <Text variant="caption" color={c.brand.onSolid} style={styles.bold}>{n > 99 ? "99+" : String(n)}</Text>
    </View>
  );
}

export function ConversationRow({ avatar, title, preview, time, unread, onPress, busy, chevron, style }: {
  avatar: ReactNode; title: string; preview: string; time?: string | null; unread: number; onPress: () => void; busy?: boolean; chevron?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const label = [title, unread ? tn(unread, "{n} mensagem nova", "{n} mensagens novas") : null, preview, time].filter(Boolean).join(", ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy: !!busy }} accessibilityHint={t("Abre a conversa")} onPress={onPress} disabled={busy}
      style={({ pressed }) => [styles.row, { minHeight: theme.size.touchMin + theme.space[5], gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], backgroundColor: pressed ? c.soft : "transparent" }, style]}>
      {avatar}
      <View style={styles.flex}>
        <View style={[styles.line, { gap: theme.space[2] }]}>
          <Text variant="labelMd" numberOfLines={1} style={[styles.flex, unread > 0 && { fontWeight: weight("bold") }]}>{title}</Text>
          {time ? <Text variant="caption" color={unread ? c.brand.text : c.fgSubtle} style={styles.time}>{time}</Text> : null}
        </View>
        <View style={[styles.line, { gap: theme.space[2] }]}>
          <Text variant="bodySm" numberOfLines={1} color={unread ? c.fg : c.fgMuted} style={styles.flex}>{preview}</Text>
          {busy ? <ActivityIndicator size="small" color={c.brand.solid} /> : unread > 0 ? <UnreadCount n={unread} /> : null}
        </View>
      </View>
      {chevron && <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  line: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  time: { flexShrink: 0, fontVariant: ["tabular-nums"] },
  count: { alignItems: "center", justifyContent: "center" },
  bold: { fontWeight: weight("bold") },
});

/**
 * What waits in a club's Mensagens (`/me` memberships[].unread, D-045): messages and announcements don't push by
 * default, so the app shows their count on Mensagens (the tab, the "Mais" list) and a dot on the club switcher for
 * another club. Like the web's AppShell.
 */
import { StyleSheet, View } from "react-native";
import type { MembershipContext } from "@/api/types";
import { tn } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";

export const unreadOf = (m: MembershipContext | null | undefined) => (m?.unread?.messages ?? 0) + (m?.unread?.announcements ?? 0);

/** The words a screen reader adds after the label: ", 3 novas". Empty when there's nothing. */
export const unreadLabel = (n: number) => (n > 0 ? tn(n, ", {n} nova", ", {n} novas") : "");

/** A small count ("9+" at most), hidden from screen readers (the label says it). `ring` = the color around it. */
export function CountBadge({ n, ring }: { n: number; ring?: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  if (n <= 0) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.count, { minWidth: theme.space[4] + theme.space["0.5"], paddingHorizontal: theme.space[1], borderRadius: theme.radius.full, backgroundColor: c.danger.solid, borderColor: ring ?? c.danger.solid, borderWidth: ring ? 2 : 0 }]}>
      <Text variant="overline" color={c.danger.onSolid} style={styles.text}>{n > 9 ? "9+" : String(n)}</Text>
    </View>
  );
}

/** A dot: something new somewhere this leads to. */
export function Dot({ ring }: { ring?: string }) {
  const { theme } = useTheme();
  return <View aria-hidden style={[styles.dot, { width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.full, backgroundColor: theme.color.danger.solid, borderColor: ring ?? theme.color.danger.solid, borderWidth: ring ? 2 : 0 }]} />;
}

const styles = StyleSheet.create({
  count: { alignItems: "center", justifyContent: "center" },
  text: { textTransform: "none" },
  dot: { flexShrink: 0 },
});

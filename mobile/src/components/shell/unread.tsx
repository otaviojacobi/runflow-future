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
/** Staff: the feedback inbox items unread by this person (`unread.feedback`; 0 for students). */
export const feedbackOf = (m: MembershipContext | null | undefined) => m?.unread?.feedback ?? 0;
/** Everything waiting in a club (Mensagens + Feedbacks): the club switcher's dot and counts. */
export const waitingOf = (m: MembershipContext | null | undefined) => unreadOf(m) + feedbackOf(m);

/** The words a screen reader adds after the label: ", 3 novas". Empty when there's nothing. */
export const unreadLabel = (n: number) => (n > 0 ? tn(n, ", {n} nova", ", {n} novas") : "");
/** Feedbacks' words: ", 3 não lidos". */
export const waitingLabel = (n: number) => (n > 0 ? tn(n, ", {n} não lido", ", {n} não lidos") : "");
/** What a count on a screen's link means, read out ("/feedback": unread, the rest: new). */
export const countLabel = (to: string, n: number) => (to.replace(/^\//, "") === "feedback" ? waitingLabel(n) : unreadLabel(n));
/** "Mais" (staff): ", 2 mensagens novas, 3 feedbacks não lidos" for the counts behind it (by route name). */
export const moreLabel = (counts: Record<string, number>) => [
  (counts.messages ?? 0) > 0 ? tn(counts.messages!, ", {n} mensagem nova", ", {n} mensagens novas") : "",
  (counts.feedback ?? 0) > 0 ? tn(counts.feedback!, ", {n} feedback não lido", ", {n} feedbacks não lidos") : "",
].join("");

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

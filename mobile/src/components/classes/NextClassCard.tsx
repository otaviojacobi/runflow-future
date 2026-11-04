/** Hoje's "Próxima aula" (D-052): the student's next booked or waitlisted class; opens it in Aulas. */
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { NextClass } from "@/api/types";
import { SportChip } from "@/components/sport";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";
import { CalendarClock, ChevronRight } from "@/ui/icons";
import { BookingBadge, canCheckIn, whenLabel } from "./parts";

export function NextClassCard({ next, tz, today }: { next: NextClass; tz: string; today: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const now = canCheckIn(next.session);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("Próxima aula")}: ${next.class_type.name}, ${whenLabel(next.session, tz, today)}`}
      onPress={() => router.push(`/classes?session=${next.session.id}` as Href)}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: now ? c.brand.solid : c.lineSubtle, backgroundColor: pressed ? c.soft : c.surface }]}>
      <View style={[styles.icon, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.md, backgroundColor: c.brand.subtle }]}>
        <CalendarClock size={theme.size.iconMd} color={c.brand.subtleFg} aria-hidden />
      </View>
      <View style={[styles.flex, { gap: theme.space[1] }]}>
        <Text variant="overline" tone="muted">{now ? t("Sua aula é agora: faça o check-in") : t("Próxima aula")}</Text>
        <Text variant="titleSm" numberOfLines={2}>{next.class_type.name}</Text>
        <Text variant="bodySm" tone="muted" numberOfLines={1}>{[whenLabel(next.session, tz, today), next.location?.name].filter(Boolean).join(" · ")}</Text>
        <View style={[styles.row, { gap: theme.space[2] }]}><SportChip sport={next.class_type.sport} size="sm" /><BookingBadge booking={next.booking} /></View>
      </View>
      <ChevronRight size={theme.size.iconSm} color={c.fgSubtle} aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  icon: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
});

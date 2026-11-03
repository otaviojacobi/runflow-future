/**
 * An announcement on the mural: author, when, title, the start of the text, "Fixado", "Novo" (students) and, for the
 * staff, the audience and "Lido por r de n". Tapping opens the whole announcement.
 */
import { StyleSheet, View } from "react-native";
import type { Announcement, Group } from "@/api/types";
import { t } from "@/i18n";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Card, Text } from "@/ui";
import { Eye, Pin } from "@/ui/icons";

/** "Todo o clube" or the groups' names. */
export function audienceLabel(a: Pick<Announcement, "group_ids">, groups: Pick<Group, "id" | "name">[] | undefined) {
  if (!a.group_ids.length) return t("Todo o clube");
  return a.group_ids.map((id) => groups?.find((g) => g.id === id)?.name ?? t("grupo")).join(", ");
}

export function byline(a: Announcement) {
  return [a.author.user.name, ago(a.created_at), a.edited_at ? t("editado") : null].filter(Boolean).join(" · ");
}

export function AnnouncementCard({ a, staff, groups, onPress }: { a: Announcement; staff: boolean; groups?: Pick<Group, "id" | "name">[]; onPress: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const fresh = !staff && !a.read_at;
  const reads = staff && a.audience_count != null ? t("Lido por {r} de {n}", { r: a.reads_count ?? 0, n: a.audience_count }) : null;
  const label = [
    a.pinned ? t("Fixado") : null, fresh ? t("Novo") : null, a.title, byline(a), a.body, staff ? audienceLabel(a, groups) : null, reads,
  ].filter(Boolean).join(". ");
  return (
    <Card onPress={onPress} edge={a.pinned ? "brand" : undefined} accessibilityLabel={label} accessibilityHint={t("Abre o aviso")}
      style={[{ padding: theme.space[4], gap: theme.space[3] }, fresh && { borderColor: c.accent.border, borderWidth: 2, padding: theme.space[4] - 1 }]}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Avatar name={a.author.user.name} src={a.author.user.avatar_url} size={theme.space[10]} />
        <View style={styles.flex}>
          <Text variant="titleSm" numberOfLines={2}>{a.title}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>{byline(a)}</Text>
        </View>
      </View>
      {(a.pinned || fresh) && (
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {a.pinned && <Badge tone="brand" icon={Pin}>{t("Fixado")}</Badge>}
          {fresh && <Badge tone="accent">{t("Novo")}</Badge>}
        </View>
      )}
      <Text numberOfLines={4}>{a.body}</Text>
      {staff && (
        <View style={[styles.row, { gap: theme.space[3] }]}>
          {reads && (
            <View style={[styles.row, { gap: theme.space[1] }]}>
              <Eye size={theme.size.iconSm} color={c.fgMuted} aria-hidden />
              <Text variant="labelSm" tone="muted">{reads}</Text>
            </View>
          )}
          <Text variant="caption" tone="subtle" numberOfLines={1} style={[styles.flex, styles.end]}>{audienceLabel(a, groups)}</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  end: { textAlign: "right" },
});

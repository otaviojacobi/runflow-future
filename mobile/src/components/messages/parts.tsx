/** Building blocks of the Mensagens lists: section titles, rows drawn as one card inside a FlatList, search, errors. */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, IconButton, Input, Text } from "@/ui";
import { CircleAlert, Search, X } from "@/ui/icons";

export function SectionTitle({ children, trailing }: { children: string; trailing?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[1] }]}>
      <Text variant="overline" tone="subtle" accessibilityRole="header" style={styles.flex}>{children}</Text>
      {trailing}
    </View>
  );
}

/**
 * One row of a list that looks like a single card (the FlatList renders rows one by one): the first row has the top
 * corners, the last the bottom ones, and a hairline separates rows, inset to start after the avatar.
 */
export function CardListItem({ first, last, inset, children }: { first: boolean; last: boolean; inset: number; children: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.color;
  const r = theme.radius.lg;
  return (
    <View style={[
      { backgroundColor: c.surface, borderColor: c.line, borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: theme.space[1] },
      first && { borderTopWidth: 1, borderTopLeftRadius: r, borderTopRightRadius: r, paddingTop: theme.space[1] },
      last && { borderBottomWidth: 1, borderBottomLeftRadius: r, borderBottomRightRadius: r, paddingBottom: theme.space[1] },
    ]}>
      {!first && <View aria-hidden style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.lineSubtle, marginLeft: inset }} />}
      {children}
    </View>
  );
}

/** A search field with the magnifier inside and a clear button. */
export function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const icon = theme.size.iconMd;
  return (
    <View style={styles.search}>
      <Input value={value} onChangeText={onChange} placeholder={label} accessibilityLabel={label} returnKeyType="search" autoCorrect={false} autoCapitalize="none"
        style={{ paddingLeft: theme.space[3] + icon + theme.space[2], paddingRight: value ? theme.size.touchMin : theme.space[3] }} />
      <View pointerEvents="none" style={[styles.icon, { left: theme.space[3] }]}>
        <Search size={icon} color={c.fgSubtle} aria-hidden />
      </View>
      {value ? (
        <View style={[styles.icon, { right: theme.space["0.5"] }]}>
          <IconButton icon={X} label={t("Limpar busca")} onPress={() => onChange("")} />
        </View>
      ) : null}
    </View>
  );
}

/** A list that failed to load: the API's pt-BR title and detail, and a retry. */
export function LoadError({ error, retrying, retry }: { error: Error; retrying: boolean; retry: () => void }) {
  return (
    <Card>
      <EmptyState icon={CircleAlert} title={error instanceof ApiError ? error.title : t("Algo deu errado")}
        action={<Button variant="secondary" loading={retrying} onPress={retry}>{t("Tentar de novo")}</Button>}>
        {error instanceof ApiError ? error.detail : t("Tente novamente em instantes.")}
      </EmptyState>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  search: { justifyContent: "center" },
  icon: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
});

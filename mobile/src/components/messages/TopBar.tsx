/**
 * The bar of the screens pushed in the Mensagens stack (thread, announcement, compose): back, an optional avatar,
 * title and subtitle, optional actions. Same look as the shell's BackHeader. The screens draw it themselves (no
 * navigator header), so a KeyboardAvoidingView under it measures from the top of the window.
 */
import { router, type Href } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { IconButton, Text } from "@/ui";
import { ArrowLeft } from "@/ui/icons";

/** Back to where the person came from; without history (a deep link) to `fallback`. */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.navigate(fallback);
}

export function TopBar({ title, subtitle, leading, actions, onBack, fallback = "/messages" }: {
  title: string; subtitle?: string | null; leading?: ReactNode; actions?: ReactNode; onBack?: () => void; fallback?: Href;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.color;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + theme.space[1], paddingBottom: theme.space[1], paddingHorizontal: theme.space[2], gap: theme.space[2], backgroundColor: c.canvas, borderBottomColor: c.line }]}>
      <IconButton icon={ArrowLeft} label={t("Voltar")} onPress={onBack ?? (() => goBack(fallback))} />
      {leading}
      <View style={styles.flex} accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}>
        <Text variant={subtitle ? "titleSm" : "titleMd"} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0 },
});

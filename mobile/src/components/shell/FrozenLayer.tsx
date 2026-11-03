/**
 * Frozen club (D-043), staff only: an icy layer over the screen with one way out, paying (owner) or asking the owner
 * (trainers). Writes answer `423 club.frozen` anyway; students never see it. It covers each staff screen except the
 * way out (Plano e cobrança) and the person's own account, so the top bar (club switcher) and the tab bar stay usable.
 * The owner is taken to Plano e cobrança once per club per app run, like the web.
 */
import { router } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { Role } from "@/api/types";
import { t } from "@/i18n";
import { alpha } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Text } from "@/ui";
import { CreditCard, Snowflake } from "@/ui/icons";

/** Routes the layer leaves alone: the way out and what belongs to the person, not the club. */
const OPEN = /^(club\/billing|more|notifications|account(\/.*)?)$/;
const redirected = new Set<string>();

export function FrozenScope({ route, role, clubId, frozen, children }: { route: string; role: Role; clubId: string; frozen: boolean; children: ReactNode }) {
  const on = frozen && role !== "student" && !OPEN.test(route);
  useEffect(() => {
    if (!frozen || role !== "owner" || redirected.has(clubId)) return;
    redirected.add(clubId);
    router.navigate("/club/billing");
  }, [frozen, role, clubId]);
  return (
    <View style={styles.fill}>
      <View style={styles.fill} importantForAccessibility={on ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={on}>{children}</View>
      {on && <Layer owner={role === "owner"} />}
    </View>
  );
}

function Layer({ owner }: { owner: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const i = c.info;
  const badge = theme.space[12] + theme.space[2];
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { padding: theme.space[4], backgroundColor: alpha(i.subtle, 0.82) }]}>
      <View accessibilityRole="alert" accessibilityViewIsModal
        style={[styles.card, { gap: theme.space[3], padding: theme.space[6], maxWidth: theme.size.readingMax, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: i.border, backgroundColor: c.surface, boxShadow: theme.shadow.lg }]}>
        <View style={[styles.center, { width: badge, height: badge, borderRadius: theme.radius.full, backgroundColor: i.subtle }]}>
          <Snowflake size={theme.size.iconLg + theme.space[1]} color={i.subtleFg} aria-hidden />
        </View>
        <Text variant="titleLg" accessibilityRole="header" style={styles.text}>{t("Clube congelado")}</Text>
        <Text tone="muted" style={styles.text}>{owner
          ? t("O pagamento do plano está pendente. Regularize em Plano e cobrança para voltar a usar o clube. Os alunos continuam usando normalmente.")
          : t("O pagamento do plano está pendente. Peça ao responsável pelo clube para regularizar; até lá, nada pode ser alterado.")}</Text>
        {owner && <Button icon={CreditCard} onPress={() => router.navigate("/club/billing")}>{t("Regularizar pagamento")}</Button>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  card: { width: "100%", alignItems: "center" },
  text: { textAlign: "center" },
});

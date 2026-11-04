/**
 * "Mais" (staff): everything outside the 4 tabs, grouped like the web's sidebar (Treinos, Equipe, Clube). What has no
 * screen in the app yet opens the web app; then the account and sign out.
 */
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { signOut } from "@/api/auth";
import { hrefOf, moreFor, type NavItem } from "@/components/shell/nav";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { openOnWeb } from "@/lib/web";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, ListItem, Screen, Text } from "@/ui";
import { ExternalLink, LogOut, User } from "@/ui/icons";
import { CountBadge, countLabel, feedbackOf, unreadOf } from "@/components/shell/unread";

function Item({ item, count = 0 }: { item: NavItem; count?: number }) {
  const { theme } = useTheme();
  if (item.app) return <ListItem title={t(item.label)} icon={item.icon} chevron accessibilityRole="link" accessibilityLabel={count > 0 ? t(item.label) + countLabel(item.to, count) : undefined}
    trailing={<CountBadge n={count} />} onPress={() => router.push(hrefOf(item.to))} />;
  return (
    <ListItem title={t(item.label)} icon={item.icon} accessibilityRole="link" accessibilityLabel={`${t(item.label)}, ${t("abre na web")}`} onPress={() => openOnWeb(item.to)}
      trailing={<ExternalLink size={theme.size.iconSm} color={theme.color.fgSubtle} style={styles.icon} aria-hidden />} />
  );
}

export default function MoreScreen() {
  const { theme } = useTheme();
  const { role, club, ctx } = useClub();
  if (!role || !club) return null;
  const groups = moreFor(role, club.modalities);
  const counts: Record<string, number> = { "/messages": unreadOf(ctx), "/feedback": feedbackOf(ctx) };
  const section = (title: string | undefined, children: React.ReactNode, key: string) => (
    <View key={key} style={{ gap: theme.space[2] }}>
      {title && <Text variant="overline" tone="subtle" accessibilityRole="header" style={{ paddingHorizontal: theme.space[1] }}>{t(title)}</Text>}
      <Card style={{ padding: theme.space[1] }}>{children}</Card>
    </View>
  );
  return (
    <Screen>
      {groups.map((g, i) => section(g.title, g.items.map((it) => <Item key={it.to} item={it} count={counts[it.to]} />), String(i)))}
      <Text variant="bodySm" tone="muted" style={{ paddingHorizontal: theme.space[1] }}>{t("As ferramentas com o ícone de link abrem o Runflow no navegador.")}</Text>
      {section("Conta", (
        <>
          <ListItem title={t("Minha conta")} icon={User} chevron accessibilityRole="link" onPress={() => router.push("/account")} />
          <ListItem title={t("Sair")} icon={LogOut} danger onPress={async () => { await signOut(); router.replace("/login"); }} />
        </>
      ), "account")}
    </Screen>
  );
}

const styles = StyleSheet.create({ icon: { flexShrink: 0 } });

/**
 * C1 · Perfil (students' 4th tab, D-035) / Minha conta (staff, from "Mais"): who is signed in, Perfil's links
 * (Atividades, Provas), appearance and sign out. Editing the profile, notifications and privacy come with X7.
 */
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { signOut } from "@/api/auth";
import { hrefOf, profileLinksFor } from "@/components/shell/nav";
import { t } from "@/i18n";
import { assetUrl } from "@/lib/api";
import { ROLE_LABEL, useClub } from "@/lib/club";
import { openOnWeb } from "@/lib/web";
import { type ModePref, useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, ListItem, PageHeader, Screen, Segmented, Text } from "@/ui";
import { ExternalLink, LogOut, Monitor, Moon, Settings, Sun } from "@/ui/icons";

export default function AccountScreen() {
  const { theme, modePref, setModePref } = useTheme();
  const { me, club, role, isStaff } = useClub();
  if (!me || !role) return null;
  const links = profileLinksFor(role);
  return (
    <Screen>
      {!isStaff && <PageHeader title={t("Perfil")} />}
      <Card style={[styles.row, { gap: theme.space[4], padding: theme.space[4] }]}>
        <Avatar name={me.user.name} src={assetUrl(me.user.avatar_url)} size={theme.space[12]} />
        <View style={styles.flex}>
          <Text variant="titleMd" numberOfLines={1}>{me.user.name}</Text>
          <Text variant="bodySm" tone="muted" numberOfLines={1}>{me.user.email}</Text>
          {club && <Text variant="bodySm" tone="muted" numberOfLines={1}>{t(ROLE_LABEL[role])} · {club.name}</Text>}
        </View>
      </Card>

      {links.length > 0 && (
        <Card style={{ padding: theme.space[1] }}>
          {links.map((it) => <ListItem key={it.to} title={t(it.label)} icon={it.icon} chevron accessibilityRole="link" onPress={() => router.push(hrefOf(it.to))} />)}
        </Card>
      )}

      <View style={{ gap: theme.space[2] }}>
        <Text variant="overline" tone="subtle" accessibilityRole="header" style={{ paddingHorizontal: theme.space[1] }}>{t("Aparência")}</Text>
        <Segmented<ModePref> label={t("Aparência")} value={modePref} onChange={setModePref}
          options={[{ value: "light", label: t("Claro"), icon: Sun }, { value: "dark", label: t("Escuro"), icon: Moon }, { value: "system", label: t("Sistema"), icon: Monitor }]} />
      </View>

      <Card style={{ padding: theme.space[1] }}>
        <ListItem title={t("Conta, notificações e privacidade")} subtitle={t("Por enquanto no Runflow pela web")} icon={Settings} accessibilityRole="link"
          onPress={() => openOnWeb("/account")} trailing={<ExternalLink size={theme.size.iconSm} color={theme.color.fgSubtle} style={styles.icon} aria-hidden />} />
      </Card>

      <Button variant="secondary" icon={LogOut} onPress={async () => { await signOut(); router.replace("/login"); }}>{t("Sair")}</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  icon: { flexShrink: 0 },
});

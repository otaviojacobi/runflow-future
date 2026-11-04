/**
 * C1 · Perfil (students' 4th tab, D-035) / Minha conta (staff, from "Mais"): who is signed in, the student's links
 * (Perfil de atleta, Atividades, Provas), the account's screens (dados pessoais, notificações, privacidade,
 * aparelhos, relógios e apps), appearance and sign out. Mirrors the web's /account, split into screens for the phone.
 */
import { router, type Href } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useConnections } from "@/api/account";
import { signOut } from "@/api/auth";
import { hrefOf, profileLinksFor } from "@/components/shell/nav";
import { Section } from "@/components/account/parts";
import { t } from "@/i18n";
import { ROLE_LABEL, useClub } from "@/lib/club";
import { type ModePref, useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, ListItem, PageHeader, Screen, Segmented, Text, type Icon } from "@/ui";
import { Bell, ChevronRight, LogOut, Monitor, Moon, ShieldCheck, Smartphone, Sun, UserPen, UserRound, Watch } from "@/ui/icons";

/**
 * A row to another screen. The titles say what's behind them (founder, 2026-11-04: descriptions under "Notificações"
 * and the like were clutter); a subtitle only carries live information, like "Strava conectado".
 */
function LinkRow({ title, subtitle, icon, href }: { title: string; subtitle?: string; icon: Icon; href: Href }) {
  return <ListItem title={title} subtitle={subtitle} icon={icon} chevron accessibilityRole="link" onPress={() => router.push(href)} />;
}

export default function AccountScreen() {
  const { theme, modePref, setModePref } = useTheme();
  const { me, club, role, isStaff } = useClub();
  const connections = useConnections();
  const stravaOn = !!connections.data?.find((p) => p.provider === "strava")?.connection;
  if (!me || !role) return null;
  const student = role === "student";
  const links = [{ to: "/account/profile", label: "Perfil de atleta", icon: UserRound }, ...profileLinksFor(role)];
  return (
    <Screen>
      {!isStaff && <PageHeader title={t("Perfil")} />}
      <Card onPress={() => router.push("/account/personal")} accessibilityRole="link" accessibilityLabel={`${me.user.name}, ${me.user.email}`} accessibilityHint={t("Editar dados pessoais e foto")}
        style={[styles.row, { gap: theme.space[4], padding: theme.space[4] }]}>
        <Avatar name={me.user.name} src={me.user.avatar_url} size={theme.space[16]} />
        <View style={styles.flex}>
          <Text variant="titleMd" numberOfLines={1}>{me.user.name}</Text>
          <Text variant="bodySm" tone="muted" numberOfLines={1}>{me.user.email}</Text>
          {club && <Text variant="bodySm" tone="muted" numberOfLines={1}>{t(ROLE_LABEL[role])} · {club.name}</Text>}
        </View>
        <ChevronRight size={theme.size.iconMd} color={theme.color.fgSubtle} aria-hidden />
      </Card>

      {student && (
        <Section title={t("Seu perfil")} padded={false}>
          {links.map((it) => <LinkRow key={it.to} title={t(it.label)} icon={it.icon} href={hrefOf(it.to)} />)}
        </Section>
      )}

      <Section title={t("Conta")} padded={false}>
        <LinkRow title={t("Dados pessoais")} icon={UserPen} href="/account/personal" />
        <LinkRow title={t("Notificações")} icon={Bell} href="/account/notifications" />
        <LinkRow title={t("Privacidade e dados")} icon={ShieldCheck} href="/account/privacy" />
        <LinkRow title={t("Aparelhos conectados")} icon={Smartphone} href="/account/devices" />
        <LinkRow title={t("Relógios e apps")} subtitle={stravaOn ? t("Strava conectado") : undefined} icon={Watch} href="/account/connections" />
      </Section>

      <View style={{ gap: theme.space[2] }}>
        <View style={{ paddingHorizontal: theme.space[1] }}>
          <Text variant="overline" tone="subtle" accessibilityRole="header">{t("Aparência")}</Text>
        </View>
        <Segmented<ModePref> label={t("Aparência")} value={modePref} onChange={setModePref}
          options={[{ value: "light", label: t("Claro"), icon: Sun }, { value: "dark", label: t("Escuro"), icon: Moon }, { value: "system", label: t("Sistema"), icon: Monitor }]} />
      </View>

      <Button variant="secondary" icon={LogOut} onPress={async () => { await signOut(); router.replace("/login"); }}>{t("Sair")}</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

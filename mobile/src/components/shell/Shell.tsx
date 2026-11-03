/**
 * A6 · the signed-in shell, like the web's phone layout (components/shell/AppShell.tsx): a top bar with the club
 * switcher and the notifications bell, the role's bottom tabs (students: exactly 4, D-035; staff: 4 + "Mais"), and a
 * back bar on screens reached from "Mais", Perfil or the bell. Everything here wears the active club's theme.
 */
import { router, type Href } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MembershipContext, Role, Sport } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { ROLE_LABEL, homeFor, selectClub, useClub } from "@/lib/club";
import { openOnWeb } from "@/lib/web";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Dialog, Divider, IconButton, ListItem, Text } from "@/ui";
import { ArrowLeft, Bell, Check, ChevronsUpDown, Menu as MenuIcon, Plus, Ticket } from "@/ui/icons";
import { hrefOf, moreFor, profileLinksFor, tabsFor } from "./nav";

/** The route name of an in-app nav path ("/today" → "today"). */
const routeName = (to: string) => to.slice(1);
const MORE = "more";

/** Tab roots show the shell bar; everything else in the shell is a pushed-looking screen with a back bar. */
export function isTabRoot(name: string, role: Role, modalities: Sport[]) {
  return name === MORE ? role !== "student" : tabsFor(role, modalities).some((i) => routeName(i.to) === name);
}

function ClubSwitcher() {
  const { theme } = useTheme();
  const { me, ctx } = useClub();
  const [open, setOpen] = useState(false);
  if (!me || !ctx) return null;
  const pick = (m: MembershipContext) => {
    setOpen(false);
    if (m.club.id === ctx.club.id) return;
    selectClub(m);
    router.replace(homeFor(m.membership.role));
  };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={ctx.club.name} accessibilityHint={t("Trocar de clube")} onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.switcher, { gap: theme.space[2], padding: theme.space[1], minHeight: theme.size.touchMin, borderRadius: theme.radius.md, backgroundColor: pressed ? theme.color.soft : "transparent" }]}>
        <ClubLogo club={ctx.club} branding={ctx.branding} size={theme.space[8]} />
        <Text variant="titleSm" numberOfLines={1} style={[styles.shrink, { fontWeight: weight("bold") }]}>{ctx.club.name}</Text>
        <ChevronsUpDown size={theme.size.iconSm} color={theme.color.fgSubtle} style={styles.icon} aria-hidden />
      </Pressable>
      <Dialog open={open} onOpenChange={setOpen} title={t("Seus clubes")}>
        <View accessibilityRole="menu">
          {me.memberships.map((m) => {
            const current = m.club.id === ctx.club.id;
            return (
              <ListItem key={m.club.id} title={m.club.name} subtitle={t(ROLE_LABEL[m.membership.role])} selected={current} accessibilityRole="menuitem" onPress={() => pick(m)}
                leading={<ClubLogo club={m.club} branding={m.branding} size={theme.space[8]} />}
                trailing={current ? <Check size={theme.size.iconMd} color={theme.color.brand.subtleFg} aria-hidden /> : undefined} />
            );
          })}
          <Divider />
          <ListItem title={t("Tenho um convite")} icon={Ticket} accessibilityRole="menuitem" onPress={() => { setOpen(false); router.push("/clubs"); }} />
          <ListItem title={t("Criar novo clube")} icon={Plus} accessibilityRole="menuitem" onPress={() => { setOpen(false); void openOnWeb("/clubs/new"); }} />
        </View>
      </Dialog>
    </>
  );
}

function BellButton() {
  const { theme } = useTheme();
  const { me } = useClub();
  const unread = me?.unread_notifications ?? 0;
  const c = theme.color;
  return (
    <IconButton icon={Bell} label={unread ? t("Notificações: {n} novas", { n: unread }) : t("Notificações")} onPress={() => router.push("/notifications")}
      badge={unread > 0 ? (
        <View style={[styles.count, { minWidth: theme.space[4] + theme.space["0.5"], paddingHorizontal: theme.space[1], borderRadius: theme.radius.full, backgroundColor: c.danger.solid, borderColor: c.canvas }]}>
          <Text variant="overline" color={c.danger.onSolid} style={styles.countText}>{unread > 9 ? "9+" : String(unread)}</Text>
        </View>
      ) : undefined} />
  );
}

/** The bar on tab roots: club switcher + bell (the web's phone top bar). */
export function ShellHeader() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + theme.space[1], paddingBottom: theme.space[1], paddingHorizontal: theme.space[2], gap: theme.space[2], backgroundColor: theme.color.canvas, borderBottomColor: theme.color.line }]}>
      <View style={styles.flex}><ClubSwitcher /></View>
      <BellButton />
    </View>
  );
}

/** The bar on screens reached from another one: back + title. `fallback` when there is no history (a deep link). */
export function BackHeader({ title, fallback }: { title: string; fallback: Href }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + theme.space[1], paddingBottom: theme.space[1], paddingHorizontal: theme.space[2], gap: theme.space[1], backgroundColor: theme.color.canvas, borderBottomColor: theme.color.line }]}>
      <IconButton icon={ArrowLeft} label={t("Voltar")} onPress={() => (router.canGoBack() ? router.back() : router.navigate(fallback))} />
      <Text variant="titleMd" accessibilityRole="header" numberOfLines={1} style={styles.flex}>{title}</Text>
    </View>
  );
}

/** Where a back bar returns to without history: Perfil's links → Perfil, the rest → "Mais" (staff) or home. */
export function backFallback(name: string, role: Role): Href {
  if (profileLinksFor(role).some((i) => routeName(i.to) === name)) return "/account";
  return role === "student" ? homeFor(role) : hrefOf("/more");
}

/** The bottom tabs (the web's phone bar): the role's tabs, plus "Mais" for staff, lit for anything reached from it. */
export function TabBar({ state, navigateToTab, role, modalities }: BottomTabBarProps & { role: Role; modalities: Sport[] }) {
  const { theme } = useTheme();
  const c = theme.color;
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index]?.name ?? "";
  const tabs = tabsFor(role, modalities).map((i) => ({ name: routeName(i.to), label: i.label, icon: i.icon }));
  if (role !== "student") tabs.push({ name: MORE, label: "Mais", icon: MenuIcon });
  // A screen without a tab lights the tab it belongs to: Perfil's links → Perfil; staff extras and the account → "Mais".
  const owner = tabs.some((x) => x.name === focused) ? focused
    : profileLinksFor(role).some((i) => routeName(i.to) === focused) ? "account"
    : role !== "student" && (focused === "account" || moreFor(role, modalities).some((g) => g.items.some((i) => routeName(i.to) === focused))) ? MORE : "";
  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route) navigateToTab(route.key);
  };
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t("Navegação principal")}
      style={[styles.tabs, { paddingBottom: insets.bottom, backgroundColor: c.surface, borderTopColor: c.line }]}>
      {tabs.map((tab) => {
        const active = tab.name === owner;
        const I = tab.icon;
        return (
          <Pressable key={tab.name} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t(tab.label)} onPress={() => go(tab.name)}
            style={({ pressed }) => [styles.tab, { minHeight: theme.size.touchMin + theme.space[3], gap: theme.space["0.5"], opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.pill, { height: theme.space[6] + theme.space[1], width: theme.space[12], borderRadius: theme.radius.full, backgroundColor: active ? c.brand.subtle : "transparent" }]}>
              <I size={theme.size.iconMd} color={active ? c.brand.subtleFg : c.fgMuted} aria-hidden />
            </View>
            <Text variant="overline" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} color={active ? c.fg : c.fgMuted} style={styles.tabLabel}>{t(tab.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  icon: { flexShrink: 0 },
  switcher: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%" },
  count: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  countText: { textTransform: "none" },
  tabs: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  pill: { alignItems: "center", justifyContent: "center" },
  // The web's 11 px tab labels (the overline size), in sentence case: "Planejamento" fits five tabs on a 360 pt phone.
  tabLabel: { textTransform: "none", letterSpacing: 0, fontWeight: weight("semibold") },
});

/**
 * A6/A7 · Seus clubes: pick the active club, or (no club yet) open an invite or create a club. Runflow's brand (D-024).
 * Creating a club comes to the app with X9; until then it opens the web app when the app knows where it is.
 */
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { signOut } from "@/api/auth";
import type { MembershipContext } from "@/api/types";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { ROLE_LABEL, homeFor, inviteTokenFrom, selectClub, useClub } from "@/lib/club";
import { useSession } from "@/lib/session";
import { hasWeb, openOnWeb } from "@/lib/web";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Divider, Field, IconButton, Input, Screen, Skeleton, Text } from "@/ui";
import { ArrowLeft, ChevronRight, ExternalLink, LogOut, Ticket } from "@/ui/icons";

export default function ClubsScreen() {
  const { signedIn } = useSession();
  if (!signedIn) return <Redirect href={{ pathname: "/login", params: { redirect: "/clubs" } }} />;
  return <Clubs />;
}

function Clubs() {
  const { theme } = useTheme();
  const c = theme.color;
  const { me, meQuery, ctx: current } = useClub();
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const list = me?.memberships ?? [];
  const open = (m: MembershipContext) => {
    selectClub(m);
    // Back into the app when it is under this screen (opened from the club switcher), else into it.
    router.dismissTo(homeFor(m.membership.role));
  };
  const goInvite = () => {
    const token = inviteTokenFrom(invite);
    if (!token) return setInviteError(t("Cole o link do convite que chegou no seu e-mail, como runflow.club/invite/…"));
    router.push({ pathname: "/invite/[token]", params: { token } });
  };

  return (
    <Screen insetTop insetBottom onRefresh={() => meQuery.refetch()} refreshing={meQuery.isRefetching}>
      <View style={[styles.header, { gap: theme.space[2] }]}>
        {current && (
          <IconButton icon={ArrowLeft} label={t("Voltar")} style={{ marginLeft: -theme.space[2] }}
            onPress={() => (router.canGoBack() ? router.back() : router.replace(homeFor(current.membership.role)))} />
        )}
        <RunflowWordmark style={styles.flex} />
        <Button variant="ghost" size="sm" icon={LogOut} onPress={async () => { await signOut(); router.replace("/login"); }}>{t("Sair")}</Button>
      </View>
      {!me ? (
        <View style={{ gap: theme.space[3] }}><Skeleton style={{ width: "50%", height: theme.space[8] }} /><Skeleton style={{ height: theme.space[20] }} /><Skeleton style={{ height: theme.space[20] }} /></View>
      ) : list.length ? (
        <View style={{ gap: theme.space[4] }}>
          <View style={{ gap: theme.space[1] }}>
            <Text variant="displaySm" accessibilityRole="header">{t("Seus clubes")}</Text>
            <Text tone="muted">{t("Olá, {name}. Escolha onde você quer entrar.", { name: me.user.name.split(" ")[0]! })}</Text>
          </View>
          <View style={{ gap: theme.space[2] }} accessibilityRole="list">
            {list.map((m) => (
              <Card key={m.club.id} onPress={() => open(m)} accessibilityRole="button"
                accessibilityLabel={`${m.club.name}, ${t(ROLE_LABEL[m.membership.role])}${current?.club.id === m.club.id ? `, ${t("Atual")}` : ""}`}
                style={[styles.club, { gap: theme.space[4], padding: theme.space[4] }]}>
                <ClubLogo club={m.club} branding={m.branding} size={theme.space[12] - theme.space[1]} />
                <View style={styles.flex}>
                  <Text variant="labelMd" numberOfLines={1}>{m.club.name}</Text>
                  <Text variant="bodySm" tone="muted" numberOfLines={1}>{t(ROLE_LABEL[m.membership.role])}{m.club.city ? ` · ${m.club.city}` : ""}</Text>
                </View>
                {current?.club.id === m.club.id && <Badge tone="brand">{t("Atual")}</Badge>}
                <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />
              </Card>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="displaySm" accessibilityRole="header">{t("Você ainda não está em um clube")}</Text>
          <Text tone="muted">{t("Abra o convite que chegou no seu e-mail ou crie o seu clube grátis.")}</Text>
        </View>
      )}

      <Card style={{ padding: theme.space[5], gap: theme.space[4] }}>
        <Field label={t("Tenho um convite")} error={inviteError} hint={t("Cole o link ou o código do convite.")}>
          {(a) => (
            <Input {...a} value={invite} placeholder="runflow.club/invite/…" autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={goInvite}
              onChangeText={(v) => { setInvite(v); setInviteError(null); }} />
          )}
        </Field>
        <Button variant="secondary" icon={Ticket} onPress={goInvite}>{t("Usar convite")}</Button>
        <Divider />
        <View style={{ gap: theme.space[1] }}>
          <Text variant="titleMd" accessibilityRole="header">{t("Criar um clube")}</Text>
          <Text variant="bodySm" tone="muted">{t("Para assessorias, academias e equipes de natação. Grátis até 10 alunos.")}</Text>
        </View>
        {hasWeb ? (
          <Button icon={ExternalLink} onPress={() => openOnWeb("/clubs/new")}>{t("Criar meu clube na web")}</Button>
        ) : (
          <Text variant="bodySm" tone="muted">{t("Por enquanto, o clube é criado no Runflow pelo computador.")}</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  club: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

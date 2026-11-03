/**
 * A3 · Convite: personal invite (D-023), in Runflow's brand with the club's logo and name (D-024). Opened from the
 * e-mail link: `runflow://invite/<token>` or the web path `/invite/<token>` (Android App Links / iOS Universal Links
 * map https://<host>/invite/<token> here once they are set up). Only the invited e-mail can accept.
 */
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAcceptInvite, usePublicInvite } from "@/api/clubs";
import { fetchMe, meKey, useMe } from "@/api/me";
import { signOut } from "@/api/auth";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { homeFor, selectClub } from "@/lib/club";
import { fullDate, localDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, ButtonLink, Card, EmptyState, Screen, Skeleton, Text, toast } from "@/ui";
import { CircleAlert, LogIn, LogOut, Mail, MapPin, Users } from "@/ui/icons";

const REASON: Record<string, [string, string]> = {
  revoked: ["Este convite foi cancelado", "Peça um novo convite para quem te convidou."],
  expired: ["Este convite expirou", "Os convites valem 7 dias. Peça para quem te convidou reenviar."],
  accepted: ["Este convite já foi usado", "Ele já foi aceito. Entre com sua conta para abrir o clube."],
  club_full: ["O clube está lotado", "O clube atingiu o limite de alunos do plano. Avise o seu treinador para liberar novas vagas."],
};

export default function InviteScreen() {
  const { theme } = useTheme();
  const c = theme.color;
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = String(raw ?? "");
  const { signedIn } = useSession();
  const inv = usePublicInvite(token);
  const accept = useAcceptInvite();
  const me = useMe().data;

  const join = () =>
    accept.mutate(token, {
      onSuccess: async (r) => {
        const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
        const m = me.memberships.find((x) => x.club.id === r.club.id) ?? null;
        selectClub(m);
        if (!r.already_member) toast.success(t("Você entrou no {club}!", { club: r.club.name }));
        if (r.already_member) return router.replace(homeFor(m?.membership.role));
        // A new student goes through the welcome (consent → profile → Strava, A4); staff land on the Painel.
        router.replace(r.membership.role === "student" ? "/welcome" : homeFor(r.membership.role));
      },
      onError: toast.error,
    });
  const switchAccount = async (email: string | null) => {
    await signOut();
    router.replace({ pathname: "/login", params: { redirect: `/invite/${token}`, ...(email && { email }) } });
  };

  const d = inv.data;
  const notFound = inv.error instanceof ApiError && inv.error.status === 404;
  return (
    <Screen insetTop insetBottom contentStyle={styles.page}>
      <RunflowWordmark style={styles.mark} />
      <View style={styles.center}>
        {inv.isPending ? (
          <Card style={[styles.loading, { padding: theme.space[8], gap: theme.space[4] }]}>
            <Skeleton style={{ width: theme.space[20], height: theme.space[20], borderRadius: theme.radius.xl }} />
            <Skeleton style={{ width: "80%", height: theme.space[6] }} />
            <Skeleton style={{ width: "60%" }} />
          </Card>
        ) : inv.isError && !notFound ? (
          <Card>
            <EmptyState icon={CircleAlert} title={inv.error instanceof ApiError ? inv.error.title : t("Algo deu errado")}
              action={<Button variant="secondary" onPress={() => inv.refetch()} loading={inv.isFetching}>{t("Tentar de novo")}</Button>}>
              {inv.error instanceof ApiError ? inv.error.detail : t("Tente novamente em instantes.")}
            </EmptyState>
          </Card>
        ) : notFound || !d ? (
          <Card>
            <EmptyState icon={CircleAlert} title={t("Convite não encontrado")} action={<ButtonLink href="/" variant="secondary" replace>{t("Voltar")}</ButtonLink>}>
              {t("O link pode ter sido trocado por um mais novo. Abra o último e-mail de convite ou peça para reenviar.")}
            </EmptyState>
          </Card>
        ) : (
          <Card style={styles.card}>
            <View style={{ height: theme.space[20], alignSelf: "stretch", backgroundColor: c.brand.solid }} />
            <View style={{ marginTop: -theme.space[12], padding: theme.space[1], borderRadius: theme.radius.xl, backgroundColor: c.surface }}>
              <ClubLogo club={d.club} branding={d.branding} size={theme.space[20]} />
            </View>
            <View style={[styles.text, { gap: theme.space[2], paddingHorizontal: theme.space[6], marginTop: theme.space[4] }]}>
              <Text variant="overline" tone="muted" style={styles.centerText}>
                {d.invited_by ? (d.name ? t("{name}, {by} te convidou", { name: d.name, by: d.invited_by }) : t("{name} te convidou", { name: d.invited_by })) : t("Você foi convidado(a)")}
              </Text>
              <Text variant="displaySm" accessibilityRole="header" style={styles.centerText}>{d.club.name}</Text>
              <Text tone="muted" style={styles.centerText}>{d.role === "trainer" ? t("Entre na equipe de treinadores do clube.") : t("Seus treinos, sua agenda e o seu progresso, com o clube junto.")}</Text>
            </View>
            {d.club.modalities.length > 0 && (
              <View style={[styles.wrap, { gap: theme.space[2], paddingHorizontal: theme.space[6], marginTop: theme.space[4] }]}>
                {d.club.modalities.map((s) => <SportChip key={s} sport={s} size="sm" />)}
              </View>
            )}
            <View style={[styles.meta, { gap: theme.space[2], paddingHorizontal: theme.space[6], marginTop: theme.space[5] }]}>
              <View style={[styles.line, { gap: theme.space["1.5"] }]}>
                <Mail size={theme.size.iconSm} color={c.fgMuted} style={styles.icon} aria-hidden />
                <Text variant="bodySm" style={styles.shrink}>
                  {t("Convite para {email}", { email: d.email_hint })}{d.valid ? ` · ${t("vale até {d}", { d: fullDate(localDate(d.expires_at)) })}` : ""}
                </Text>
              </View>
              {d.club.city && (
                <View style={[styles.line, { gap: theme.space["1.5"] }]}>
                  <MapPin size={theme.size.iconSm} color={c.fgMuted} style={styles.icon} aria-hidden />
                  <Text variant="bodySm" tone="muted">{d.club.city}{d.club.state ? ` · ${d.club.state}` : ""}</Text>
                </View>
              )}
              {d.members > 0 && (
                <View style={[styles.line, { gap: theme.space["1.5"] }]}>
                  <Users size={theme.size.iconSm} color={c.fgMuted} style={styles.icon} aria-hidden />
                  <Text variant="bodySm" tone="muted">{tn(d.members, "{n} aluno treinando", "{n} alunos treinando")}</Text>
                </View>
              )}
            </View>
            <View style={[styles.actions, { gap: theme.space[3], padding: theme.space[5], marginTop: theme.space[5], backgroundColor: c.sunken, borderTopColor: c.lineSubtle }]}>
              {!d.valid && d.reason ? (
                <View style={{ gap: theme.space[1] }} accessibilityRole="alert">
                  <View style={[styles.line, { gap: theme.space[2] }]}>
                    <CircleAlert size={theme.size.iconMd} color={c.danger.text} style={styles.icon} aria-hidden />
                    <Text variant="labelMd" tone="danger" style={styles.shrink}>{t(REASON[d.reason]![0])}</Text>
                  </View>
                  <Text variant="bodySm" tone="muted">{t(REASON[d.reason]![1])}</Text>
                </View>
              ) : d.already_member ? (
                <Button size="lg" block onPress={join} loading={accept.isPending}>{t("Você já participa. Abrir o clube")}</Button>
              ) : signedIn && d.email_matches === false ? (
                <>
                  <View style={[styles.line, styles.top, { gap: theme.space[2] }]}>
                    <CircleAlert size={theme.size.iconMd} color={c.warning.text} style={styles.icon} aria-hidden />
                    <Text variant="bodySm" style={styles.shrink}>{t("Você entrou como {me}, mas este convite é para {email}. Entre com o e-mail que recebeu o convite.", { me: me?.user.email ?? "", email: d.email_hint })}</Text>
                  </View>
                  <Button size="lg" block variant="secondary" icon={LogOut} onPress={() => switchAccount(d.email)}>{t("Sair e entrar com outro e-mail")}</Button>
                </>
              ) : signedIn ? (
                <Button size="lg" block onPress={join} loading={accept.isPending}>{d.role === "trainer" ? t("Entrar como treinador(a)") : t("Aceitar convite")}</Button>
              ) : (
                <>
                  <ButtonLink size="lg" block icon={LogIn} href={{ pathname: "/login", params: { redirect: `/invite/${token}`, ...(d.email && { email: d.email }) } }}>{t("Entrar para aceitar")}</ButtonLink>
                  <Text variant="caption" tone="muted" style={styles.centerText}>{t("Entre com o e-mail que recebeu o convite ({email}) e receba um código.", { email: d.email_hint })}</Text>
                </>
              )}
            </View>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  mark: { opacity: 0.8 },
  center: { flex: 1, justifyContent: "center" },
  loading: { alignItems: "center" },
  card: { alignItems: "center", overflow: "hidden" },
  text: { alignItems: "center", alignSelf: "stretch" },
  centerText: { textAlign: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  meta: { alignItems: "center", alignSelf: "stretch" },
  line: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  shrink: { flexShrink: 1 },
  icon: { flexShrink: 0 },
  actions: { alignSelf: "stretch", borderTopWidth: StyleSheet.hairlineWidth },
});

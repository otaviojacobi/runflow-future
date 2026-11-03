/**
 * The signed-in app (A6): only with a session and a club (else sign-in or the club list), in the active club's colors
 * from the cached `/me`, so the first frame is already themed (root.md §7.8, D-024). Tabs per role: students get
 * Hoje, Agenda, Mensagens, Perfil (D-035); staff get the web's phone tabs (Painel, Alunos, Planejamento, Feedbacks,
 * Mais). A route of the other role redirects to this role's home.
 */
import { Redirect, usePathname } from "expo-router";
import { StyleSheet } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import type { Role, Sport } from "@/api/types";
import { signOut } from "@/api/auth";
import { BackHeader, ShellHeader, TabBar, backFallback, isTabRoot } from "@/components/shell/Shell";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { clubColors, homeFor, useClub } from "@/lib/club";
import { useSession } from "@/lib/session";
import { ThemeScope, useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Screen, Spinner } from "@/ui";
import { CircleAlert, LogOut } from "@/ui/icons";

export default function AppLayout() {
  const { signedIn } = useSession();
  const path = usePathname();
  const { me, meQuery, ctx, role } = useClub();
  if (!signedIn) return <Redirect href={{ pathname: "/login", params: { redirect: path } }} />;
  if (!me) return <NoMe error={meQuery.error} retrying={meQuery.isFetching} retry={() => meQuery.refetch()} />;
  if (!ctx || !role) return <Redirect href="/clubs" />;
  return (
    <ThemeScope club={clubColors(ctx.branding)}>
      <ClubTabs role={role} modalities={ctx.club.modalities} />
    </ThemeScope>
  );
}

function ClubTabs({ role, modalities }: { role: Role; modalities: Sport[] }) {
  const { theme } = useTheme();
  const staff = role !== "student";
  return (
    <Tabs
      backBehavior="history"
      tabBar={(p) => <TabBar {...p} role={role} modalities={modalities} />}
      screenOptions={({ route }) => ({
        sceneStyle: { backgroundColor: theme.color.canvas },
        header: ({ options }) => (isTabRoot(route.name, role, modalities) ? <ShellHeader /> : <BackHeader title={options.title ?? ""} fallback={backFallback(route.name, role)} />),
      })}
    >
      <Tabs.Protected guard={!staff} redirectTo={homeFor(role)}>
        <Tabs.Screen name="today" options={{ title: t("Hoje") }} />
        <Tabs.Screen name="schedule" options={{ title: t("Agenda") }} />
        <Tabs.Screen name="workouts/[id]" options={{ title: t("Treino") }} />
        <Tabs.Screen name="activities" options={{ title: t("Atividades") }} />
        <Tabs.Screen name="activities/[id]" options={{ title: t("Atividade") }} />
        <Tabs.Screen name="races" options={{ title: t("Provas") }} />
      </Tabs.Protected>
      <Tabs.Protected guard={staff} redirectTo={homeFor(role)}>
        <Tabs.Screen name="dashboard" options={{ title: t("Painel") }} />
        <Tabs.Screen name="students" options={{ title: t("Alunos") }} />
        <Tabs.Screen name="students/[id]" options={{ title: t("Aluno") }} />
        <Tabs.Screen name="planning" options={{ title: t("Planejamento") }} />
        <Tabs.Screen name="feedback" options={{ title: t("Feedbacks") }} />
        <Tabs.Screen name="more" options={{ title: t("Mais") }} />
        <Tabs.Screen name="races/manage" options={{ title: t("Provas e eventos") }} />
        <Tabs.Screen name="assessments" options={{ title: t("Avaliações e testes") }} />
        <Tabs.Screen name="reports" options={{ title: t("Relatórios") }} />
      </Tabs.Protected>
      {/* The exercise library is for clubs that teach musculação (D-035). */}
      <Tabs.Protected guard={staff && modalities.includes("strength")} redirectTo={homeFor(role)}>
        <Tabs.Screen name="exercises" options={{ title: t("Exercícios") }} />
      </Tabs.Protected>
      <Tabs.Screen name="messages" options={{ title: t("Mensagens") }} />
      <Tabs.Screen name="account" options={{ title: staff ? t("Minha conta") : t("Perfil") }} />
      {/* Every route must be declared here: an undeclared one redirects to the first tab (SDK 58 tabs). */}
      <Tabs.Screen name="account/personal" options={{ title: t("Dados pessoais") }} />
      <Tabs.Screen name="account/notifications" options={{ title: t("Notificações") }} />
      <Tabs.Screen name="account/privacy" options={{ title: t("Privacidade e dados") }} />
      <Tabs.Screen name="account/devices" options={{ title: t("Aparelhos conectados") }} />
      <Tabs.Screen name="account/connections" options={{ title: t("Relógios e apps") }} />
      <Tabs.Protected guard={!staff} redirectTo="/account">
        <Tabs.Screen name="account/profile" options={{ title: t("Perfil de atleta") }} />
      </Tabs.Protected>
      <Tabs.Screen name="notifications" options={{ title: t("Notificações") }} />
    </Tabs>
  );
}

/** Signed in without a `/me` on the device yet: loading, or why it failed (offline on a first start). */
function NoMe({ error, retrying, retry }: { error: Error | null; retrying: boolean; retry: () => void }) {
  if (!error) return <Screen insetTop insetBottom contentStyle={[styles.center, styles.middle]}><Spinner /></Screen>;
  return (
    <Screen insetTop insetBottom contentStyle={styles.center}>
      <Card>
        <EmptyState icon={CircleAlert} title={error instanceof ApiError ? error.title : t("Algo deu errado")}
          action={<Button variant="secondary" loading={retrying} onPress={retry}>{t("Tentar de novo")}</Button>}>
          {error instanceof ApiError ? error.detail : t("Tente novamente em instantes.")}
        </EmptyState>
      </Card>
      <Button variant="ghost" icon={LogOut} onPress={() => void signOut()}>{t("Sair")}</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center" },
  middle: { alignItems: "center" },
});

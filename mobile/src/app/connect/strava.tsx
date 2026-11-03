/**
 * /connect/strava: where Strava's answer lands when it arrives as a link into the app (the Strava app handled the
 * authorization) instead of inside the auth session. Finishes the connection once (lib/strava.ts) and goes back to the
 * screen that started it. Runflow's theme: it's a pass-through screen.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { t } from "@/i18n";
import { useSession } from "@/lib/session";
import { finishStrava, stravaBack, stravaFailure } from "@/lib/strava";
import { Button, Card, EmptyState, Screen, Spinner, Text } from "@/ui";
import { CircleAlert } from "@/ui/icons";

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace((stravaBack() ?? "/account") as "/account");
};

export default function ConnectStravaScreen() {
  const { signedIn } = useSession();
  const { code, state, scope, error } = useLocalSearchParams<{ code?: string; state?: string; scope?: string; error?: string }>();
  const [failure, setFailure] = useState<string | null>(error ? stravaFailure(error) : code ? null : stravaFailure("missing_code"));
  useEffect(() => {
    if (!signedIn || !code || error) return;
    finishStrava({ code, state, scope }).then(leave, (err: unknown) => setFailure(stravaFailure(err)));
  }, [signedIn, code, state, scope, error]);

  if (!signedIn) {
    return (
      <Screen insetTop insetBottom contentStyle={styles.center}>
        <Card><EmptyState icon={CircleAlert} title={t("Entre para conectar o Strava")} action={<Button onPress={() => router.replace("/login")}>{t("Entrar")}</Button>} /></Card>
      </Screen>
    );
  }
  return (
    <Screen insetTop insetBottom contentStyle={styles.center}>
      {failure ? (
        <Card>
          <EmptyState icon={CircleAlert} title={t("Não conectamos o Strava")} action={<Button variant="secondary" onPress={leave}>{t("Voltar")}</Button>}>
            {failure}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Spinner label={t("Conectando o Strava…")} />
          <Text variant="titleSm" style={styles.text}>{t("Conectando o Strava…")}</Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  text: { textAlign: "center" },
});

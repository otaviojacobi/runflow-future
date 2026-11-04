/**
 * M6 · Check-in by link: the QR at the venue encodes `<app>/classes/check-in?session=<id>&code=<code>`. Opened in the
 * app (a link, or once the hosts serve App Links), it checks the student in once and says how it went; the in-app
 * scanner in Aulas posts the same thing without this screen.
 */
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useCheckIn, useClassSession } from "@/api/classes";
import { whenLabel } from "@/components/classes/parts";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { today as todayFn } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Screen, Spinner, Text } from "@/ui";
import { CircleAlert, CircleCheck } from "@/ui/icons";

export default function CheckInScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const { session, code } = useLocalSearchParams<{ session?: string; code?: string }>();
  const checkIn = useCheckIn(club?.id ?? "");
  const s = useClassSession(club?.id, session);
  const sent = useRef(false);
  useEffect(() => {
    if (!club || !session || !code || sent.current) return;
    sent.current = true;
    checkIn.mutate({ sessionId: session, code });
  }, [club, session, code, checkIn]);
  if (!club) return null;
  const tz = club.timezone;
  const open = () => router.replace((session ? `/classes?session=${session}` : "/classes") as Href);
  const what = s.data ? `${s.data.class_type.name} · ${whenLabel(s.data, tz, todayFn(tz))}` : null;

  return (
    <Screen>
      {!session || !code ? (
        <Card><EmptyState icon={CircleAlert} title={t("Link de check-in incompleto")} action={<Button onPress={open}>{t("Ver aulas")}</Button>}>
          {t("Leia o QR da aula de novo, ou digite o código na aula, em Aulas.")}
        </EmptyState></Card>
      ) : checkIn.isPending || checkIn.isIdle ? (
        <View style={{ paddingVertical: theme.space[10] }}><Spinner label={t("Fazendo o check-in…")} /></View>
      ) : checkIn.isSuccess ? (
        <Card><EmptyState icon={CircleCheck} title={t("Check-in feito")} action={<Button onPress={open}>{t("Ver a aula")}</Button>}>
          {what ? t("{what}. Bom treino!", { what }) : t("Bom treino!")}
        </EmptyState></Card>
      ) : (
        <Card><EmptyState icon={CircleAlert} title={checkIn.error instanceof ApiError ? checkIn.error.title : t("Não foi possível fazer o check-in")}
          action={<Button variant="secondary" onPress={open}>{t("Abrir a aula")}</Button>}>
          {checkIn.error instanceof ApiError ? checkIn.error.detail : t("Tente novamente em instantes.")}
        </EmptyState></Card>
      )}
      {what && !checkIn.isSuccess ? <Text variant="caption" tone="muted">{what}</Text> : null}
    </Screen>
  );
}

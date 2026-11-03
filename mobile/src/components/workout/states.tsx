/**
 * States the student's screens share: the offline banner (the week saved on the device is on screen), a week the
 * trainer is still preparing (D-031), and a load error with a retry (the API's pt-BR title/detail as they come).
 */
import { StyleSheet, View } from "react-native";
import type { UnreleasedWeek } from "@/api/my";
import type { Club } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { dateTimeShort } from "@/lib/format";
import { isOfflineError, useOnline } from "@/lib/offline";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Text } from "@/ui";
import { CalendarClock, CircleAlert, WifiOff } from "@/ui/icons";

/** "Seu treinador" / "Seu professor" (clubs can relabel trainers, §4.7). */
export const coachName = (club: Pick<Club, "trainer_label">) => (club.trainer_label === "professor" ? t("Seu professor") : t("Seu treinador"));

/** Shown while the device is offline or the last refresh couldn't reach the API. */
export function OfflineBanner({ error }: { error?: unknown }) {
  const { theme } = useTheme();
  const online = useOnline();
  if (online && !isOfflineError(error)) return null;
  const c = theme.color.warning;
  return (
    <View accessible accessibilityLiveRegion="polite"
      style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2] + theme.space["0.5"], borderRadius: theme.radius.md, backgroundColor: c.subtle, borderWidth: 1, borderColor: c.border }]}>
      <WifiOff size={theme.size.iconSm} color={c.subtleFg} style={{ marginTop: theme.space["0.5"] }} aria-hidden />
      <Text variant="bodySm" color={c.subtleFg} style={styles.flex}>{t("Sem internet. Mostrando o que ficou salvo no aparelho; mudanças precisam de conexão.")}</Text>
    </View>
  );
}

/** A week (or the next one) still in preparation: when it opens, or that a notice comes when it does. */
export function PreparingWeek({ club, week, next }: { club: Pick<Club, "trainer_label" | "timezone">; week: UnreleasedWeek; next?: boolean }) {
  const coach = coachName(club);
  const when = week.auto_release_at ? dateTimeShort(week.auto_release_at, club.timezone) : null;
  const body = next
    ? when ? t("{coach} ainda está montando os treinos. Eles aparecem aqui em {when}.", { coach, when }) : t("{coach} ainda está montando os treinos. Você recebe um aviso quando forem liberados.", { coach })
    : when ? t("{coach} ainda está montando esta semana. Ela aparece aqui em {when}.", { coach, when }) : t("{coach} ainda está montando esta semana. Você recebe um aviso quando ela for liberada.", { coach });
  return (
    <Card>
      <EmptyState icon={CalendarClock} title={next ? t("Próxima semana em preparação") : t("Semana em preparação")}>{body}</EmptyState>
    </Card>
  );
}

/** Nothing on the device and the API couldn't answer: why, and a retry. */
export function LoadError({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  const offline = isOfflineError(error);
  return (
    <Card>
      <EmptyState icon={offline ? WifiOff : CircleAlert}
        title={error instanceof ApiError ? error.title : t("Algo deu errado")}
        action={<Button variant="secondary" loading={retrying} onPress={onRetry}>{t("Tentar de novo")}</Button>}>
        {offline ? t("Abra o app com internet uma vez e sua semana fica salva no aparelho.") : error instanceof ApiError ? error.detail : t("Tente novamente em instantes.")}
      </EmptyState>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
});

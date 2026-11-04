/**
 * A workout on Hoje (the web's WorkoutCard): sport and estimate, the title (opens the workout), the intensity
 * profile, the trainer's note, then either "Ver treino" + "Concluir", how it went with "Editar", or, when an activity
 * completed it automatically (D-049), "Conte como foi"; and the thread.
 */
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { PlannedWorkout } from "@/api/types";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Text } from "@/ui";
import { ChevronRight, CircleCheck, MessageSquare } from "@/ui/icons";
import { estimateText } from "@/domain/workout";
import { IntensityProfile, StatusBadge, feelingLabel } from "./workout";

/** Opens a workout; `conversation` opens it at its conversation (a new reply waits there). */
export const openWorkout = (id: string, opts?: { conversation?: boolean }) =>
  router.push({ pathname: "/workouts/[id]", params: opts?.conversation ? { id, conversa: "1" } : { id } });

export function WorkoutCard({ w, onFeedback, professor }: { w: PlannedWorkout; onFeedback: () => void; professor: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const done = w.completion;
  const est = estimateText(w);
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.between, { gap: theme.space[2] }]}>
        <SportChip sport={w.sport} />
        {est ? <Text variant="bodySm" tone="muted" style={styles.tabular}>{est}</Text> : null}
      </View>
      <Pressable accessibilityRole="link" accessibilityHint={t("Abre o treino")} onPress={() => openWorkout(w.id)}
        style={({ pressed }) => [styles.title, { gap: theme.space[2], opacity: pressed ? 0.7 : 1, minHeight: theme.size.touchMin }]}>
        <Text variant="titleLg" style={styles.flex}>{w.title}</Text>
        <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />
      </Pressable>
      <IntensityProfile structure={w.structure} sport={w.sport} />
      {w.notes ? (
        <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.md, backgroundColor: c.brand.subtle }}>
          <Text variant="bodySm" color={c.brand.subtleFg}>{w.notes}</Text>
        </View>
      ) : null}
      {done && done.reported_at === null ? (
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          <StatusBadge status={done.status} />
          <Text variant="bodySm" tone="muted">{t("pela atividade")}</Text>
          <Button variant="secondary" size="sm" onPress={onFeedback} style={styles.push}>{t("Conte como foi")}</Button>
        </View>
      ) : done ? (
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          <StatusBadge status={done.status} />
          {done.feeling ? <Text variant="bodySm" tone="muted">{feelingLabel(done.feeling)}</Text> : null}
          {done.rpe ? <Text variant="bodySm" tone="muted">· {t("PSE {n}", { n: done.rpe })}</Text> : null}
          <Button variant="ghost" size="sm" onPress={onFeedback} style={styles.push}>{t("Editar")}</Button>
        </View>
      ) : (
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Button variant="secondary" size="lg" onPress={() => openWorkout(w.id)} style={styles.flex}>{t("Ver treino")}</Button>
          <Button size="lg" icon={CircleCheck} onPress={onFeedback} style={styles.flex}>{t("Concluir")}</Button>
        </View>
      )}
      {w.comments_count > 0 && (
        <Pressable accessibilityRole="link" onPress={() => openWorkout(w.id, { conversation: true })} hitSlop={theme.space[2]}
          style={({ pressed }) => [styles.row, styles.center, { gap: theme.space["1.5"], minHeight: theme.size.touchMin - theme.space[3], opacity: pressed ? 0.7 : 1 }]}>
          <MessageSquare size={theme.size.iconSm} color={c.brand.text} aria-hidden />
          <Text variant="labelSm" tone="brand">
            {!w.unread_count ? tn(w.comments_count, "{n} mensagem", "{n} mensagens")
              : professor ? tn(w.unread_count, "{n} mensagem nova do professor", "{n} mensagens novas do professor")
              : tn(w.unread_count, "{n} mensagem nova do treinador", "{n} mensagens novas do treinador")}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  row: { flexDirection: "row" },
  center: { alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  title: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  push: { marginLeft: "auto" },
  tabular: { fontVariant: ["tabular-nums"] },
});

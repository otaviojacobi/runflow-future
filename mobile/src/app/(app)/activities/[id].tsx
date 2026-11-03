/**
 * M4 · Atividade (the web's screens/student/ActivityDetail.tsx): the numbers, the planned workout it matched (with
 * how much was done), per-km splits as bars (longer = faster) and, for manual ones, removing it.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDeleteActivity, useMyActivity } from "@/api/activities";
import { SportChip } from "@/components/sport";
import { Stat } from "@/components/workout/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { distance, duration, km, localDate, longDate, pace, timeOf, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, EmptyState, Screen, Skeleton, Text, toast } from "@/ui";
import { ChevronRight, SearchX, Trash2 } from "@/ui/icons";

export default function ActivityScreen() {
  const { theme } = useTheme();
  const c = theme.color;
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useMyActivity(String(id ?? ""));
  const del = useDeleteActivity();
  const [confirm, setConfirm] = useState(false);
  const a = q.data;

  if (!a) {
    return (
      <Screen>
        {q.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : (
          <Card><EmptyState icon={SearchX} title={q.error instanceof ApiError ? q.error.title : t("Atividade não encontrada.")}
            action={<Button variant="secondary" onPress={() => router.navigate("/activities")}>{t("Ver atividades")}</Button>}>
            {q.error instanceof ApiError ? q.error.detail : null}
          </EmptyState></Card>
        )}
      </Screen>
    );
  }
  const laps = (a.laps ?? []).filter((l) => l.distance_m > 0);
  const paces = laps.map((l) => l.duration_s / (l.distance_m / 1000));
  const fastest = Math.min(...paces), slowest = Math.max(...paces);
  const m = a.matched_workout;
  const swim = a.sport === "swim";
  const stats = [
    a.distance_m ? { value: swim ? String(a.distance_m) : km(a.distance_m), unit: swim ? "m" : "km", label: t("Distância") } : null,
    { value: duration(a.moving_time_s ?? a.duration_s), label: t("Tempo em movimento") },
    a.avg_pace_s_per_km ? { value: pace(a.avg_pace_s_per_km), unit: "/km", label: t("Pace médio") } : null,
    a.avg_hr ? { value: String(a.avg_hr), unit: "bpm", label: t("FC média") } : null,
    a.max_hr ? { value: String(a.max_hr), unit: "bpm", label: t("FC máxima") } : null,
    a.elevation_gain_m ? { value: String(a.elevation_gain_m), unit: "m", label: t("Ganho de elevação") } : null,
    a.calories ? { value: String(a.calories), unit: "kcal", label: t("Calorias") } : null,
  ].filter((x) => x !== null);

  return (
    <Screen>
      <View style={{ gap: theme.space[2] }}>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          <SportChip sport={a.sport} />
          <Text variant="bodySm" tone="muted">{upperFirst(longDate(localDate(a.started_at)))} · {timeOf(a.started_at)}</Text>
        </View>
        <Text variant="displaySm" accessibilityRole="header">{a.name}</Text>
        <Text variant="bodySm" tone="muted">{a.source === "strava" ? t("Sincronizada do Strava") : t("Registrada manualmente")}</Text>
      </View>

      <Card style={[styles.wrap, { padding: theme.space[4], rowGap: theme.space[4] }]}>
        {stats.map((s, i) => <Stat key={s.label} size={i < 2 ? "lg" : "md"} value={s.value} unit={s.unit} label={s.label} style={styles.half} />)}
      </Card>

      {m && (
        <Pressable accessibilityRole="link" accessibilityLabel={t("Treino planejado: {x}", { x: m.title })} onPress={() => router.push({ pathname: "/workouts/[id]", params: { id: m.id } })}
          style={({ pressed }) => [styles.row, { gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: c.brand.border, backgroundColor: pressed ? c.brand.subtleHover : c.brand.subtle }]}>
          <View style={styles.flex}>
            <Text variant="caption" color={c.brand.subtleFg}>{t("Treino planejado")}</Text>
            <Text variant="labelMd" numberOfLines={1} color={c.brand.subtleFg}>{m.title}</Text>
            {(m.est_distance_m || m.est_duration_s) ? (
              <Text variant="bodySm" color={c.brand.subtleFg}>{t("Planejado: {x}", { x: [m.est_distance_m && distance(m.est_distance_m), m.est_duration_s && duration(m.est_duration_s)].filter(Boolean).join(" · ") })}</Text>
            ) : null}
          </View>
          {m.compliance_pct != null && (
            <View style={styles.end}>
              <Text variant="metricMd" color={c.brand.subtleFg}>{m.compliance_pct}%</Text>
              <Text variant="caption" color={c.brand.subtleFg}>{t("cumprido")}</Text>
            </View>
          )}
          <ChevronRight size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />
        </Pressable>
      )}

      {laps.length > 0 && (
        <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <View style={[styles.between, { gap: theme.space[2] }]}>
            <Text variant="titleSm" accessibilityRole="header">{t("Parciais por km")}</Text>
            <Text variant="caption" tone="muted">{t("barra maior = mais rápido")}</Text>
          </View>
          <View accessibilityRole="list" style={{ gap: theme.space["1.5"] }}>
            {laps.map((l, i) => {
              const p = paces[i]!;
              const w = slowest === fastest ? 100 : 55 + ((slowest - p) / (slowest - fastest)) * 45;
              return (
                <View key={i} accessible accessibilityLabel={t("km {n}: {p} /km", { n: i + 1, p: pace(p) })} style={[styles.row, { gap: theme.space[2] }]}>
                  <Text variant="caption" tone="muted" style={[styles.tabular, { width: theme.space[6] }]}>{i + 1}</Text>
                  <View style={styles.flex}>
                    <View style={{ width: `${w}%`, height: theme.space[5], borderTopRightRadius: theme.radius.xs, borderBottomRightRadius: theme.radius.xs, backgroundColor: c.brand.text, opacity: p === fastest ? 1 : 0.75 }} />
                  </View>
                  <Text variant="labelSm" style={[styles.tabular, styles.right, { width: theme.space[12] }]}>{pace(p)}</Text>
                  <Text variant="caption" tone="muted" style={[styles.tabular, styles.right, { width: theme.space[16] }]}>{l.avg_hr ? `${l.avg_hr} bpm` : ""}</Text>
                </View>
              );
            })}
          </View>
        </Card>
      )}

      {a.source === "manual" && (
        <Button variant="ghost" icon={Trash2} style={styles.start} onPress={() => setConfirm(true)}>{t("Remover atividade")}</Button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title={t("Remover esta atividade?")} description={a.name}
        footer={<>
          <Button variant="secondary" size="lg" onPress={() => setConfirm(false)}>{t("Cancelar")}</Button>
          <Button variant="danger" size="lg" loading={del.isPending} style={styles.flex}
            onPress={() => del.mutate(a.id, { onSuccess: () => { setConfirm(false); toast.success(t("Atividade removida")); router.navigate("/activities"); }, onError: toast.error })}>
            {t("Remover")}
          </Button>
        </>}>
        <Text tone="muted">{t("Se ela estava ligada a um treino, o treino volta a ficar sem atividade.")}</Text>
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  half: { width: "50%" },
  end: { alignItems: "flex-end" },
  right: { textAlign: "right" },
  start: { alignSelf: "flex-start" },
  tabular: { fontVariant: ["tabular-nums"] },
});

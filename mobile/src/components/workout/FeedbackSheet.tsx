/**
 * M5 · "Como foi o treino?" (the web's FeedbackDialog as a bottom sheet): did it (all, part, no), effort (PSE 1–10),
 * feeling, the activity that was this workout, and a note to the trainer. The trainer is notified on save.
 */
import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { useSaveCompletion } from "@/api/my";
import type { Activity, CompletionStatus, Feeling, PlannedWorkout } from "@/api/types";
import { t } from "@/i18n";
import { distance, duration, timeOf } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Dialog, Field, Segmented, Text, Textarea, toast } from "@/ui";
import { Check } from "@/ui/icons";
import { rpeZone } from "@/domain/workout";
import { FEELINGS, RPE_LABEL } from "./workout";

type Did = "completed" | "partial" | "missed";

/** Effort 1–10: a staircase of bars in zone colors. Tap or drag anywhere on it; screen readers swipe up/down. */
function RpeScale({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const width = useRef(0);
  const set = (x: number) => {
    if (!width.current) return;
    const v = Math.min(10, Math.max(1, Math.floor((x / width.current) * 10) + 1));
    onChange(v);
  };
  const at = (e: GestureResponderEvent) => set(e.nativeEvent.locationX);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: at,
    onPanResponderMove: at,
  })).current;
  const height = theme.size.controlLg + theme.space[2];
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.between, { gap: theme.space[2] }]}>
        <Text variant="labelSm">{t("Esforço percebido (PSE)")}</Text>
        <Text variant="labelMd"><Text variant="metricMd">{value}</Text>/10 · {t(RPE_LABEL[value]!)}</Text>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t("Esforço percebido de 1 a 10")}
        accessibilityValue={{ min: 1, max: 10, now: value, text: `${value}, ${t(RPE_LABEL[value]!)}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(Math.min(10, Math.max(1, value + (e.nativeEvent.actionName === "increment" ? 1 : -1))))}
        onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
        style={[styles.scale, { height, gap: theme.space[1] }]}
        {...pan.panHandlers}
      >
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const on = n <= value;
          return (
            <View key={n} pointerEvents="none" style={[styles.cell, { gap: theme.space["0.5"] }]}>
              <View style={{
                width: "100%", height: `${34 + i * 6}%`, borderRadius: theme.radius.xs,
                backgroundColor: on ? c.zone[rpeZone(n)].solid : c.soft,
                borderWidth: n === value ? 2 : 0, borderColor: c.fg,
              }} />
            </View>
          );
        })}
      </View>
      <View style={styles.between}>
        <Text variant="caption" tone="muted">{t("Leve")}</Text>
        <Text variant="caption" tone="muted">{t("Máximo")}</Text>
      </View>
    </View>
  );
}

function FeelingPicker({ value, onChange }: { value: Feeling | null; onChange: (v: Feeling) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="labelSm" importantForAccessibility="no" accessibilityElementsHidden>{t("Como você se sentiu?")}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("Como você se sentiu?")} style={[styles.row, { gap: theme.space["1.5"] }]}>
        {FEELINGS.map((f) => {
          const on = value === f.value;
          return (
            <Pressable key={f.value} accessibilityRole="radio" accessibilityLabel={t(f.label)} accessibilityState={{ checked: on }} onPress={() => onChange(f.value)}
              style={({ pressed }) => [styles.feeling, {
                minHeight: theme.size.controlLg + theme.space[4], gap: theme.space[1], borderRadius: theme.radius.lg,
                borderColor: on ? c.brand.ring : c.line, borderWidth: on ? 2 : 1,
                backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
              }]}>
              <Text variant="titleLg" aria-hidden>{f.emoji}</Text>
              <Text variant="caption" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} color={on ? c.brand.subtleFg : c.fgMuted} style={styles.bold}>{t(f.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ActivityPicker({ activities, value, onChange }: { activities: Activity[]; value: string | null; onChange: (id: string) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="labelSm" importantForAccessibility="no" accessibilityElementsHidden>{t("Atividade deste treino")}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("Atividade deste treino")} style={{ gap: theme.space["1.5"] }}>
        {activities.map((a) => {
          const on = value === a.id;
          const meta = [timeOf(a.started_at), a.distance_m ? distance(a.distance_m) : null, duration(a.duration_s), a.source === "strava" ? "Strava" : t("manual")].filter(Boolean).join(" · ");
          return (
            <Pressable key={a.id} accessibilityRole="radio" accessibilityLabel={`${a.name}, ${meta}`} accessibilityState={{ checked: on }} onPress={() => onChange(a.id)}
              style={({ pressed }) => [styles.row, styles.center, {
                gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2],
                borderRadius: theme.radius.md, borderWidth: 1, borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
              }]}>
              <View style={[styles.radio, { width: theme.size.iconMd, height: theme.size.iconMd, borderRadius: theme.radius.full, borderColor: on ? c.brand.solid : c.lineStrong, backgroundColor: on ? c.brand.solid : c.surface }]}>
                {on && <Check size={theme.size.iconSm - 4} color={c.brand.onSolid} strokeWidth={3} aria-hidden />}
              </View>
              <View style={styles.flex}>
                <Text variant="labelMd" numberOfLines={1}>{a.name}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{meta}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FeedbackSheet({ clubId, workout, activities = [], open, onOpenChange }: { clubId: string; workout: PlannedWorkout; activities?: Activity[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const c = workout.completion;
  const { theme } = useTheme();
  const initial = (): Did => (!c ? "completed" : c.status === "skipped" ? "missed" : c.status);
  const [status, setStatus] = useState<Did>(initial);
  const [rpe, setRpe] = useState(c?.rpe ?? 6);
  const [feeling, setFeeling] = useState<Feeling | null>(c?.feeling ?? null);
  const [comment, setComment] = useState(c?.comment ?? "");
  const [activityId, setActivityId] = useState<string | null>(c?.activity_id ?? null);
  const save = useSaveCompletion(clubId);
  // Each opening starts from what was saved.
  useEffect(() => {
    if (!open) return;
    setStatus(initial()); setRpe(c?.rpe ?? 6); setFeeling(c?.feeling ?? null); setComment(c?.comment ?? ""); setActivityId(c?.activity_id ?? null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const did = status !== "missed";
  const submit = () =>
    save.mutate({ id: workout.id, status: status as CompletionStatus, rpe: did ? rpe : null, feeling: did ? feeling : null, comment: comment.trim(), activity_id: did ? activityId : null }, {
      onSuccess: () => { toast.success(did ? t("Treino registrado. Boa!") : t("Tudo bem, registramos."), t("Seu treinador foi avisado.")); onOpenChange(false); },
      onError: toast.error,
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Como foi o treino?")} description={workout.title}
      footer={<>
        <Button variant="secondary" size="lg" onPress={() => onOpenChange(false)}>{t("Cancelar")}</Button>
        <Button size="lg" onPress={submit} loading={save.isPending} style={styles.flex}>{t("Salvar")}</Button>
      </>}>
      <View style={{ gap: theme.space[6] }}>
        <Segmented<Did> label={t("Você fez o treino?")} value={status} onChange={setStatus} style={styles.stretch}
          options={[{ value: "completed", label: t("Fiz tudo") }, { value: "partial", label: t("Fiz parte") }, { value: "missed", label: t("Não fiz") }]} />
        {did && <RpeScale value={rpe} onChange={setRpe} />}
        {did && <FeelingPicker value={feeling} onChange={setFeeling} />}
        {did && activities.length > 0 && <ActivityPicker activities={activities} value={activityId} onChange={setActivityId} />}
        <Field label={did ? t("Quer contar algo ao treinador?") : t("O que aconteceu?")} optional>
          {(a) => <Textarea {...a} value={comment} onChangeText={setComment} maxLength={2000}
            placeholder={did ? t("Ex.: senti a panturrilha no final") : t("Ex.: plantão no trabalho, compenso amanhã")} />}
        </Field>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  center: { alignItems: "center" },
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  scale: { flexDirection: "row", alignItems: "flex-end" },
  cell: { flex: 1, height: "100%", justifyContent: "flex-end" },
  feeling: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  radio: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  flex: { flex: 1, minWidth: 0 },
  stretch: { alignSelf: "stretch" },
  bold: { fontWeight: weight("semibold") },
});

/**
 * M2 · Treino (student; the web's screens/student/Workout.tsx): sport, date and status, the steps with the student's
 * own paces and heart rates (resolved from their zones by the API), the trainer's note, "Concluir treino" (M5 sheet),
 * the feedback given (or, when an activity completed it automatically, "Conte como foi", D-049), the linked activity
 * and the thread with the trainer. Opens offline for this week's workouts.
 *
 * It scrolls on its own ScrollView (not `Screen`) so the composer at the bottom can scroll into view over the keyboard.
 */
import { tokens } from "@runflow/design/tokens";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { useMyWorkout, type MyWorkoutDetail } from "@/api/my";
import type { Activity } from "@/api/types";
import { SportChip } from "@/components/sport";
import { FeedbackSheet } from "@/components/workout/FeedbackSheet";
import { LoadError, OfflineBanner } from "@/components/workout/states";
import { estimateText, hasPersonalTargets } from "@/domain/workout";
import { Thread } from "@/components/workout/Thread";
import { WorkoutSteps } from "@/components/workout/WorkoutSteps";
import { IntensityProfile, Stat, StatusBadge, feelingLabel } from "@/components/workout/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { duration, km, longDate, pace, timeOf, today as todayFn, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, EmptyState, KeyboardAvoid, Skeleton, Text, useFocusedInputVisible } from "@/ui";
import { CircleCheck, Link2, SearchX } from "@/ui/icons";
import { PoweredByStrava } from "@/components/strava";

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new id is a new screen: the sheet, the draft message and the scroll start over.
  return <WorkoutBody key={id} id={String(id ?? "")} />;
}

function WorkoutBody({ id }: { id: string }) {
  const { theme } = useTheme();
  const { club, ctx } = useClub();
  const q = useMyWorkout(club?.id, id);
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const keepVisible = useFocusedInputVisible(scroll);
  if (!club || !ctx) return null;
  const w = q.data;
  const gone = q.error instanceof ApiError && q.error.status === 404 ? q.error : null;

  const refresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  let body;
  if (gone) {
    // The API's own words (removed by the trainer, or a week not released yet).
    body = (
      <Card>
        <EmptyState icon={SearchX} title={gone.title} action={<Button variant="secondary" onPress={() => router.navigate("/today")}>{t("Voltar para Hoje")}</Button>}>
          {gone.detail}
        </EmptyState>
      </Card>
    );
  } else if (w) {
    body = <Detail w={w} placeholder={q.isPlaceholderData} clubTz={club.timezone} professor={club.trainer_label === "professor"} onFeedback={() => setSheet(true)}
      thread={<Thread club={club} workoutId={w.id} day={w.date} meMembershipId={ctx.membership.id} placeholder={t("Dúvida sobre o treino? Escreva aqui")} />} />;
  } else if (q.isPending) {
    body = (
      <View style={{ gap: theme.space[4] }} accessibilityLabel={t("Carregando…")}>
        <Skeleton style={{ height: theme.space[6], width: "50%" }} />
        <Skeleton style={{ height: theme.space[10], width: "80%" }} />
        <Skeleton style={{ height: theme.space[20] * 3 }} />
      </View>
    );
  } else {
    body = <LoadError error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />;
  }

  return (
    // The keyboard never covers the conversation's composer (ui/keyboard.tsx: Android is edge-to-edge).
    <KeyboardAvoid style={{ backgroundColor: theme.color.canvas }}>
      <ScrollView ref={scroll} {...keepVisible} style={styles.fill} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.space[4], paddingTop: theme.space[5], paddingBottom: theme.space[8], gap: theme.space[5], maxWidth: theme.size.readingMax }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.color.brand.solid} colors={[theme.color.brand.solid]} progressBackgroundColor={theme.color.surface} />}>
        {!gone && <OfflineBanner error={q.error} />}
        {body}
      </ScrollView>
      {w && !gone && <FeedbackSheet clubId={club.id} workout={w} activities={w.candidate_activities} open={sheet} onOpenChange={setSheet} />}
    </KeyboardAvoid>
  );
}

function Detail({ w, placeholder, clubTz, professor, onFeedback, thread }: { w: MyWorkoutDetail; placeholder: boolean; clubTz: string; professor: boolean; onFeedback: () => void; thread: ReactNode }) {
  const { theme } = useTheme();
  const c = w.completion;
  const est = estimateText(w);
  const past = w.date < todayFn(clubTz);
  // Compliance means something only for what was done.
  const compliance = c && (c.status === "completed" || c.status === "partial") ? c.compliance_pct : null;
  // Completed from an activity (by the matching engine, or the student's answer to "qual treino?"), with nothing
  // heard from the student yet (D-049). Strictly null: an API without the field (older) means a reported one.
  const auto = c?.reported_at === null;
  const chosen = c?.matched_by === "student";
  const done = compliance != null ? t(" ({n}% do planejado)", { n: compliance }) : "";
  return (
    <>
      <View style={{ gap: theme.space[2] }}>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          <SportChip sport={w.sport} />
          <Text variant="bodySm" tone="muted">{upperFirst(longDate(w.date))}</Text>
          {c ? <StatusBadge status={c.status} /> : past ? <StatusBadge status="unlogged" /> : null}
        </View>
        <Text variant="displaySm" accessibilityRole="header">{w.title}</Text>
        {est ? <Text tone="muted">{est}</Text> : null}
      </View>

      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <IntensityProfile structure={w.structure} sport={w.sport} height={theme.space[16]} />
        <WorkoutSteps structure={w.structure} sport={w.sport} />
        {!placeholder && hasPersonalTargets(w.structure) && <Text variant="caption" tone="muted">{t("Os ritmos e faixas de FC já são os seus, calculados pelas suas zonas.")}</Text>}
      </Card>

      {w.notes ? (
        <Card style={[styles.row, { gap: theme.space[3], padding: theme.space[4] }]}>
          {w.coach && <Avatar name={w.coach.name} src={w.coach.avatar_url} size={theme.space[10]} />}
          <View style={styles.flex}>
            <Text variant="labelSm">{w.coach ? w.coach.name : professor ? t("Professor") : t("Treinador")}</Text>
            <Text>{w.notes}</Text>
          </View>
        </Card>
      ) : null}

      {auto ? (
        <Card tone="brand" style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <View style={[styles.row, { gap: theme.space[3] }]}>
            <Link2 size={theme.size.iconMd} color={theme.color.brand.subtleFg} aria-hidden />
            <View style={[styles.flex, { gap: theme.space[1] }]}>
              <Text variant="titleSm" accessibilityRole="header">{chosen ? t("Concluído com a sua atividade") : t("Concluído automaticamente")}</Text>
              <Text variant="bodySm">
                {!w.activity ? t("Uma atividade sua foi ligada a este treino.")
                  : chosen ? t("Você ligou a atividade “{x}” a este treino{p}.", { x: w.activity.name, p: done })
                  : t("Ligamos a sua atividade “{x}” a este treino{p}.", { x: w.activity.name, p: done })}
                {" "}{professor ? t("Conte como foi para o seu professor.") : t("Conte como foi para o seu treinador.")}
              </Text>
            </View>
          </View>
          <Button size="lg" block icon={CircleCheck} onPress={onFeedback}>{t("Conte como foi")}</Button>
        </Card>
      ) : (
        <Button size="lg" block icon={CircleCheck} variant={c ? "secondary" : "primary"} onPress={onFeedback}>{c ? t("Editar feedback") : t("Concluir treino")}</Button>
      )}

      {c && !auto && (c.rpe || c.feeling || c.comment || compliance != null) ? (
        <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Text variant="titleSm" accessibilityRole="header">{t("Seu feedback")}</Text>
          <View style={[styles.row, { gap: theme.space[3] }]}>
            {c.rpe ? <Stat style={styles.flex} value={String(c.rpe)} unit="/10" label={t("Esforço (PSE)")} /> : null}
            {c.feeling ? <Stat style={styles.flex} value={feelingLabel(c.feeling)} label={t("Sensação")} /> : null}
            {compliance != null ? <Stat style={styles.flex} value={`${compliance}%`} label={t("Cumprido")} /> : null}
          </View>
          {c.comment ? <Text tone="muted">“{c.comment}”</Text> : null}
        </Card>
      ) : null}

      {w.activity && <ActivityCard a={w.activity} />}

      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Text variant="titleSm" accessibilityRole="header">{professor ? t("Conversa com o professor") : t("Conversa com o treinador")}</Text>
        {thread}
      </Card>
    </>
  );
}

function ActivityCard({ a }: { a: Activity }) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={styles.between}>
        <Text variant="titleSm" accessibilityRole="header">{t("Atividade")}</Text>
        {a.source === "strava" ? <PoweredByStrava /> : <Text variant="caption" tone="muted">{t("manual")}</Text>}
      </View>
      <Text variant="bodySm" tone="muted" numberOfLines={1}>{a.name} · {timeOf(a.started_at)}</Text>
      <View style={[styles.wrap, { rowGap: theme.space[3] }]}>
        {a.distance_m ? <Stat style={styles.quarter} value={km(a.distance_m)} unit="km" label={t("Distância")} /> : null}
        <Stat style={styles.quarter} value={duration(a.duration_s)} label={t("Tempo")} />
        {a.avg_pace_s_per_km ? <Stat style={styles.quarter} value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace")} /> : null}
        {a.avg_hr ? <Stat style={styles.quarter} value={String(a.avg_hr)} unit="bpm" label={t("FC média")} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: "100%", alignSelf: "center" },
  row: { flexDirection: "row" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  quarter: { width: "25%", paddingRight: tokens.space[2] },
});

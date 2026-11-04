/**
 * Activity matching, the student's side (D-049; docs/activity-matching.md; the web's components/matching.tsx).
 * MatchQuestion asks "Qual treino foi esta atividade?" with the workouts it may be and "Nenhum destes" (on Hoje through
 * PendingMatches, inline in Atividades, on the activity); MatchSheet changes or picks the workout later ("Trocar
 * treino" / "Escolher treino" on the activity). A choice is the student's own: the engine never changes it.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useMatchActivity, usePendingMatches } from "@/api/activities";
import type { ActivityItem, MatchOption } from "@/api/types";
import { SPORT_ICON } from "@/components/sport";
import { t } from "@/i18n";
import { addDays, distance, duration, localDate, shortDate, timeOf, today as todayFn, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, Text, toast } from "@/ui";
import { CalendarCheck, Check, ChevronRight, Unlink } from "@/ui/icons";

/** "Ontem · ter, 3 nov" (today, yesterday and tomorrow say so), else "Ter, 3 nov". */
export function dayLabel(d: string, today = todayFn()): string {
  const rel = d === today ? t("Hoje") : d === addDays(today, -1) ? t("Ontem") : d === addDays(today, 1) ? t("Amanhã") : null;
  return rel ? `${rel} · ${shortDate(d)}` : upperFirst(shortDate(d));
}
/** What was planned: "8 km · 45min". */
export const plannedSize = (o: Pick<MatchOption, "sport" | "est_distance_m" | "est_duration_s">) =>
  [o.est_distance_m ? distance(o.est_distance_m, { swim: o.sport === "swim" }) : null, o.est_duration_s ? duration(o.est_duration_s) : null].filter(Boolean).join(" · ");
/** The activity in one line: "Ontem · ter, 3 nov, 06:40 · 6,6 km · 36min". */
export function activityLine(a: ActivityItem): string {
  const size = a.distance_m ? `${distance(a.distance_m, { swim: a.sport === "swim" })} · ${duration(a.moving_time_s ?? a.duration_s)}` : duration(a.moving_time_s ?? a.duration_s);
  return `${dayLabel(localDate(a.started_at))}, ${timeOf(a.started_at)} · ${size}`;
}

/** One workout to choose: title, day and what was planned. `current`: the workout it's linked to now. */
function OptionRow({ o, onPress, busy, current, disabled }: { o: MatchOption; onPress: () => void; busy: boolean; current?: boolean; disabled?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const s = c.sport[o.sport];
  const I = SPORT_ICON[o.sport];
  const size = plannedSize(o);
  const meta = [dayLabel(o.date), size ? t("planejado: {x}", { x: size }) : null].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${o.title}, ${meta}`} accessibilityState={{ selected: !!current, disabled: !!disabled, busy }}
      disabled={disabled || current} onPress={onPress}
      style={({ pressed }) => [styles.row, {
        gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2],
        borderRadius: theme.radius.md, borderWidth: 1, borderColor: current ? c.brand.ring : c.line,
        backgroundColor: current ? c.brand.subtle : pressed ? c.soft : c.surface, opacity: disabled && !busy ? 0.6 : 1,
      }]}>
      <View aria-hidden style={[styles.center, { width: theme.space[8], height: theme.space[8], borderRadius: theme.radius.md, backgroundColor: s.solid }]}>
        <I size={theme.size.iconSm} color={s.onSolid} />
      </View>
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={2}>{o.title}</Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>{meta}</Text>
      </View>
      {busy ? <ActivityIndicator color={c.brand.solid} />
        : current ? <Check size={theme.size.iconMd} color={c.brand.text} aria-hidden />
        : <ChevronRight size={theme.size.iconSm} color={c.fgSubtle} aria-hidden />}
    </Pressable>
  );
}

/** Sends the choice and says how it went; `busy` is the option being sent ("none" for "Nenhum destes"). */
function useChoose(a: ActivityItem, done?: () => void) {
  const m = useMatchActivity();
  const [busy, setBusy] = useState<string | null>(null);
  const choose = (id: string | null) => {
    setBusy(id ?? "none");
    m.mutate({ id: a.id, planned_workout_id: id }, {
      onSuccess: () => {
        if (id) toast.success(t("Atividade ligada ao treino"), a.match_options.find((o) => o.id === id)?.title);
        else toast.success(t("Marcada como treino extra"), t("Ela fica fora do planejado."));
        done?.();
      },
      onError: toast.error,
      onSettled: () => setBusy(null),
    });
  };
  return { busy, choose };
}

/**
 * "Qual treino foi esta atividade?" for a pending activity. `inline`: inside a list card, under the activity's own row
 * (no card of its own, no activity line).
 */
export function MatchQuestion({ a, inline = false, showActivity = !inline }: { a: ActivityItem; inline?: boolean; showActivity?: boolean }) {
  const { theme } = useTheme();
  const { busy, choose } = useChoose(a);
  const body = (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ gap: theme.space[1] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          {!inline && <CalendarCheck size={theme.size.iconMd} color={theme.color.brand.text} aria-hidden />}
          <Text variant={inline ? "labelMd" : "titleSm"} accessibilityRole="header" style={styles.flex}>{t("Qual treino foi esta atividade?")}</Text>
        </View>
        {showActivity && <Text variant="labelMd" numberOfLines={1}>{a.name}</Text>}
        {showActivity && <Text variant="bodySm" tone="muted">{activityLine(a)}</Text>}
        <Text variant="caption" tone="muted">{t("Ela combina com mais de um treino. Escolha o certo para o seu treinador acompanhar.")}</Text>
      </View>
      <View style={{ gap: theme.space[2] }}>
        {a.match_options.map((o) => <OptionRow key={o.id} o={o} busy={busy === o.id} disabled={!!busy} onPress={() => choose(o.id)} />)}
      </View>
      <Button variant="ghost" icon={Unlink} block loading={busy === "none"} disabled={!!busy} onPress={() => choose(null)}>{t("Nenhum destes (treino extra)")}</Button>
    </View>
  );
  if (inline) return <View style={{ paddingHorizontal: theme.space[2], paddingTop: theme.space[1], paddingBottom: theme.space[3] }}>{body}</View>;
  return <Card edge="brand" style={{ padding: theme.space[4] }}>{body}</Card>;
}

/** Hoje: every activity waiting for an answer (the last 7 days), one card each. Nothing while there's none. */
export function PendingMatches() {
  const q = usePendingMatches();
  const items = (q.data ?? []).filter((a) => a.match_options.length > 0);
  if (!items.length) return null;
  return <>{items.map((a) => <MatchQuestion key={a.id} a={a} />)}</>;
}

/**
 * "Trocar treino" (linked) or "Escolher treino" (not linked, or marked as an extra session): the detail's options,
 * nearest first, the current one checked, and "Nenhum destes" unless it's already an extra session.
 */
export function MatchSheet({ a, open, onOpenChange }: { a: ActivityItem; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const { busy, choose } = useChoose(a, () => onOpenChange(false));
  const current = a.matched_workout?.id;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={current ? t("Trocar treino") : t("Escolher treino")} description={`${a.name} · ${activityLine(a)}`}
      footer={<>
        <Button variant="secondary" size="lg" onPress={() => onOpenChange(false)} style={a.match_state === "dismissed" ? styles.flex : undefined}>{t("Cancelar")}</Button>
        {a.match_state !== "dismissed" && (
          <Button variant="secondary" size="lg" icon={Unlink} loading={busy === "none"} disabled={!!busy} onPress={() => choose(null)} style={styles.flex}>{t("Nenhum destes")}</Button>
        )}
      </>}>
      <View style={{ gap: theme.space[2] }}>
        {a.match_options.length ? a.match_options.map((o) => (
          <OptionRow key={o.id} o={o} current={o.id === current} busy={busy === o.id} disabled={!!busy} onPress={() => choose(o.id)} />
        )) : <Text tone="muted">{t("Nenhum treino seu nos 3 dias antes ou depois desta atividade.")}</Text>}
        {a.match_state !== "dismissed" && <Text variant="caption" tone="muted">{t("“Nenhum destes”: a atividade fica como treino extra, fora do planejado.")}</Text>}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
});

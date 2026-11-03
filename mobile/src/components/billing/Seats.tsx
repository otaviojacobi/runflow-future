/** Seats against the plan (D-043): a hard limit (Free, Pro) or included seats with paid extras (Max). The web's
 * SeatsSummary (Membros) and Seats (Plano e cobrança). */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { Subscription } from "@/api/types";
import { t, tn } from "@/i18n";
import { money } from "@/lib/format";
import type { Tone } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { ProgressBar, Text } from "@/ui";

const PLAN_NAME = { free: "Free", pro: "Pro", max: "Max" } as const;
const toneFor = (used: number, cap: number, hard: boolean): Tone => (!hard ? "brand" : used / Math.max(1, cap) >= 1 ? "danger" : used / Math.max(1, cap) >= 0.8 ? "warning" : "brand");

/** One line for Membros: students against the plan, trainers and the plan's name. */
export function SeatsSummary({ sub }: { sub: Subscription }) {
  const { theme } = useTheme();
  const cap = sub.student_limit ?? sub.included_students;
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.between, { gap: theme.space[3] }]}>
        <Text variant="labelMd">{sub.student_limit === null ? t("{n} alunos ({limit} incluídos)", { n: sub.active_students, limit: cap }) : t("{n} de {limit} alunos", { n: sub.active_students, limit: cap })}</Text>
        <Text variant="caption" tone="muted">{t("Plano {plan}", { plan: PLAN_NAME[sub.plan] })}</Text>
      </View>
      <ProgressBar value={Math.min(sub.active_students, cap)} max={cap} tone={toneFor(sub.active_students, cap, sub.student_limit !== null)} label={t("Alunos no plano")} />
      <Text variant="caption" tone="muted">{sub.trainer_limit === null ? tn(sub.active_trainers, "{n} treinador", "{n} treinadores") : t("{n} de {limit} treinadores", { n: sub.active_trainers, limit: sub.trainer_limit })}</Text>
    </View>
  );
}

/** A seat meter for Plano e cobrança. `one`/`other`: "Ainda cabe {n} aluno…" (pt-BR keys). */
export function SeatMeter({ label, icon, used, limit, included, each, one, other }: {
  label: string; icon: ReactNode; used: number; limit: number | null; included: number; each?: number; one: string; other: string;
}) {
  const { theme } = useTheme();
  const cap = limit ?? included;
  const full = limit !== null && used >= cap;
  const extra = Math.max(0, used - included);
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.between, { gap: theme.space[2] }]}>
        <View style={[styles.row, { gap: theme.space[2] }]}>{icon}<Text variant="labelMd">{label}</Text></View>
        <Text variant="metricMd">{used}<Text variant="bodyMd" tone="muted">/{cap}</Text></Text>
      </View>
      <ProgressBar value={Math.min(used, cap)} max={cap} tone={toneFor(used, cap, limit !== null)} label={label} />
      <Text variant="bodySm" tone={full ? undefined : "muted"} color={full ? theme.color.danger.text : undefined}>
        {limit === null
          ? extra > 0 && each !== undefined ? t("{n} além das incluídas: {price} por mês", { n: extra, price: money(extra * each) }) : t("{n} incluídas no plano; as próximas são cobradas por pessoa.", { n: included })
          : full ? t("Limite atingido. Ninguém novo entra até liberar uma vaga ou mudar de plano; quem já está continua normalmente.")
          : tn(limit - used, one, other)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
});

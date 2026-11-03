/**
 * W4 · "Copiar semana" (the web's CopyWeekDialog as a bottom sheet): this week's workouts of the students on screen,
 * onto one of the next four weeks. Copies of a future week are drafts until it's released (D-031).
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCopyWeek } from "@/api/staff";
import type { Club } from "@/api/types";
import { t, tn } from "@/i18n";
import { addDays, dayMonth } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Dialog, ListItem, Text, toast } from "@/ui";
import { Check, Copy } from "@/ui/icons";

export function CopyWeekSheet({ club, monday, athleteIds, open, onOpenChange }: { club: Club; monday: string; athleteIds: string[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const copy = useCopyWeek(club.id);
  const [weeks, setWeeks] = useState(1);
  const target = addDays(monday, weeks * 7);
  const submit = () => copy.mutate({ from_monday: monday, to_monday: target, athlete_ids: athleteIds }, {
    onSuccess: (r) => { toast.success(tn(r.copied, "{n} treino copiado", "{n} treinos copiados"), t("Para a semana de {d}.", { d: dayMonth(target) })); onOpenChange(false); },
    onError: toast.error,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Copiar semana")} description={t("Copia todos os treinos desta semana dos alunos visíveis.")}
      footer={<><Button variant="secondary" onPress={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button icon={Copy} loading={copy.isPending} disabled={!athleteIds.length} onPress={submit}>{t("Copiar")}</Button></>}>
      <View style={{ gap: theme.space[3] }}>
        {/* Inline choices: a sheet doesn't open another sheet (Select) on top of itself. */}
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Para a semana de")} style={{ gap: theme.space[1] }}>
          <Text variant="labelSm">{t("Para a semana de")}</Text>
          {[1, 2, 3, 4].map((n) => (
            <ListItem key={n} accessibilityRole="radio" selected={weeks === n} onPress={() => setWeeks(n)}
              title={`${dayMonth(addDays(monday, n * 7))} – ${dayMonth(addDays(monday, n * 7 + 6))}`} subtitle={n === 1 ? t("próxima semana") : undefined}
              trailing={weeks === n ? <Check size={theme.size.iconMd} color={theme.color.brand.subtleFg} aria-hidden /> : undefined} />
          ))}
        </View>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Check size={theme.size.iconSm} color={theme.color.success.text} aria-hidden />
          <Text variant="bodySm" tone="muted">{tn(athleteIds.length, "{n} aluno", "{n} alunos")}</Text>
        </View>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center" } });

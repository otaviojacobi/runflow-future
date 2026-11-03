/**
 * W4 · week release (D-031) on the phone: the week's state above the workouts and the sheet that releases it (to
 * everyone or a group, with or without a notice). Clubs in `immediate` mode and weeks that started show nothing.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Club } from "@/api/types";
import { useGroups, useReleaseWeek, useUndoRelease, useWeek } from "@/api/staff";
import { t, tn } from "@/i18n";
import { addDays, dateTimeShort, dayMonth } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Checkbox, Dialog, ListItem, Segmented, Text, toast } from "@/ui";
import { Check, Eye, EyeOff, Send } from "@/ui/icons";

export function WeekRelease({ club, monday }: { club: Club; monday: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const weekly = club.release_mode === "weekly";
  const week = useWeek(club.id, monday, weekly);
  const undo = useUndoRelease(club.id);
  const [open, setOpen] = useState(false);
  const w = week.data;
  if (!weekly || !w || w.started) return null;
  const tz = club.timezone;
  const box = { gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1 } as const;
  const some = w.released_athlete_ids.length;
  const banner = w.released_at ? (
    <View accessibilityRole="summary" style={[box, { borderColor: c.success.border, backgroundColor: c.success.subtle }]}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Eye size={theme.size.iconMd} color={c.success.subtleFg} aria-hidden />
        <View style={styles.flex}>
          <Text variant="labelMd" color={c.success.subtleFg}>{t("Semana liberada")}</Text>
          <Text variant="bodySm" color={c.success.subtleFg}>{t("Os alunos veem os treinos desde {when}.", { when: dateTimeShort(w.released_at, tz) })}</Text>
        </View>
      </View>
      <Button size="sm" variant="secondary" loading={undo.isPending} style={styles.end}
        onPress={() => undo.mutate(monday, { onSuccess: () => toast.info(t("Liberação desfeita"), t("A semana voltou a ser rascunho.")), onError: toast.error })}>{t("Desfazer liberação")}</Button>
    </View>
  ) : (
    <View style={[box, { borderStyle: "dashed", borderColor: c.lineStrong, backgroundColor: c.sunken }]}>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <EyeOff size={theme.size.iconMd} color={c.fgMuted} aria-hidden />
        <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
          <Text variant="labelMd">{t("Rascunho")}</Text>
          <Text variant="bodySm">
            {w.drafts ? tn(w.drafts, "{n} treino que os alunos ainda não veem", "{n} treinos que os alunos ainda não veem") : t("Os alunos ainda não veem esta semana.")}
            {some > 0 ? ` · ${tn(some, "já liberada para {n} aluno", "já liberada para {n} alunos")}` : ""}
          </Text>
          <Text variant="bodySm" tone="muted">{w.auto_release_at ? t("Liberação automática: {when}.", { when: dateTimeShort(w.auto_release_at, tz) }) : t("Sem liberação automática: libere quando estiver pronta.")}</Text>
        </View>
      </View>
      <Button icon={Send} onPress={() => setOpen(true)}>{t("Liberar semana")}</Button>
    </View>
  );
  return (
    <>
      {banner}
      {/* Mounted in both states: a release flips the banner before the sheet's success callback runs. */}
      <ReleaseSheet club={club} monday={monday} open={open} onOpenChange={setOpen} />
    </>
  );
}

function ReleaseSheet({ club, monday, open, onOpenChange }: { club: Club; monday: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const release = useReleaseWeek(club.id);
  const groups = useGroups(club.id);
  const [who, setWho] = useState<"all" | "group">("all");
  const [group, setGroup] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const range = `${dayMonth(monday)} – ${dayMonth(addDays(monday, 6))}`;
  const submit = () => release.mutate(
    { monday, notify, ...(who === "group" && group ? { group_id: group } : {}) },
    {
      onSuccess: () => { toast.success(t("Semana liberada"), notify ? t("Cada aluno com treinos recebeu um aviso.") : t("Os alunos já veem os treinos.")); onOpenChange(false); },
      onError: toast.error,
    },
  );
  const hasGroups = (groups.data?.length ?? 0) > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Liberar a semana de {range}", { range })}
      description={t("Os alunos passam a ver os treinos desta semana no app.")}
      footer={<><Button variant="secondary" onPress={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button icon={Send} loading={release.isPending} disabled={who === "group" && !group} onPress={submit}>{t("Liberar")}</Button></>}>
      <View style={{ gap: theme.space[4] }}>
        {hasGroups && (
          <Segmented label={t("Para quem")} value={who} onChange={setWho} options={[{ value: "all", label: t("Todos os alunos") }, { value: "group", label: t("Um grupo") }]} style={styles.stretch} />
        )}
        {who === "group" && (
          // Inline choices instead of a Select: a sheet doesn't open another sheet on top of itself.
          <View accessibilityRole="radiogroup" accessibilityLabel={t("Grupo")} style={{ gap: theme.space[1] }}>
            <Text variant="labelSm">{t("Grupo")}</Text>
            {(groups.data ?? []).map((g) => (
              <ListItem key={g.id} title={g.name} subtitle={tn(g.member_ids.length, "{n} aluno", "{n} alunos")} accessibilityRole="radio" selected={group === g.id} onPress={() => setGroup(g.id)}
                trailing={group === g.id ? <Check size={theme.size.iconMd} color={theme.color.brand.subtleFg} aria-hidden /> : undefined} />
            ))}
          </View>
        )}
        <Checkbox checked={notify} onCheckedChange={setNotify} label={t("Avisar os alunos")} description={t("Uma notificação por aluno com o resumo da semana.")} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  end: { alignSelf: "flex-end" },
  stretch: { alignSelf: "stretch" },
});

/**
 * W7 · Planilhas (the web's screens/staff/plans/Plans.tsx): multi-week plans with their length, workouts, weekly
 * volume bars and how many students use them. Tap to open the editor; "⋯" duplicates (same weeks and workouts, no
 * students) or archives. "Nova planilha" asks for a name and the number of weeks, then opens it.
 */
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useArchivePlan, useCreatePlan, useDuplicatePlan, usePlans } from "@/api/plans";
import type { TrainingPlan } from "@/api/types";
import { Stepper } from "@/components/account/parts";
import { VolumeBars } from "@/components/plans";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, Screen, Skeleton, Text, Textarea, toast } from "@/ui";
import { Archive, ClipboardList, Copy, MoreHorizontal, Pencil, Plus, Users } from "@/ui/icons";

const open = (id: string) => router.push({ pathname: "/plans/[id]", params: { id } });

function PlanCard({ p, onDuplicate, onArchive }: { p: TrainingPlan; onDuplicate: () => void; onArchive: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={[styles.row, styles.top, { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }]}>
      <Pressable onPress={() => open(p.id)} accessibilityRole="link"
        accessibilityLabel={[p.name, tn(p.weeks, "{n} semana", "{n} semanas"), tn(p.items_count, "{n} treino", "{n} treinos"), p.active_assignments ? tn(p.active_assignments, "{n} aluno usando", "{n} alunos usando") : t("Ninguém usando ainda")].join(", ")}
        style={({ pressed }) => [styles.flex, { gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: pressed ? c.soft : "transparent" }]}>
        <View style={{ gap: theme.space["0.5"] }}>
          <Text variant="labelMd">{p.name}</Text>
          <Text variant="bodySm" tone="muted">{tn(p.weeks, "{n} semana", "{n} semanas")} · {tn(p.items_count, "{n} treino", "{n} treinos")}</Text>
        </View>
        <VolumeBars weekly={p.weekly_duration_s} height={theme.space[10]} />
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Users size={theme.size.iconSm - 2} color={c.fgMuted} aria-hidden />
          <Text variant="caption" tone="muted" style={styles.flex}>{p.active_assignments ? tn(p.active_assignments, "{n} aluno usando", "{n} alunos usando") : t("Ninguém usando ainda")}</Text>
          <Text variant="caption" tone="muted">{t("editada {when}", { when: ago(p.updated_at) })}</Text>
        </View>
      </Pressable>
      <Menu title={p.name} trigger={(o) => <IconButton icon={MoreHorizontal} label={t("Ações para {name}", { name: p.name })} onPress={o} style={{ margin: theme.space[1] }} />} items={[
        { label: t("Editar"), icon: Pencil, onSelect: () => open(p.id) },
        { label: t("Duplicar"), icon: Copy, onSelect: onDuplicate },
        "separator",
        { label: t("Arquivar"), icon: Archive, danger: true, onSelect: onArchive },
      ]} />
    </View>
  );
}

export default function PlansScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const plans = usePlans(club?.id);
  const create = useCreatePlan(club?.id ?? "");
  const archive = useArchivePlan(club?.id ?? "");
  const duplicate = useDuplicatePlan(club?.id ?? "");
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState<number | null>(8);
  const [desc, setDesc] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  if (!club) return null;
  const err = create.error instanceof ApiError ? create.error : null;
  const refresh = async () => { setRefreshing(true); await plans.refetch(); setRefreshing(false); };
  const submit = () =>
    create.mutate({ name: name.trim(), weeks: weeks ?? 8, description: desc.trim() || undefined }, {
      onSuccess: (p) => { setSheet(false); setName(""); setDesc(""); setWeeks(8); open(p.id); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{t("Planos de várias semanas para aplicar em alunos ou grupos.")}</Text>
      <Button icon={Plus} block onPress={() => setSheet(true)}>{t("Nova planilha")}</Button>
      {plans.isPending ? (
        <View style={{ gap: theme.space[3] }}>{[1, 2].map((i) => <Skeleton key={i} style={{ height: theme.space[20] + theme.space[12] }} />)}</View>
      ) : plans.isError && !plans.data ? (
        <Card><EmptyState icon={ClipboardList} title={plans.error instanceof ApiError ? plans.error.title : t("Algo deu errado")}
          action={<Button variant="secondary" loading={plans.isFetching} onPress={() => void plans.refetch()}>{t("Tentar de novo")}</Button>}>
          {plans.error instanceof ApiError ? plans.error.detail : t("Tente novamente em instantes.")}
        </EmptyState></Card>
      ) : !plans.data?.length ? (
        <Card><EmptyState icon={ClipboardList} title={t("Nenhuma planilha ainda")} action={<Button icon={Plus} onPress={() => setSheet(true)}>{t("Criar planilha")}</Button>}>
          {t("Ex.: Base 10 km em 8 semanas, Maratona em 16 semanas.")}
        </EmptyState></Card>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {plans.data.map((p) => (
            <PlanCard key={p.id} p={p}
              onDuplicate={() => duplicate.mutate({ id: p.id, name: t("{name} (cópia)", { name: p.name }) }, { onSuccess: (copy) => { toast.success(t("Planilha duplicada")); open(copy.id); }, onError: toast.error })}
              onArchive={() => archive.mutate(p.id, { onSuccess: () => toast.success(t("Planilha arquivada"), t("Quem já usa continua com os treinos na agenda.")), onError: toast.error })} />
          ))}
        </View>
      )}

      <Dialog open={sheet} onOpenChange={setSheet} title={t("Nova planilha")}
        footer={<>
          <Button variant="secondary" size="lg" onPress={() => setSheet(false)}>{t("Cancelar")}</Button>
          <Button size="lg" loading={create.isPending} disabled={!name.trim()} onPress={submit} style={styles.flex}>{t("Criar e editar")}</Button>
        </>}>
        <View style={{ gap: theme.space[4] }}>
          <Field label={t("Nome")} error={err?.fieldError("name")}>
            {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Ex.: Meia maratona em 12 semanas")} maxLength={120} />}
          </Field>
          <Field label={t("Duração (semanas)")} error={err?.fieldError("weeks")}>
            {(a) => <Stepper label={a.accessibilityLabel} value={weeks} onChange={(v) => setWeeks(v ?? 1)} min={1} max={52} format={(v) => tn(v, "{n} semana", "{n} semanas")} />}
          </Field>
          <Field label={t("Descrição")} optional>
            {(a) => <Textarea {...a} value={desc} onChangeText={setDesc} maxLength={2000} />}
          </Field>
        </View>
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
});

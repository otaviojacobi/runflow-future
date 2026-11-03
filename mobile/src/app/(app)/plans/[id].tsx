/**
 * W7 · Planilha (the web's screens/staff/plans/PlanEditor.tsx, phone-first): the name and number of weeks, one week
 * at a time (the weekly volume bars switch weeks), the 7 days as rows; tapping a day adds a workout from the library
 * or built right there (X12's builder), tapping a workout edits or removes it. Copy a week to the next or clear it.
 * Changes are saved together ("Salvar alterações"); "Aplicar a alunos" puts the plan in students' calendars from a
 * Monday; "Quem está usando" lists the assignments and takes one off (future, not-done workouts leave the calendar).
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAssignPlan, usePlan, useSavePlanItems, useUnassignPlan, useUpdatePlan } from "@/api/plans";
import type { PlanAssignment, PlanItem } from "@/api/types";
import { ConfirmDialog, Stepper } from "@/components/account/parts";
import { VolumeBars } from "@/components/plans";
import { AthletePicker } from "@/components/staff/pickers";
import { SportBar } from "@/components/staff/workout";
import { WorkoutPicker, type WorkoutDraft } from "@/components/staff/WorkoutPicker";
import { estimateText } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, duration, mondayOf, shortDate, today as todayFn } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, ProgressBar, Skeleton, Text, Textarea, toast } from "@/ui";
import { ChevronLeft, ChevronRight, Copy, Eraser, MoreHorizontal, Plus, Save, SearchX, Send, Trash2, Users } from "@/ui/icons";

const WD = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
let seq = 0;
const newId = () => `new-${Date.now()}-${++seq}`;

export default function PlanEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new id is a new screen: the unsaved grid and the open week start over.
  return <PlanEditor key={id} id={String(id ?? "")} />;
}

function PlanEditor({ id }: { id: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const { club } = useClub();
  const q = usePlan(club?.id, id);
  const saveItems = useSavePlanItems(club?.id ?? "", id);
  const update = useUpdatePlan(club?.id ?? "", id);
  const unassign = useUnassignPlan(club?.id ?? "", id);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [week, setWeek] = useState(1);
  const [cell, setCell] = useState<{ weekday: number; item?: PlanItem } | null>(null);
  const [apply, setApply] = useState(false);
  const [shrink, setShrink] = useState<number | null>(null);
  const [off, setOff] = useState<PlanAssignment | null>(null);
  const [busyWeeks, setBusyWeeks] = useState(false);
  const loaded = !!q.data && !q.isPlaceholderData;
  useEffect(() => { if (loaded && !dirty) { setItems(q.data!.items); setName(q.data!.name); } }, [loaded, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = q.data?.weeks ?? 0;
  const weekly = useMemo(() => Array.from({ length: weeks }, (_, w) => items.filter((i) => i.week === w + 1).reduce((s, i) => s + (i.est_duration_s ?? 0), 0)), [items, weeks]);
  if (!club) return null;

  if (!q.data) {
    return (
      <View style={[styles.fill, { padding: theme.space[4], gap: theme.space[4], backgroundColor: c.canvas }]}>
        {q.isPending ? (
          <>
            <Skeleton style={{ height: theme.space[12] }} />
            <Skeleton style={{ height: theme.space[16] }} />
            <Skeleton style={{ height: theme.space[20] * 3 }} />
          </>
        ) : (
          <Card><EmptyState icon={SearchX} title={q.error instanceof ApiError ? q.error.title : t("Planilha não encontrada.")}
            action={<Button variant="secondary" onPress={() => router.navigate("/plans")}>{t("Voltar para as planilhas")}</Button>}>
            {q.error instanceof ApiError ? q.error.detail : null}
          </EmptyState></Card>
        )}
      </View>
    );
  }
  const plan = q.data;
  const shown = Math.min(week, Math.max(1, weeks));
  const change = (next: PlanItem[]) => { setItems(next); setDirty(true); };
  const save = () => saveItems.mutate(items, {
    onSuccess: (r) => { setItems(r.items); setDirty(false); toast.success(t("Planilha salva")); },
    onError: toast.error,
  });
  const rename = () => {
    const v = name.trim();
    if (!v) { setName(plan.name); return; }
    if (v !== plan.name) update.mutate({ name: v }, { onError: (e) => { setName(plan.name); toast.error(e); } });
  };
  /** Fewer weeks drop the workouts after the new last week (asked first); unsaved changes are saved along. */
  const setWeeks = async (w: number, confirmed = false) => {
    if (w === weeks || w < 1 || w > 52) return;
    if (!confirmed && items.some((i) => i.week > w)) { setShrink(w); return; }
    setBusyWeeks(true);
    try {
      if (dirty) await saveItems.mutateAsync(items.filter((i) => i.week <= w));
      await update.mutateAsync({ weeks: w });
      const r = await q.refetch();
      if (r.data) setItems(r.data.items);
      setDirty(false);
      if (shown > w) setWeek(w);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyWeeks(false);
      setShrink(null);
    }
  };
  const copyToNext = () => {
    if (shown >= weeks) { toast.info(t("Esta é a última semana"), t("Aumente a duração para copiar.")); return; }
    change([...items.filter((i) => i.week !== shown + 1), ...items.filter((i) => i.week === shown).map((i) => ({ ...i, id: newId(), week: shown + 1 }))]);
    setWeek(shown + 1);
    toast.success(t("Semana {n} copiada para a {m}", { n: shown, m: shown + 1 }), t("Salve para guardar."));
  };
  const day = (weekday: number) => items.filter((i) => i.week === shown && i.weekday === weekday);
  const total = weekly[shown - 1] ?? 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.fill, { backgroundColor: c.canvas }]}>
      <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.space[4], paddingTop: theme.space[5], paddingBottom: theme.space[8], gap: theme.space[5], maxWidth: theme.size.readingMax }]}>
        <View style={{ gap: theme.space[3] }}>
          <Field label={t("Nome da planilha")}>
            {(a) => <Input {...a} value={name} onChangeText={setName} onBlur={rename} onSubmitEditing={rename} returnKeyType="done" maxLength={120} style={styles.title} />}
          </Field>
          <View style={[styles.row, styles.wrap, { gap: theme.space[3] }]}>
            <Stepper label={t("Número de semanas")} value={weeks} onChange={(v) => void setWeeks(v ?? 1)} min={1} max={52} format={(v) => tn(v, "{n} semana", "{n} semanas")} />
            <Text variant="bodySm" tone="muted" style={styles.flex}>{busyWeeks ? t("Atualizando…") : tn(items.length, "{n} treino", "{n} treinos")}</Text>
          </View>
        </View>

        <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <IconButton icon={ChevronLeft} variant="secondary" label={t("Semana anterior")} disabled={shown <= 1} onPress={() => setWeek(shown - 1)} />
            <View style={[styles.flex, styles.center]}>
              <Text variant="titleMd" accessibilityRole="header" accessibilityLiveRegion="polite">{t("Semana {n} de {total}", { n: shown, total: weeks })}</Text>
              <Text variant="caption" tone="muted">{total ? t("{d} planejados", { d: duration(total) }) : t("Sem treinos")}</Text>
            </View>
            <IconButton icon={ChevronRight} variant="secondary" label={t("Próxima semana")} disabled={shown >= weeks} onPress={() => setWeek(shown + 1)} />
            <Menu title={t("Semana {n}", { n: shown })} trigger={(o) => <IconButton icon={MoreHorizontal} label={t("Ações da semana {n}", { n: shown })} onPress={o} />} items={[
              { label: t("Copiar para a semana seguinte"), icon: Copy, onSelect: copyToNext, disabled: shown >= weeks },
              { label: t("Limpar semana"), icon: Eraser, danger: true, onSelect: () => change(items.filter((i) => i.week !== shown)), disabled: !items.some((i) => i.week === shown) },
            ]} />
          </View>
          {weeks > 1 && <VolumeBars weekly={weekly} height={theme.space[12]} selected={shown} onSelect={setWeek} />}
        </Card>

        <View accessibilityRole="list" style={{ gap: theme.space[2] }}>
          {WD.map((label, i) => {
            const weekday = i + 1;
            const list = day(weekday);
            return (
              <View key={label} style={[styles.row, styles.top, { gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }]}>
                <Text variant="overline" tone="muted" style={{ width: theme.space[10], paddingTop: theme.space[3] }}>{t(label).slice(0, 3)}</Text>
                <View style={[styles.flex, { gap: theme.space["1.5"] }]}>
                  {list.map((it) => {
                    const est = estimateText(it);
                    return (
                      <Pressable key={it.id} accessibilityRole="button" accessibilityLabel={t("{title}, {day}. Editar", { title: it.title, day: t(label) })} onPress={() => setCell({ weekday, item: it })}
                        style={({ pressed }) => [styles.row, { gap: theme.space[2], minHeight: theme.size.touchMin, paddingVertical: theme.space["1.5"], paddingRight: theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : c.sunken, overflow: "hidden" }]}>
                        <SportBar sport={it.sport} />
                        <View style={styles.flex}>
                          <Text variant="labelMd" numberOfLines={2}>{it.title}</Text>
                          {est ? <Text variant="caption" tone="muted">{est}</Text> : null}
                        </View>
                        <ChevronRight size={theme.size.iconSm} color={c.fgSubtle} aria-hidden />
                      </Pressable>
                    );
                  })}
                  <Button variant="ghost" size="sm" icon={Plus} style={styles.start} accessibilityLabel={t("Adicionar treino na semana {w}, {d}", { w: shown, d: t(label) })}
                    onPress={() => setCell({ weekday })}>{list.length ? t("Mais um") : t("Adicionar")}</Button>
                </View>
              </View>
            );
          })}
        </View>

        <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Users size={theme.size.iconMd} color={c.fg} aria-hidden />
            <Text variant="titleSm" accessibilityRole="header">{t("Quem está usando")}</Text>
          </View>
          {plan.assignments.length === 0 ? <Text tone="muted">{t("Ninguém ainda. Use “Aplicar a alunos”.")}</Text> : plan.assignments.map((a, i) => (
            <View key={a.id} style={[styles.row, { gap: theme.space[3], paddingTop: i ? theme.space[3] : 0, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
              <Avatar name={a.athlete.user.name} src={a.athlete.user.avatar_url} size={theme.space[8]} />
              <View style={[styles.flex, { gap: theme.space[1] }]}>
                <Text variant="labelMd" numberOfLines={1}>{a.athlete.user.name}</Text>
                <Text variant="caption" tone="muted">{t("De {from} a {to}", { from: dayMonth(a.start_date), to: dayMonth(addDays(a.start_date, weeks * 7 - 1)) })} · {t("{done}/{n} feitos", { done: a.done, n: a.workouts })}</Text>
                <ProgressBar value={a.done} max={Math.max(1, a.workouts)} label={t("Treinos feitos por {name}", { name: a.athlete.user.name })} />
              </View>
              <IconButton icon={Trash2} label={t("Remover {name} da planilha", { name: a.athlete.user.name })} onPress={() => setOff(a)} />
            </View>
          ))}
        </Card>
      </ScrollView>

      <View style={[styles.bar, { gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopColor: c.line, backgroundColor: c.surface }]}>
        <Button variant="secondary" icon={Save} disabled={!dirty} loading={saveItems.isPending} onPress={save}
          accessibilityLabel={dirty ? t("Salvar alterações") : t("Tudo salvo")}>{dirty ? t("Salvar") : t("Salvo")}</Button>
        <Button icon={Send} disabled={dirty || !items.length} onPress={() => setApply(true)} style={styles.flex}>{t("Aplicar a alunos")}</Button>
      </View>

      <CellSheet key={cell ? `${shown}-${cell.weekday}-${cell.item?.id ?? "new"}` : "closed"} club={club} week={shown} cell={cell} onClose={() => setCell(null)}
        onSave={(next) => { change(cell?.item ? items.map((i) => (i.id === cell.item!.id ? next : i)) : [...items, next]); setCell(null); }}
        onRemove={() => { if (cell?.item) change(items.filter((i) => i.id !== cell.item!.id)); setCell(null); }} />
      <ApplySheet clubId={club.id} planId={id} weeks={weeks} open={apply} onOpenChange={setApply} />
      <ConfirmDialog open={shrink !== null} onOpenChange={(v) => !v && setShrink(null)} loading={busyWeeks}
        title={t("Reduzir para {n} semanas?", { n: shrink ?? 0 })}
        description={t("Os treinos depois da semana {n} saem da planilha. Quem já usa continua com os treinos na agenda.", { n: shrink ?? 0 })}
        confirmLabel={t("Reduzir")} onConfirm={() => shrink !== null && void setWeeks(shrink, true)} />
      <ConfirmDialog open={!!off} onOpenChange={(v) => !v && setOff(null)} loading={unassign.isPending}
        title={t("Tirar {name} da planilha?", { name: off?.athlete.user.name ?? "" })}
        description={t("Os treinos futuros que ainda não foram feitos saem da agenda. O que já foi feito fica.")}
        confirmLabel={t("Remover")}
        onConfirm={() => off && unassign.mutate(off.id, {
          onSuccess: (r) => { setOff(null); toast.success(t("Aplicação removida"), tn(r?.removed_workouts ?? 0, "{n} treino futuro saiu da agenda.", "{n} treinos futuros saíram da agenda.")); },
          onError: (e) => { setOff(null); toast.error(e); },
        })} />
    </KeyboardAvoidingView>
  );
}

/** A day's workout: from the library or built here, plus a note; "Remover" for an existing one. */
function CellSheet({ club, week, cell, onClose, onSave, onRemove }: {
  club: { id: string; modalities: import("@/api/types").Sport[] }; week: number; cell: { weekday: number; item?: PlanItem } | null;
  onClose: () => void; onSave: (i: PlanItem) => void; onRemove: () => void;
}) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [notes, setNotes] = useState(cell?.item?.notes ?? "");
  const item = cell?.item;
  const commit = () => {
    if (!cell || !draft) return;
    onSave({ id: item?.id ?? newId(), week, weekday: cell.weekday, template_id: draft.template_id, sport: draft.sport, title: draft.title, structure: draft.structure,
      est_duration_s: draft.est_duration_s, est_distance_m: draft.est_distance_m, notes: notes.trim() || null });
  };
  return (
    <Dialog open={!!cell} onOpenChange={(v) => !v && onClose()} title={cell ? t("Semana {w} · {d}", { w: week, d: t(WD[cell.weekday - 1]!) }) : ""}
      description={item ? item.title : t("Escolha um treino da biblioteca ou monte um.")}
      footer={<>
        {item && <IconButton icon={Trash2} variant="ghost" label={t("Remover este treino")} onPress={onRemove} />}
        <Button variant="secondary" onPress={onClose}>{t("Cancelar")}</Button>
        <Button disabled={!draft} onPress={commit} style={styles.flex}>{item ? t("Atualizar") : t("Adicionar")}</Button>
      </>}>
      {cell && (
        <View style={{ gap: theme.space[4] }}>
          <WorkoutPicker club={club} initial={item ? { ...item } : null} onChange={setDraft} />
          <Field label={t("Recado")} optional>
            {(a) => <Textarea {...a} value={notes} onChangeText={setNotes} placeholder={t("Ex.: foco em manter o ritmo")} maxLength={1000} />}
          </Field>
        </View>
      )}
    </Dialog>
  );
}

/** Apply from a Monday to chosen students (groups add their members); week 1 starts on that date. */
function ApplySheet({ clubId, planId, weeks, open, onOpenChange }: { clubId: string; planId: string; weeks: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const assign = useAssignPlan(clubId, planId);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const nextMonday = addDays(mondayOf(todayFn()), 7);
  const [start, setStart] = useState(nextMonday);
  const thisMonday = mondayOf(todayFn());
  const err = assign.error instanceof ApiError ? assign.error : null;
  const close = () => { onOpenChange(false); assign.reset(); };
  const submit = () => assign.mutate({ athlete_ids: [...sel], start_date: start }, {
    onSuccess: (r) => {
      toast.success(tn(r.workouts, "{n} treino criado", "{n} treinos criados"), tn(r.assignments, "Para {n} aluno.", "Para {n} alunos."));
      setSel(new Set()); close();
    },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()} title={t("Aplicar planilha")} description={t("Os treinos entram na agenda dos alunos a partir da data escolhida.")}
      footer={
        <View style={[styles.full, { gap: theme.space[2] }]}>
          <Text variant="bodySm" tone="muted" accessibilityLiveRegion="polite">
            {sel.size ? `${tn(sel.size, "{n} aluno", "{n} alunos")} · ${t("até {d}", { d: dayMonth(addDays(start, weeks * 7 - 1)) })}` : t("Escolha os alunos")}
          </Text>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Button variant="secondary" onPress={close}>{t("Cancelar")}</Button>
            <Button disabled={!sel.size} loading={assign.isPending} onPress={submit} style={styles.flex}>{t("Aplicar")}</Button>
          </View>
        </View>
      }>
      <View style={{ gap: theme.space[5] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm" accessibilityRole="header">{t("Começa na segunda-feira")}</Text>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <IconButton icon={ChevronLeft} variant="secondary" label={t("Semana anterior")} disabled={start <= thisMonday} onPress={() => setStart(addDays(start, -7))} />
            <Text variant="titleSm" accessibilityLiveRegion="polite" style={[styles.flex, styles.centerText]}>{shortDate(start)}</Text>
            <IconButton icon={ChevronRight} variant="secondary" label={t("Próxima semana")} onPress={() => setStart(addDays(start, 7))} />
          </View>
          <Text variant="caption" tone={err?.fieldError("start_date") ? "danger" : "muted"}>{err?.fieldError("start_date") ?? t("A semana 1 começa nesta data.")}</Text>
        </View>
        <AthletePicker clubId={clubId} enabled={open} value={sel} onChange={setSel} error={err?.fieldError("athlete_ids")} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: "100%", alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  top: { alignItems: "flex-start" },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  flex: { flex: 1, minWidth: 0 },
  full: { flexBasis: "100%" },
  start: { alignSelf: "flex-start" },
  title: { fontWeight: weight("bold") },
  bar: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth },
});

/**
 * W4 · "Atribuir treino" on the phone (the web's planning AssignDialog as a two-step bottom sheet): first a workout
 * from the library (search by name or #tag), then who (groups as shortcuts, a searchable student list) and which days
 * (a week strip with arrows; days in other weeks stay listed), plus a note. One workout per student × day; drafts
 * (D-031) wait for the week's release. "Montar agora" builds a one-off workout right here (quick text or steps, X12),
 * like the web's "build now".
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAssign, type AssignInput } from "@/api/staff";
import type { Club, Sport, WorkoutTemplate } from "@/api/types";
import { SportPicker } from "@/components/builder/parts";
import { WorkoutBuilder } from "@/components/builder/WorkoutBuilder";
import { emptyStructure } from "@/domain/builder";
import { AthletePicker, TemplateList } from "./pickers";
import { estimate, type Structure } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { addDays, dayMonth, shortDate, weekdayShort } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Field, IconButton, Input, Segmented, Text, Textarea, Dialog, toast } from "@/ui";
import { ChevronLeft, ChevronRight, Library, Wand2, X } from "@/ui/icons";

export interface AssignPrefill { athleteIds?: string[]; dates?: string[] }

const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

export function AssignSheet({ club, monday, open, onOpenChange, prefill }: { club: Club; monday: string; open: boolean; onOpenChange: (v: boolean) => void; prefill?: AssignPrefill }) {
  // A fresh form each time it opens (the prefill changes with the day or student it came from).
  const [n, setN] = useState(0);
  const [was, setWas] = useState(open);
  if (open !== was) { setWas(open); if (open) setN(n + 1); }
  return <AssignBody key={n} club={club} monday={monday} open={open} onClose={() => onOpenChange(false)} prefill={prefill} />;
}

function AssignBody({ club, monday, open, onClose, prefill }: { club: Club; monday: string; open: boolean; onClose: () => void; prefill?: AssignPrefill }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [step, setStep] = useState<"workout" | "who">("workout");
  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [source, setSource] = useState<"library" | "build">("library");
  const [sport, setSport] = useState<Sport>(club.modalities[0] ?? "run");
  const [title, setTitle] = useState("");
  const [structure, setStructure] = useState<Structure>(emptyStructure);
  const [athletes, setAthletes] = useState<Set<string>>(new Set(prefill?.athleteIds ?? []));
  const [dates, setDates] = useState<Set<string>>(new Set(prefill?.dates ?? []));
  const [shown, setShown] = useState(monday);
  const [notes, setNotes] = useState("");
  const assign = useAssign(club.id);
  const err = assign.error instanceof ApiError ? assign.error : null;

  const week = Array.from({ length: 7 }, (_, i) => addDays(shown, i));
  const elsewhere = [...dates].filter((d) => !week.includes(d)).sort();
  const count = athletes.size * dates.size;

  const built = !!title.trim() && structure.blocks.length > 0;
  const ready = source === "library" ? !!template : built;
  const submit = () => {
    const base = { athlete_ids: [...athletes], dates: [...dates].sort(), notes: notes.trim() || null };
    let v: AssignInput;
    if (source === "library") { if (!template) return; v = { ...base, template_id: template.id }; }
    else { const est = estimate(structure, sport); v = { ...base, sport, title: title.trim(), structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m }; }
    assign.mutate(v, {
      onSuccess: (r) => {
        const seen = r.items.filter((w) => w.visible).length;
        const detail = seen === r.items.length ? t("Os alunos já veem na agenda.") : seen === 0 ? t("Ficam em rascunho até a semana ser liberada.") : t("Os da semana em andamento já aparecem; os outros ficam em rascunho até a liberação.");
        toast.success(tn(r.items.length, "{n} treino atribuído", "{n} treinos atribuídos"), detail);
        onClose();
      },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  const sourcePicker = (
    <Segmented<"library" | "build"> label={t("Origem do treino")} value={source} onChange={setSource} style={styles.stretch}
      options={[{ value: "library", label: t("Da biblioteca"), icon: Library }, { value: "build", label: t("Montar agora"), icon: Wand2 }]} />
  );
  const footer = step === "workout" ? (
    <>
      <Button variant="secondary" onPress={onClose}>{t("Cancelar")}</Button>
      <Button iconRight={ChevronRight} disabled={!ready} onPress={() => setStep("who")}>{t("Continuar")}</Button>
    </>
  ) : (
    <View style={[styles.full, { gap: theme.space[2] }]}>
      <Text variant="bodySm" tone="muted" accessibilityLiveRegion="polite">{count ? tn(count, "{n} treino será criado", "{n} treinos serão criados") : t("Escolha alunos e dias")}</Text>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Button variant="secondary" icon={ChevronLeft} onPress={() => setStep("workout")}>{t("Voltar")}</Button>
        <Button loading={assign.isPending} disabled={!count} onPress={submit} style={styles.flex}>{t("Atribuir")}</Button>
      </View>
    </View>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} footer={footer}
      title={t("Atribuir treino")} description={step === "workout" ? (source === "library" ? t("Escolha um treino da biblioteca.") : t("Monte um treino só para estes alunos.")) : (source === "library" ? template?.name : title.trim()) ?? null}>
      {step === "workout" && source === "build" ? (
        <View style={{ gap: theme.space[4] }}>
          {sourcePicker}
          <Field label={t("Nome do treino")}>
            {(f) => <Input {...f} value={title} onChangeText={setTitle} placeholder={t("Ex.: Intervalado 6×1 km")} maxLength={120} />}
          </Field>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="labelSm">{t("Modalidade")}</Text>
            <SportPicker value={sport} allowed={club.modalities} onChange={(x) => { setSport(x); if (x === "strength" || sport === "strength") setStructure(emptyStructure()); }} />
          </View>
          <WorkoutBuilder compact sport={sport} structure={structure} onChange={setStructure} />
          {!built && <Text variant="caption" tone="muted">{t("Dê um nome e pelo menos uma etapa para continuar.")}</Text>}
        </View>
      ) : step === "workout" ? (
        <View style={{ gap: theme.space[3] }}>
          {sourcePicker}
          <TemplateList clubId={club.id} enabled={open} selectedId={template?.id ?? null} onPick={setTemplate} />
        </View>
      ) : (
        <View style={{ gap: theme.space[5] }}>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="labelSm" accessibilityRole="header">{t("Quando")}{dates.size ? ` · ${dates.size}` : ""}</Text>
            {err?.fieldError("dates") ? <Text variant="caption" tone="danger">{err.fieldError("dates")}</Text> : null}
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <IconButton icon={ChevronLeft} variant="ghost" label={t("Semana anterior")} onPress={() => setShown(addDays(shown, -7))} />
              <Text variant="labelMd" style={[styles.flex, styles.centerText, styles.tabular]}>{`${dayMonth(shown)} – ${dayMonth(addDays(shown, 6))}`}</Text>
              <IconButton icon={ChevronRight} variant="ghost" label={t("Próxima semana")} onPress={() => setShown(addDays(shown, 7))} />
            </View>
            <View style={[styles.row, { gap: theme.space[1] }]}>
              {week.map((d) => {
                const on = dates.has(d);
                return (
                  <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={shortDate(d)} onPress={() => setDates(toggle(dates, d))}
                    style={({ pressed }) => [styles.day, { minHeight: theme.size.touchMin + theme.space[4], borderRadius: theme.radius.md, borderWidth: 1, borderColor: on ? c.brand.solid : c.line, backgroundColor: on ? c.brand.solid : pressed ? c.soft : c.surface }]}>
                    <Text variant="overline" color={on ? c.brand.onSolid : c.fgMuted}>{weekdayShort(d)}</Text>
                    <Text variant="titleMd" color={on ? c.brand.onSolid : c.fg} style={styles.tabular}>{String(Number(d.slice(8)))}</Text>
                  </Pressable>
                );
              })}
            </View>
            {elsewhere.length > 0 && (
              <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"] }]}>
                <Text variant="caption" tone="muted">{t("Também em:")}</Text>
                {elsewhere.map((d) => (
                  <Pressable key={d} accessibilityRole="button" accessibilityLabel={t("Remover {d}", { d: shortDate(d) })} onPress={() => setDates(toggle(dates, d))}
                    hitSlop={theme.space[2]} style={[styles.row, styles.chip, { gap: theme.space[1], height: theme.size.controlSm, paddingHorizontal: theme.space[2] + theme.space["0.5"], borderRadius: theme.radius.full, borderColor: c.brand.ring, backgroundColor: c.brand.subtle }]}>
                    <Text variant="labelSm" color={c.brand.subtleFg}>{`${weekdayShort(d)}, ${dayMonth(d)}`}</Text>
                    <X size={theme.size.iconSm - 4} color={c.brand.subtleFg} aria-hidden />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <AthletePicker clubId={club.id} enabled={open} value={athletes} onChange={setAthletes} error={err?.fieldError("athlete_ids")} />

          <Field label={t("Recado para os alunos")} optional>
            {(f) => <Textarea {...f} value={notes} onChangeText={setNotes} placeholder={t("Ex.: foco nos últimos tiros")} maxLength={1000} />}
          </Field>
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  full: { flexBasis: "100%" },
  stretch: { alignSelf: "stretch" },
  day: { flex: 1, alignItems: "center", justifyContent: "center" },
  chip: { borderWidth: 1 },
  centerText: { textAlign: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
});

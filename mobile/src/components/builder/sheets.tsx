/**
 * Editing one block in a bottom sheet (phone-first W5; the web edits rows in place, BlockEditor.tsx): a step (kind,
 * duration with an optional range, target, swim extras, note), a series (count or a "15–20×" range, its name) or a
 * strength exercise (name with library suggestions, sets × reps, load, rest). Each sheet edits a draft; "Aplicar"
 * hands it back, closing discards it.
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useExercises } from "@/api/library";
import type { Sport } from "@/api/types";
import { clockIn, distanceWithMax, parseClock, parsePace, paceIn, timeWithMax, withCount } from "@/domain/builder";
import { EQUIPMENT_LABEL, INTENT_LABEL, STROKE_LABEL, type Duration, type Equipment, type Exercise, type Intent, type Load, type Repeat, type Step, type Stroke, type Target, type ZoneN } from "@/domain/workout";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Dialog, Field, Input, Segmented, Select, Text } from "@/ui";
import { Chip, ValueInput } from "./parts";

const INTENTS = Object.keys(INTENT_LABEL) as Intent[];
const RPE_WORDS = ["", "Muito leve", "Muito leve", "Leve", "Leve", "Moderado", "Moderado", "Difícil", "Muito difícil", "Quase máximo", "Máximo"];
const num = (s: string) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const int = (s: string) => { const n = Number(s); return Number.isInteger(n) && n > 0 ? n : null; };

function SheetFooter({ onCancel, onApply, onRemove }: { onCancel: () => void; onApply: () => void; onRemove?: () => void }) {
  return (
    <>
      {onRemove && <Button variant="ghost" onPress={onRemove}>{t("Remover")}</Button>}
      <View style={styles.flex} />
      <Button variant="secondary" onPress={onCancel}>{t("Cancelar")}</Button>
      <Button onPress={onApply}>{t("Aplicar")}</Button>
    </>
  );
}

function Row({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return <View style={[styles.row, { gap: theme.space[2] }]}>{children}</View>;
}

// ---------------------------------------------------------------- duration
function DurationFields({ d, sport, onChange }: { d: Duration; sport: Sport; onChange: (d: Duration) => void }) {
  const { theme } = useTheme();
  const km = sport !== "swim";
  const kmIn = (m: number) => (km ? String(m / 1000).replace(".", ",") : String(m));
  const kmOut = (v: string) => { const x = num(v); return x ? Math.round(km ? x * 1000 : x) : null; };
  return (
    <View style={{ gap: theme.space[2] }}>
      <Segmented<Duration["type"]> label={t("Tipo de duração")} size="sm" value={d.type} style={styles.stretch}
        onChange={(v) => onChange(v === "time" ? { type: "time", s: 600 } : v === "distance" ? { type: "distance", m: km ? 1000 : 100 } : { type: "open" })}
        options={[{ value: "time", label: t("Tempo") }, { value: "distance", label: t("Distância") }, { value: "open", label: t("Até a volta") }]} />
      {d.type === "time" && (
        <Row>
          <ValueInput label={t("Tempo (min ou mm:ss)")} value={d.s} format={clockIn} parse={(s) => { const v = parseClock(s); return v && v > 0 ? v : null; }}
            onChange={(s) => s && onChange(timeWithMax(s, d.max_s))} style={styles.flex} />
          <Text tone="muted">{t("até")}</Text>
          <ValueInput label={t("Tempo máximo (opcional)")} value={d.max_s} format={clockIn} parse={(s) => { const v = parseClock(s); return v && v > 0 ? v : null; }}
            optional placeholder={t("opcional")} onChange={(m) => onChange(timeWithMax(d.s, m))} style={styles.flex} />
        </Row>
      )}
      {d.type === "distance" && (
        <Row>
          <ValueInput label={km ? t("Distância em km") : t("Distância em metros")} value={d.m} format={kmIn} parse={kmOut} keyboardType="decimal-pad"
            onChange={(m) => m && onChange(distanceWithMax(m, d.max_m))} style={styles.flex} />
          <Text tone="muted">{t("até")}</Text>
          <ValueInput label={km ? t("Distância máxima em km (opcional)") : t("Distância máxima em metros (opcional)")} value={d.max_m} format={kmIn} parse={kmOut}
            keyboardType="decimal-pad" optional placeholder={t("opcional")} onChange={(m) => onChange(distanceWithMax(d.m, m))} style={styles.flex} />
          <Text tone="muted">{km ? "km" : "m"}</Text>
        </Row>
      )}
      {d.type !== "open" && <Text variant="caption" tone="muted">{t("Preencha o segundo campo para uma faixa: o aluno escolhe dentro dela.")}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------- target
type TargetKind = Target["type"];
function TargetFields({ tg, sport, onChange }: { tg: Target; sport: Sport; onChange: (t: Target) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const unit = sport === "swim" ? "/100 m" : "/km";
  const kinds: { value: TargetKind; label: string }[] = [
    { value: "open", label: t("Livre") }, { value: "zone", label: t("Zona") }, { value: "pace", label: t("Pace") },
    { value: "hr", label: t("Frequência cardíaca") }, { value: "power", label: t("Potência") }, { value: "rpe", label: t("PSE (esforço)") },
  ];
  const pick = (v: TargetKind) => onChange(
    v === "zone" ? { type: "zone", metric: "pace", zone: 2 }
      : v === "pace" ? (sport === "swim" ? { type: "pace", min_s: 100, max_s: 110 } : { type: "pace", min_s: 300, max_s: 310 })
      : v === "hr" ? { type: "hr", min: 140, max: 155 } : v === "power" ? { type: "power", min: 200, max: 230 } : v === "rpe" ? { type: "rpe", value: 6 } : { type: "open" },
  );
  const side = theme.size.touchMin;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Select<TargetKind> value={tg.type} onChange={pick} options={kinds} title={t("Alvo")} accessibilityLabel={t("Alvo")} />
      {tg.type === "zone" && (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("Zona")} style={[styles.row, { gap: theme.space["1.5"] }]}>
            {([1, 2, 3, 4, 5] as ZoneN[]).map((z) => {
              const on = tg.zone === z;
              return (
                <Pressable key={z} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t("Zona {z}", { z })} onPress={() => onChange({ ...tg, zone: z })}
                  style={[styles.center, styles.flex, { height: side, borderRadius: theme.radius.md, backgroundColor: on ? c.zone[z].solid : c.soft, borderWidth: on ? 2 : 0, borderColor: c.fg }]}>
                  <Text variant="labelMd" color={on ? c.zone[z].onSolid : c.fgMuted} style={styles.bold}>Z{z}</Text>
                </Pressable>
              );
            })}
          </View>
          <Segmented<"pace" | "hr" | "power"> label={t("Zona de")} size="sm" value={tg.metric} onChange={(metric) => onChange({ ...tg, metric })} style={styles.stretch}
            options={[{ value: "pace", label: t("Pace") }, { value: "hr", label: t("FC") }, { value: "power", label: t("Potência") }]} />
        </>
      )}
      {tg.type === "pace" && (
        <Row>
          <ValueInput label={t("Pace mais rápido")} value={tg.min_s} format={paceIn} parse={parsePace} onChange={(v) => v && onChange({ ...tg, min_s: Math.min(v, tg.max_s) })} style={styles.flex} />
          <Text tone="muted">–</Text>
          <ValueInput label={t("Pace mais lento")} value={tg.max_s} format={paceIn} parse={parsePace} onChange={(v) => v && onChange({ ...tg, max_s: Math.max(v, tg.min_s) })} style={styles.flex} />
          <Text tone="muted">{unit}</Text>
        </Row>
      )}
      {(tg.type === "hr" || tg.type === "power") && (
        <Row>
          <ValueInput label={tg.type === "hr" ? t("FC mínima") : t("Potência mínima")} value={tg.min} format={String} parse={int} keyboardType="number-pad" onChange={(v) => v && onChange({ ...tg, min: v })} style={styles.flex} />
          <Text tone="muted">–</Text>
          <ValueInput label={tg.type === "hr" ? t("FC máxima") : t("Potência máxima")} value={tg.max} format={String} parse={int} keyboardType="number-pad" onChange={(v) => v && onChange({ ...tg, max: v })} style={styles.flex} />
          <Text tone="muted">{tg.type === "hr" ? "bpm" : "W"}</Text>
        </Row>
      )}
      {tg.type === "rpe" && (
        <View style={{ gap: theme.space[1] }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("PSE")} style={[styles.row, { gap: theme.space[1] }]}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const on = tg.value === n;
              return (
                // A new number drops the coach's word ("forte" is PSE 8 only).
                <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${n}, ${t(RPE_WORDS[n]!)}`} onPress={() => onChange({ type: "rpe", value: n })}
                  style={[styles.center, styles.flex, { height: side, borderRadius: theme.radius.sm, backgroundColor: on ? c.brand.solid : c.soft }]}>
                  <Text variant="labelSm" color={on ? c.brand.onSolid : c.fgMuted} style={styles.bold}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="caption" tone="muted">{tg.label ? t("“{label}” = PSE {n}", { label: tg.label, n: tg.value }) : t(RPE_WORDS[tg.value] ?? "")}</Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- step
export function StepSheet({ step, sport, open, onClose, onApply, onRemove }: { step: Step | null; sport: Sport; open: boolean; onClose: () => void; onApply: (s: Step) => void; onRemove?: () => void }) {
  // A fresh draft for each opening.
  return open && step ? <StepDraft key={JSON.stringify(step)} step={step} sport={sport} onClose={onClose} onApply={onApply} onRemove={onRemove} /> : <Dialog open={false} onOpenChange={onClose} title="" />;
}
function StepDraft({ step, sport, onClose, onApply, onRemove }: { step: Step; sport: Sport; onClose: () => void; onApply: (s: Step) => void; onRemove?: () => void }) {
  const { theme } = useTheme();
  const [d, setD] = useState<Step>(step);
  const swim = sport === "swim";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t("Etapa")} footer={<SheetFooter onCancel={onClose} onApply={() => onApply(d)} onRemove={onRemove} />}>
      <View style={{ gap: theme.space[4] }}>
        <Field label={t("Tipo de etapa")}>
          {(a) => <Select<Intent> {...a} title={t("Tipo de etapa")} value={d.intent} onChange={(intent) => setD({ ...d, intent })} options={INTENTS.map((i) => ({ value: i, label: t(INTENT_LABEL[i]) }))} />}
        </Field>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Duração")}</Text>
          <DurationFields d={d.duration} sport={sport} onChange={(duration) => setD({ ...d, duration })} />
        </View>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Alvo")}</Text>
          <TargetFields tg={d.target} sport={sport} onChange={(target) => setD({ ...d, target })} />
        </View>
        {swim && (
          <>
            <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
              <Field label={t("Estilo")} style={styles.flex}>
                {(a) => <Select<Stroke | ""> {...a} title={t("Estilo")} value={d.stroke ?? ""} onChange={(v) => setD({ ...d, stroke: v || undefined })}
                  options={[{ value: "", label: t("Qualquer") }, ...(Object.keys(STROKE_LABEL) as Stroke[]).map((s) => ({ value: s, label: t(STROKE_LABEL[s]) }))]} />}
              </Field>
              <Field label={t("Saída")} optional style={styles.flex}>
                {(a) => <ValueInput label={a.accessibilityLabel} value={d.send_off_s} format={clockIn} parse={(s) => { const v = parseClock(s); return v && v > 0 ? v : null; }} optional placeholder="1:45"
                  onChange={(send_off_s) => setD({ ...d, send_off_s })} />}
              </Field>
            </View>
            <View style={{ gap: theme.space[2] }}>
              <Text variant="labelSm">{t("Equipamento")}</Text>
              <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"] }]}>
                {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((eq) => {
                  const on = !!d.equipment?.includes(eq);
                  return <Chip key={eq} label={t(EQUIPMENT_LABEL[eq])} on={on} onPress={() => {
                    const next = on ? d.equipment!.filter((x) => x !== eq) : [...(d.equipment ?? []), eq];
                    setD({ ...d, equipment: next.length ? next : undefined });
                  }} />;
                })}
              </View>
            </View>
          </>
        )}
        <Field label={t("Observação")} optional>
          {(a) => <Input {...a} value={d.note ?? ""} onChangeText={(v) => setD({ ...d, note: v || undefined })} placeholder={t("Ex.: trote leve")} maxLength={200} />}
        </Field>
      </View>
    </Dialog>
  );
}

// ---------------------------------------------------------------- series
export function RepeatSheet({ repeat, open, onClose, onApply, onRemove }: { repeat: Repeat | null; open: boolean; onClose: () => void; onApply: (r: Repeat) => void; onRemove?: () => void }) {
  return open && repeat ? <RepeatDraft key={JSON.stringify(repeat)} repeat={repeat} onClose={onClose} onApply={onApply} onRemove={onRemove} /> : <Dialog open={false} onOpenChange={onClose} title="" />;
}
function RepeatDraft({ repeat, onClose, onApply, onRemove }: { repeat: Repeat; onClose: () => void; onApply: (r: Repeat) => void; onRemove?: () => void }) {
  const { theme } = useTheme();
  const [r, setR] = useState<Repeat>(repeat);
  const intIn = (lo: number, hi: number) => (s: string) => { const n = int(s); return n !== null && n >= lo && n <= hi ? n : null; };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t("Série")} description={t("As etapas dentro dela se repetem.")} footer={<SheetFooter onCancel={onClose} onApply={() => onApply(r)} onRemove={onRemove} />}>
      <View style={{ gap: theme.space[4] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Repetir")}</Text>
          <Row>
            <ValueInput label={t("Repetições da série")} value={r.count} format={String} parse={intIn(1, 200)} keyboardType="number-pad" onChange={(n) => n && setR(withCount(r, n, r.max_count))} style={styles.flex} />
            <Text tone="muted">{t("até")}</Text>
            <ValueInput label={t("Máximo de repetições (opcional)")} value={r.max_count} format={String} parse={intIn(1, 200)} keyboardType="number-pad" optional placeholder={t("opcional")}
              onChange={(n) => setR(withCount(r, r.count, n))} style={styles.flex} />
            <Text tone="muted">{t("vezes")}</Text>
          </Row>
          <Text variant="caption" tone="muted">{t("Com um máximo, o aluno escolhe: “15 a 20 vezes”.")}</Text>
        </View>
        <Field label={t("Nome da série")} optional hint={t("Ex.: Fartlek, Bloco do sábado.")}>
          {(a) => <Input {...a} value={r.note ?? ""} onChangeText={(v) => setR({ ...r, note: v || undefined })} maxLength={80} />}
        </Field>
      </View>
    </Dialog>
  );
}

// ---------------------------------------------------------------- strength exercise
const LOADS: { value: Load["type"]; label: string }[] = [{ value: "bodyweight", label: "Peso corporal" }, { value: "kg", label: "kg" }, { value: "pct_1rm", label: "% 1RM" }, { value: "rpe", label: "PSE" }];
export function ExerciseSheet({ exercise, open, onClose, onApply, onRemove }: { exercise: Exercise | null; open: boolean; onClose: () => void; onApply: (e: Exercise) => void; onRemove?: () => void }) {
  return open && exercise ? <ExerciseDraft key={JSON.stringify(exercise)} exercise={exercise} onClose={onClose} onApply={onApply} onRemove={onRemove} /> : <Dialog open={false} onOpenChange={onClose} title="" />;
}
function ExerciseDraft({ exercise, onClose, onApply, onRemove }: { exercise: Exercise; onClose: () => void; onApply: (e: Exercise) => void; onRemove?: () => void }) {
  const { theme } = useTheme();
  const { club } = useClub();
  const lib = useExercises(club?.id);
  const [e, setE] = useState<Exercise>(exercise);
  const load = e.load ?? { type: "bodyweight" as const };
  // Picking a library name links the block to it (video and cues for the student).
  const rename = (name: string) => {
    const hit = lib.data?.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    const { exercise_id: _drop, ...rest } = e;
    void _drop;
    setE(hit ? { ...rest, name, exercise_id: hit.id } : { ...rest, name });
  };
  const needle = e.name.trim().toLowerCase();
  const suggestions = needle.length >= 2 && !e.exercise_id ? (lib.data ?? []).filter((x) => x.name.toLowerCase().includes(needle)).slice(0, 6) : [];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t("Exercício")} footer={<SheetFooter onCancel={onClose} onApply={() => onApply({ ...e, name: e.name.trim() })} onRemove={onRemove} />}>
      <View style={{ gap: theme.space[4] }}>
        <Field label={t("Exercício")} hint={e.exercise_id ? t("Da biblioteca de exercícios: o aluno vê o vídeo e as dicas.") : null}>
          {(a) => <Input {...a} value={e.name} onChangeText={rename} placeholder={t("Ex.: Agachamento")} autoCapitalize="sentences" />}
        </Field>
        {suggestions.length > 0 && (
          <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"], marginTop: -theme.space[2] }]}>
            {suggestions.map((x) => <Chip key={x.id} accessibilityRole="button" label={x.name} onPress={() => rename(x.name)} />)}
          </View>
        )}
        <Row>
          <Field label={t("Séries")} style={styles.flex}>
            {(a) => <ValueInput label={a.accessibilityLabel} value={e.sets} format={String} parse={(s) => { const n = int(s); return n !== null && n <= 20 ? n : null; }} keyboardType="number-pad" onChange={(sets) => sets && setE({ ...e, sets })} />}
          </Field>
          <Field label={t("Repetições")} style={styles.flex}>
            {(a) => <Input {...a} value={e.reps} onChangeText={(reps) => setE({ ...e, reps })} placeholder="8-10" />}
          </Field>
        </Row>
        <Row>
          <Field label={t("Carga")} style={styles.flex}>
            {(a) => <Select<Load["type"]> {...a} title={t("Carga")} value={load.type} options={LOADS.map((l) => ({ value: l.value, label: t(l.label) }))}
              onChange={(type) => setE({ ...e, load: { type, value: type === "bodyweight" ? undefined : load.value ?? 10 } })} />}
          </Field>
          {load.type !== "bodyweight" && (
            <Field label={t("Valor")} style={styles.flex}>
              {(a) => <ValueInput label={a.accessibilityLabel} value={load.value} format={(n) => String(n).replace(".", ",")} parse={num} keyboardType="decimal-pad" onChange={(value) => value && setE({ ...e, load: { ...load, value } })} />}
            </Field>
          )}
        </Row>
        <Field label={t("Descanso entre séries (segundos)")} optional>
          {(a) => <ValueInput label={a.accessibilityLabel} value={e.rest_s} format={String} parse={int} keyboardType="number-pad" optional placeholder="60" onChange={(rest_s) => setE({ ...e, rest_s })} />}
        </Field>
        <Field label={t("Observação")} optional>
          {(a) => <Input {...a} value={e.note ?? ""} onChangeText={(v) => setE({ ...e, note: v || undefined })} placeholder={t("Ex.: cada lado")} maxLength={200} />}
        </Field>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  stretch: { alignSelf: "stretch" },
  bold: { fontWeight: weight("bold") },
});

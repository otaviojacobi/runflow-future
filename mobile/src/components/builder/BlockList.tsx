/**
 * The workout's blocks as a list (W5 on the phone): each step reads like the student will see it (zone color + text);
 * tapping one edits it in a sheet; "⋯" moves, duplicates or removes it. Series are a dashed box with their own steps
 * and "Etapa na série". Strength workouts list exercises. Controlled: blocks + onChange.
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Sport } from "@/api/types";
import { cloneBlock, move, newExercise, newRepeat, newStep } from "@/domain/builder";
import { countText, exerciseText, repeatTitle, stepExtras, stepWhat, targetText, zoneOf, type Block, type Exercise, type Repeat, type Step } from "@/domain/workout";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, IconButton, Menu, Text, type MenuItem } from "@/ui";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Repeat as RepeatIcon, Trash2 } from "@/ui/icons";
import { ExerciseSheet, RepeatSheet, StepSheet } from "./sheets";

/** Where the open sheet's block lives: a top-level block, or a step inside a series. */
type Path = { i: number; j?: number };

function StepLine({ step, sport, onPress, menu, nested }: { step: Step; sport: Sport; onPress: () => void; menu: ReactNode; nested?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const z = zoneOf(step, sport);
  const what = stepWhat(step, sport);
  const target = targetText(step.target, sport, step.duration);
  const extra = [stepExtras(step), step.note].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, { minHeight: theme.size.touchMin + theme.space[2], borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: nested ? c.canvas : c.surface }]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={t("Editar etapa")} accessibilityLabel={[what, target, extra].filter(Boolean).join(", ")}
        style={({ pressed }) => [styles.row, styles.flex, { gap: theme.space[3], paddingVertical: theme.space[2], paddingLeft: theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
        <View aria-hidden style={{ alignSelf: "stretch", width: theme.space[1], borderRadius: theme.radius.full, backgroundColor: c.zone[z].solid }} />
        <View style={styles.flex}>
          <Text variant="labelMd">{what}</Text>
          {target ? <Text variant="bodySm" color={c.zone[z].text}>{target}</Text> : null}
          {extra ? <Text variant="caption" tone="muted" numberOfLines={2}>{extra}</Text> : null}
        </View>
      </Pressable>
      {menu}
    </View>
  );
}

function ExerciseLine({ ex, n, onPress, menu }: { ex: Exercise; n: number; onPress: () => void; menu: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={[styles.row, { minHeight: theme.size.touchMin + theme.space[2], borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={t("Editar exercício")} accessibilityLabel={`${ex.name || t("Exercício sem nome")}, ${exerciseText(ex)}`}
        style={({ pressed }) => [styles.row, styles.flex, { gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
        <Text variant="labelMd" tone="muted" style={styles.tabular}>{n}</Text>
        <View style={styles.flex}>
          <Text variant="labelMd" tone={ex.name ? "default" : "subtle"}>{ex.name || t("Exercício sem nome")}</Text>
          <Text variant="bodySm" tone="muted">{exerciseText(ex)}{ex.note ? ` · ${ex.note}` : ""}</Text>
        </View>
      </Pressable>
      {menu}
    </View>
  );
}

function RowMenu({ label, onUp, onDown, onDup, onDel }: { label: string; onUp?: () => void; onDown?: () => void; onDup: () => void; onDel: () => void }) {
  const items: MenuItem[] = [
    { label: t("Subir"), icon: ArrowUp, onSelect: () => onUp?.(), disabled: !onUp },
    { label: t("Descer"), icon: ArrowDown, onSelect: () => onDown?.(), disabled: !onDown },
    { label: t("Duplicar"), icon: Copy, onSelect: onDup },
    "separator",
    { label: t("Remover"), icon: Trash2, danger: true, onSelect: onDel },
  ];
  return <Menu title={label} items={items} trigger={(open) => <IconButton icon={MoreHorizontal} label={t("Ações: {x}", { x: label })} onPress={open} />} />;
}

export function BlockList({ blocks, sport, onChange }: { blocks: Block[]; sport: Sport; onChange: (b: Block[]) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [editing, setEditing] = useState<Path | null>(null);
  const set = (i: number, b: Block) => onChange(blocks.map((x, k) => (k === i ? b : x)));
  const remove = (i: number) => onChange(blocks.filter((_, k) => k !== i));
  const menu = (i: number, label: string) => (
    <RowMenu label={label} onUp={i > 0 ? () => onChange(move(blocks, i, -1)) : undefined} onDown={i < blocks.length - 1 ? () => onChange(move(blocks, i, 1)) : undefined}
      onDup={() => onChange([...blocks.slice(0, i + 1), cloneBlock(blocks[i]!), ...blocks.slice(i + 1)])} onDel={() => remove(i)} />
  );
  // Adding opens the new block's sheet right away.
  const add = (b: Block) => { onChange([...blocks, b]); if (b.kind !== "repeat") setEditing({ i: blocks.length }); };

  const target = editing ? blocks[editing.i] : undefined;
  const openStep = target?.kind === "step" ? target : target?.kind === "repeat" && editing?.j !== undefined ? target.steps[editing.j] ?? null : null;
  const openRepeat = target?.kind === "repeat" && editing?.j === undefined ? target : null;
  const openExercise = target?.kind === "exercise" ? target : null;
  const close = () => setEditing(null);
  const applyStep = (s: Step) => {
    if (!editing || !target) return close();
    if (target.kind === "repeat" && editing.j !== undefined) set(editing.i, { ...target, steps: target.steps.map((x, k) => (k === editing.j ? s : x)) });
    else set(editing.i, s);
    close();
  };
  const removeOpen = () => {
    if (!editing || !target) return close();
    if (target.kind === "repeat" && editing.j !== undefined) {
      if (target.steps.length > 1) set(editing.i, { ...target, steps: target.steps.filter((_, k) => k !== editing.j) });
      else remove(editing.i);
    } else remove(editing.i);
    close();
  };

  return (
    <View style={{ gap: theme.space[2] }}>
      {blocks.length === 0 && <Text variant="bodySm" tone="muted">{sport === "strength" ? t("Nenhum exercício ainda. Escreva acima ou adicione abaixo.") : t("Nenhuma etapa ainda. Escreva acima ou adicione abaixo.")}</Text>}
      {blocks.map((b, i) => {
        if (b.kind === "exercise") return <ExerciseLine key={i} ex={b} n={i + 1} onPress={() => setEditing({ i })} menu={menu(i, t("exercício"))} />;
        if (b.kind === "step") return <StepLine key={i} step={b} sport={sport} onPress={() => setEditing({ i })} menu={menu(i, t("etapa"))} />;
        const r: Repeat = b;
        return (
          <View key={i} style={{ gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.lg, borderWidth: 2, borderStyle: "dashed", borderColor: c.lineStrong }}>
            <View style={styles.row}>
              <Pressable onPress={() => setEditing({ i })} accessibilityRole="button" accessibilityHint={t("Editar série")}
                accessibilityLabel={[t("Série: {n} vezes", { n: countText(r) }), r.note].filter(Boolean).join(", ")}
                style={({ pressed }) => [styles.row, styles.flex, { gap: theme.space[2], minHeight: theme.size.touchMin, paddingHorizontal: theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
                <RepeatIcon size={theme.size.iconSm} color={c.fgMuted} aria-hidden />
                <Text variant="labelMd">{repeatTitle(r)}</Text>
                {r.note ? <Text variant="bodySm" tone="muted" numberOfLines={1} style={styles.flex}>· {r.note}</Text> : null}
              </Pressable>
              {menu(i, t("série"))}
            </View>
            {r.steps.map((s, j) => (
              <StepLine key={j} nested step={s} sport={sport} onPress={() => setEditing({ i, j })}
                menu={<RowMenu label={t("etapa")}
                  onUp={j > 0 ? () => set(i, { ...r, steps: move(r.steps, j, -1) }) : undefined}
                  onDown={j < r.steps.length - 1 ? () => set(i, { ...r, steps: move(r.steps, j, 1) }) : undefined}
                  onDup={() => set(i, { ...r, steps: [...r.steps.slice(0, j + 1), cloneBlock(s), ...r.steps.slice(j + 1)] })}
                  onDel={() => (r.steps.length > 1 ? set(i, { ...r, steps: r.steps.filter((_, k) => k !== j) }) : remove(i))} />} />
            ))}
            <Button variant="ghost" size="sm" icon={Plus} style={styles.start}
              onPress={() => { set(i, { ...r, steps: [...r.steps, newStep(sport, "recovery")] }); setEditing({ i, j: r.steps.length }); }}>{t("Etapa na série")}</Button>
          </View>
        );
      })}
      <View style={[styles.row, { gap: theme.space[2], paddingTop: theme.space[1] }]}>
        {sport === "strength" ? (
          <Button variant="secondary" icon={Plus} onPress={() => add(newExercise())}>{t("Exercício")}</Button>
        ) : (
          <>
            <Button variant="secondary" icon={Plus} onPress={() => add(newStep(sport, blocks.length ? "active" : "warmup"))}>{t("Etapa")}</Button>
            <Button variant="secondary" icon={RepeatIcon} onPress={() => add(newRepeat(sport))}>{t("Série")}</Button>
          </>
        )}
      </View>
      <StepSheet step={openStep ?? null} sport={sport} open={!!openStep} onClose={close} onApply={applyStep} onRemove={removeOpen} />
      <RepeatSheet repeat={openRepeat} open={!!openRepeat} onClose={close} onApply={(r) => { if (editing) set(editing.i, r); close(); }} onRemove={removeOpen} />
      <ExerciseSheet exercise={openExercise} open={!!openExercise} onClose={close} onApply={(e) => { if (editing) set(editing.i, e); close(); }} onRemove={removeOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  tabular: { fontVariant: ["tabular-nums"] },
});

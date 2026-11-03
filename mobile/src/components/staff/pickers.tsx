/**
 * Pickers shared by the staff sheets ("Atribuir treino" in W4, the planilha editor and "Aplicar planilha" in W7):
 * a workout from the library (search by name or #tag) and students (groups as shortcuts, "Todos", a searchable list).
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAthletes, useGroups, useTemplates } from "@/api/staff";
import type { WorkoutTemplate } from "@/api/types";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import { estimateText } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Input, Skeleton, Text } from "@/ui";
import { Check, Search } from "@/ui/icons";

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The club's library as a radio list with a search field; `enabled` = load it (the sheet is open). */
export function TemplateList({ clubId, enabled = true, selectedId, onPick }: { clubId: string; enabled?: boolean; selectedId: string | null; onPick: (w: WorkoutTemplate) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [q, setQ] = useState("");
  const templates = useTemplates(enabled ? clubId : undefined);
  const tpls = useMemo(() => {
    const needle = norm(q.trim().replace(/^#/, ""));
    const tag = q.trim().startsWith("#");
    return (templates.data ?? []).filter((w) => !needle || (tag ? w.tags.some((x) => x.includes(needle)) : norm(w.name).includes(needle) || w.tags.some((x) => x.includes(needle))));
  }, [templates.data, q]);
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={styles.search}>
        <Input value={q} onChangeText={setQ} placeholder={t("Buscar por nome ou #tag")} accessibilityLabel={t("Buscar na biblioteca")} autoCapitalize="none" autoCorrect={false}
          returnKeyType="search" style={{ paddingLeft: theme.space[10] }} />
        <View pointerEvents="none" style={[styles.searchIcon, { left: theme.space[3] }]}><Search size={theme.size.iconSm} color={c.fgSubtle} aria-hidden /></View>
      </View>
      {templates.isPending ? (
        <View style={{ gap: theme.space[2] }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[16] }} />)}</View>
      ) : tpls.length ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Treinos da biblioteca")} style={{ gap: theme.space["1.5"] }}>
          {tpls.map((w) => {
            const on = selectedId === w.id;
            const est = estimateText(w);
            return (
              <Pressable key={w.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={[w.name, est, w.tags.map((x) => `#${x}`).join(" ")].filter(Boolean).join(", ")}
                onPress={() => onPick(w)}
                style={({ pressed }) => [{ gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, borderWidth: on ? 2 : 1, borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface }]}>
                <View style={[styles.row, { gap: theme.space[2] }]}>
                  <SportChip sport={w.sport} size="sm" />
                  <Text variant="labelMd" numberOfLines={1} style={styles.flex}>{w.name}</Text>
                  {on && <Check size={theme.size.iconMd} color={c.brand.subtleFg} aria-hidden />}
                </View>
                <IntensityProfile structure={w.structure} sport={w.sport} height={theme.space[5]} />
                {est || w.tags.length ? <Text variant="caption" tone="muted" numberOfLines={1}>{[est, w.tags.map((x) => `#${x}`).join(" ")].filter(Boolean).join(" · ")}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text tone="muted">{q.trim() ? t("Nenhum treino com esse nome ou tag.") : t("A biblioteca do clube ainda está vazia.")}</Text>
      )}
    </View>
  );
}

/** Students to act on: groups add or remove their members, "Todos"/"Limpar", search when the club is big. */
export function AthletePicker({ clubId, enabled = true, value, onChange, error }: { clubId: string; enabled?: boolean; value: Set<string>; onChange: (v: Set<string>) => void; error?: string | null }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [who, setWho] = useState("");
  const list = useAthletes(enabled ? clubId : undefined);
  const groups = useGroups(enabled ? clubId : undefined);
  const people = (list.data ?? []).filter((a) => !who.trim() || norm(a.user.name).includes(norm(who.trim())));
  const everyone = (list.data?.length ?? 0) > 0 && value.size === list.data?.length;
  const toggle = (id: string) => { const n = new Set(value); if (n.has(id)) n.delete(id); else n.add(id); onChange(n); };
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Text variant="labelSm" accessibilityRole="header" style={styles.flex}>{t("Para quem")}{value.size ? ` · ${value.size}` : ""}</Text>
        {(list.data?.length ?? 0) > 0 && (
          <Button variant="ghost" size="sm" onPress={() => onChange(everyone ? new Set() : new Set((list.data ?? []).map((a) => a.membership.id)))}>{everyone ? t("Limpar") : t("Todos")}</Button>
        )}
      </View>
      {(groups.data ?? []).length > 0 && (
        <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"] }]}>
          {(groups.data ?? []).map((g) => {
            const on = g.member_ids.length > 0 && g.member_ids.every((id) => value.has(id));
            return (
              <Pressable key={g.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${g.name}, ${tn(g.member_ids.length, "{n} aluno", "{n} alunos")}`}
                onPress={() => { const n = new Set(value); g.member_ids.forEach((id) => (on ? n.delete(id) : n.add(id))); onChange(n); }}
                hitSlop={theme.space[1]}
                style={({ pressed }) => [styles.row, styles.chip, { gap: theme.space[1], height: theme.size.controlSm, paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface }]}>
                {on && <Check size={theme.size.iconSm - 2} color={c.brand.subtleFg} aria-hidden />}
                <Text variant="labelSm" color={on ? c.brand.subtleFg : c.fgMuted}>{g.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {(list.data?.length ?? 0) > 8 && (
        <Input value={who} onChangeText={setWho} placeholder={t("Buscar aluno")} accessibilityLabel={t("Buscar aluno")} autoCorrect={false} />
      )}
      {list.isPending ? <Skeleton style={{ height: theme.space[20] }} /> : (
        <View>
          {people.map((a) => {
            const on = value.has(a.membership.id);
            return (
              <Pressable key={a.membership.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.user.name} onPress={() => toggle(a.membership.id)}
                style={({ pressed }) => [styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin, paddingHorizontal: theme.space[1], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
                <View style={[styles.box, { width: theme.size.iconMd, height: theme.size.iconMd, borderRadius: theme.radius.xs, borderColor: on ? c.brand.solid : c.lineStrong, backgroundColor: on ? c.brand.solid : c.surface }]}>
                  {on && <Check size={theme.size.iconSm} color={c.brand.onSolid} strokeWidth={3} aria-hidden />}
                </View>
                <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[6] + theme.space[1]} />
                <Text variant="labelMd" numberOfLines={1} style={styles.flex}>{a.user.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  chip: { borderWidth: 1 },
  box: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

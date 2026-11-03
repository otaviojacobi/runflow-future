/**
 * W4 · "Atribuir treino" on the phone (the web's planning AssignDialog as a two-step bottom sheet): first a workout
 * from the library (search by name or #tag), then who (groups as shortcuts, a searchable student list) and which days
 * (a week strip with arrows; days in other weeks stay listed), plus a note. One workout per student × day; drafts
 * (D-031) wait for the week's release. Building a new workout is the builder's job (X12): until then it opens the web.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAssign, useAthletes, useGroups, useTemplates } from "@/api/staff";
import type { Club, WorkoutTemplate } from "@/api/types";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import { estimateText } from "@/domain/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { addDays, dayMonth, shortDate, weekdayShort } from "@/lib/format";
import { hasWeb, openOnWeb } from "@/lib/web";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Field, IconButton, Input, Skeleton, Text, Textarea, Dialog, toast } from "@/ui";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Search, X } from "@/ui/icons";

export interface AssignPrefill { athleteIds?: string[]; dates?: string[] }

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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
  const [q, setQ] = useState("");
  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [athletes, setAthletes] = useState<Set<string>>(new Set(prefill?.athleteIds ?? []));
  const [dates, setDates] = useState<Set<string>>(new Set(prefill?.dates ?? []));
  const [shown, setShown] = useState(monday);
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState("");
  const templates = useTemplates(open ? club.id : undefined);
  const list = useAthletes(open ? club.id : undefined);
  const groups = useGroups(open ? club.id : undefined);
  const assign = useAssign(club.id);
  const err = assign.error instanceof ApiError ? assign.error : null;

  const tpls = useMemo(() => {
    const needle = norm(q.trim().replace(/^#/, ""));
    const tag = q.trim().startsWith("#");
    return (templates.data ?? []).filter((w) => !needle || (tag ? w.tags.some((x) => x.includes(needle)) : norm(w.name).includes(needle) || w.tags.some((x) => x.includes(needle))));
  }, [templates.data, q]);
  const people = (list.data ?? []).filter((a) => !who.trim() || norm(a.user.name).includes(norm(who.trim())));
  const week = Array.from({ length: 7 }, (_, i) => addDays(shown, i));
  const elsewhere = [...dates].filter((d) => !week.includes(d)).sort();
  const count = athletes.size * dates.size;
  const everyone = (list.data?.length ?? 0) > 0 && athletes.size === list.data?.length;

  const submit = () => {
    if (!template) return;
    assign.mutate({ template_id: template.id, athlete_ids: [...athletes], dates: [...dates].sort(), notes: notes.trim() || null }, {
      onSuccess: (r) => {
        const seen = r.items.filter((w) => w.visible).length;
        const detail = seen === r.items.length ? t("Os alunos já veem na agenda.") : seen === 0 ? t("Ficam em rascunho até a semana ser liberada.") : t("Os da semana em andamento já aparecem; os outros ficam em rascunho até a liberação.");
        toast.success(tn(r.items.length, "{n} treino atribuído", "{n} treinos atribuídos"), detail);
        onClose();
      },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  const footer = step === "workout" ? (
    <>
      <Button variant="secondary" onPress={onClose}>{t("Cancelar")}</Button>
      <Button iconRight={ChevronRight} disabled={!template} onPress={() => setStep("who")}>{t("Continuar")}</Button>
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
      title={t("Atribuir treino")} description={step === "workout" ? t("Escolha um treino da biblioteca.") : template?.name ?? null}>
      {step === "workout" ? (
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
                const on = template?.id === w.id;
                const est = estimateText(w);
                return (
                  <Pressable key={w.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={[w.name, est, w.tags.map((x) => `#${x}`).join(" ")].filter(Boolean).join(", ")}
                    onPress={() => setTemplate(w)}
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
          <View style={{ gap: theme.space[1], paddingTop: theme.space[2] }}>
            <Text variant="bodySm" tone="muted">{t("Para montar um treino novo, use o construtor no computador.")}</Text>
            {hasWeb && <Button variant="ghost" size="sm" icon={ExternalLink} onPress={() => openOnWeb("/library/new")} style={styles.start}>{t("Montar na web")}</Button>}
          </View>
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

          <View style={{ gap: theme.space[2] }}>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Text variant="labelSm" accessibilityRole="header" style={styles.flex}>{t("Para quem")}{athletes.size ? ` · ${athletes.size}` : ""}</Text>
              {(list.data?.length ?? 0) > 0 && (
                <Button variant="ghost" size="sm" onPress={() => setAthletes(everyone ? new Set() : new Set((list.data ?? []).map((a) => a.membership.id)))}>{everyone ? t("Limpar") : t("Todos")}</Button>
              )}
            </View>
            {(groups.data ?? []).length > 0 && (
              <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"] }]}>
                {(groups.data ?? []).map((g) => {
                  const on = g.member_ids.length > 0 && g.member_ids.every((id) => athletes.has(id));
                  return (
                    <Pressable key={g.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${g.name}, ${tn(g.member_ids.length, "{n} aluno", "{n} alunos")}`}
                      onPress={() => { const n = new Set(athletes); g.member_ids.forEach((id) => (on ? n.delete(id) : n.add(id))); setAthletes(n); }}
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
                  const on = athletes.has(a.membership.id);
                  return (
                    <Pressable key={a.membership.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.user.name} onPress={() => setAthletes(toggle(athletes, a.membership.id))}
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
            {err?.fieldError("athlete_ids") ? <Text variant="caption" tone="danger">{err.fieldError("athlete_ids")}</Text> : null}
          </View>

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
  start: { alignSelf: "flex-start" },
  day: { flex: 1, alignItems: "center", justifyContent: "center" },
  chip: { borderWidth: 1 },
  box: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  centerText: { textAlign: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

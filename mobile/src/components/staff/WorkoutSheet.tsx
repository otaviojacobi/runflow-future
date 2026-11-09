/**
 * A planned workout in a bottom sheet (the web's planning DetailDialog + the feedback thread, phone-sized): structure,
 * notes, how it went, the synced activity; quick edits (move to another day, title and note, remove after a
 * confirmation; the steps through the builder, X12) and the conversation with the student.
 */
import { useIsFocused } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useComments, useDeletePlanned, usePlannedDetail, usePostComment, useUpdatePlanned } from "@/api/staff";
import type { AthleteRef, PlannedWorkout } from "@/api/types";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, distance, duration, longDate, mondayOf, pace, shortDate, timeOf, today as todayFn, weekdayShort } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Dialog, Field, IconButton, Input, ListItem, Skeleton, Text, Textarea, toast } from "@/ui";
import { CalendarArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, EyeOff, MessageSquare, Pencil, Send, Trash2 } from "@/ui/icons";
import { Bubbles } from "@/components/workout/Thread";
import { IntensityProfile, Stat, StatusBadge, feelingLabel } from "@/components/workout/workout";
import { WorkoutSteps } from "@/components/workout/WorkoutSteps";
import { WorkoutBuilder } from "@/components/builder/WorkoutBuilder";
import { estimate, estimateText, type Structure } from "@/domain/workout";
import { StravaAttribution } from "@/components/strava";
import { ActivityAnalysis } from "@/components/ActivityAnalysis";

export type SheetMode = "view" | "move" | "edit" | "remove" | "thread";
/** What the list already knows, so the sheet opens instantly; `mode` picks the first view (Feedbacks: the thread). */
export interface WorkoutSeed { workout: PlannedWorkout; athlete?: AthleteRef; mode?: SheetMode }

const QUICK = ["Ótimo treino! 💪", "Boa! Segue assim.", "Vamos ajustar o próximo treino.", "Descansa bem hoje.", "Me conta mais?"];

export function WorkoutSheet({ seed, onClose }: { seed: WorkoutSeed | null; onClose: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const { club, ctx } = useClub();
  const [last, setLast] = useState(seed);
  const [mode, setMode] = useState<SheetMode>(seed?.mode ?? "view");
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [structure, setStructure] = useState<Structure | null>(null);
  const [text, setText] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  // A new workout resets the sheet (the last one stays rendered while the sheet slides away).
  if (seed && seed !== last) {
    setLast(seed); setMode(seed.mode ?? "view"); setMoveTo(null); setWeek(null);
    setTitle(seed.workout.title); setNotes(seed.workout.notes ?? ""); setStructure(null); setText(""); setTitleError(null);
  }
  const s = seed ?? last;
  const clubId = club?.id ?? "";
  const open = !!seed;
  const id = s?.workout.id ?? null;
  const detail = usePlannedDetail(clubId, open ? id : null);
  // Live while the sheet shows the conversation on a focused screen (lib/live): a student's message appears by itself.
  const thread = useComments(clubId, open && mode === "thread" ? id : null, useIsFocused());
  const update = useUpdatePlanned(clubId);
  const del = useDeletePlanned(clubId);
  const post = usePostComment(clubId, id ?? "");
  if (!s || !club || !ctx) return null;

  const w = detail.data ?? s.workout;
  const athlete = detail.data?.athlete ?? s.athlete;
  const first = athlete?.user.name.split(" ")[0] ?? "";
  const today = todayFn(club.timezone);
  const gone = detail.error instanceof ApiError && detail.error.status === 404;

  const move = () => moveTo && update.mutate({ id: w.id, date: moveTo }, {
    onSuccess: () => { toast.success(t("Treino movido para {d}", { d: shortDate(moveTo) })); onClose(); },
    onError: toast.error,
  });
  const save = () => {
    if (!title.trim()) return setTitleError(t("Informe o nome do treino."));
    if (structure && !structure.blocks.length) return toast.error(new ApiError(422, "structure", t("Adicione pelo menos uma etapa."), t("Escreva o treino ou adicione uma etapa.")));
    const steps = structure ? (() => { const est = estimate(structure, w.sport); return { structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m }; })() : {};
    update.mutate({ id: w.id, title: title.trim(), notes: notes.trim() || null, ...steps }, {
      onSuccess: () => { toast.success(t("Treino atualizado"), w.visible ? t("O aluno foi avisado.") : t("O aluno vê quando a semana for liberada.")); onClose(); },
      onError: (e) => { const f = e instanceof ApiError ? e.fieldError("title") : undefined; if (f) setTitleError(f); else toast.error(e); },
    });
  };
  const remove = () => del.mutate(w.id, { onSuccess: () => { toast.success(t("Treino removido")); onClose(); }, onError: toast.error });
  const send = (body: string) => {
    if (!body.trim() || post.isPending) return;
    post.mutate(body.trim(), { onSuccess: () => setText(""), onError: toast.error });
  };

  const header = mode === "thread"
    ? { title: athlete?.user.name ?? w.title, description: `${w.title} · ${shortDate(w.date)}` }
    : mode === "edit" ? { title: t("Editar treino"), description: [athlete?.user.name, longDate(w.date)].filter(Boolean).join(" · ") }
    : mode === "move" ? { title: t("Mover treino"), description: `${w.title} · ${shortDate(w.date)}` }
    : mode === "remove" ? { title: t("Remover treino?"), description: `${w.title} · ${shortDate(w.date)}` }
    : { title: w.title, description: [athlete?.user.name, longDate(w.date)].filter(Boolean).join(" · ") };

  const footer = gone ? undefined
    : mode === "view" ? (
      <>
        <Button variant="secondary" icon={CalendarArrowUp} onPress={() => { setWeek(mondayOf(w.date)); setMode("move"); }} style={styles.flex}>{t("Mover")}</Button>
        <Button variant="secondary" icon={Pencil} onPress={() => { setTitle(w.title); setNotes(w.notes ?? ""); setStructure(w.structure); setTitleError(null); setMode("edit"); }} style={styles.flex}>{t("Editar")}</Button>
      </>
    ) : mode === "move" ? (
      <>
        <Button variant="secondary" onPress={() => setMode("view")}>{t("Cancelar")}</Button>
        <Button icon={CalendarArrowUp} disabled={!moveTo || moveTo === w.date} loading={update.isPending} onPress={move}>{t("Mover")}</Button>
      </>
    ) : mode === "edit" ? (
      <>
        <Button variant="secondary" onPress={() => setMode("view")}>{t("Cancelar")}</Button>
        <Button loading={update.isPending} disabled={title.trim() === w.title && (notes.trim() || null) === (w.notes ?? null)} onPress={save}>{t("Salvar")}</Button>
      </>
    ) : mode === "remove" ? (
      <>
        <Button variant="secondary" onPress={() => setMode("view")}>{t("Cancelar")}</Button>
        <Button variant="danger" icon={Trash2} loading={del.isPending} onPress={remove}>{t("Remover")}</Button>
      </>
    ) : (
      <View style={[styles.full, { gap: theme.space[2] }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: theme.space["1.5"] }}>
          {QUICK.map((q) => (
            <Pressable key={q} accessibilityRole="button" accessibilityLabel={t("Enviar: {text}", { text: t(q) })} disabled={post.isPending} onPress={() => send(t(q))}
              hitSlop={(theme.size.touchMin - theme.size.controlSm) / 2}
              style={({ pressed }) => [styles.row, { height: theme.size.controlSm, paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.soft : c.surface }, post.isPending && styles.off]}>
              <Text variant="bodySm">{t(q)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Input value={text} onChangeText={setText} placeholder={t("Responder para {name}", { name: first || t("o aluno") })} accessibilityLabel={t("Mensagem")}
            multiline {...(Platform.OS === "web" && { rows: 1 })} style={[styles.flex, { minHeight: theme.size.touchMin, maxHeight: theme.space[20] + theme.space[8], paddingVertical: theme.space[2] + theme.space["0.5"], borderRadius: theme.radius.xl }]} />
          <IconButton icon={Send} label={t("Enviar")} variant="primary" disabled={!text.trim() || post.isPending} onPress={() => send(text)} style={{ borderRadius: theme.radius.full }} />
        </View>
      </View>
    );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={header.title} description={header.description} footer={footer}>
      {gone ? (
        <Text tone="muted">{t("Este treino não existe mais. Ele pode ter sido removido por outra pessoa da equipe.")}</Text>
      ) : mode === "view" ? (
        <View style={{ gap: theme.space[4] }}>
          <View style={[styles.row, styles.wrap, { gap: theme.space[2] }]}>
            <SportChip sport={w.sport} size="sm" />
            <StatusBadge status={w.completion?.status ?? "planned"} />
            {!w.visible && <Badge icon={EyeOff}>{t("Rascunho")}</Badge>}
            {estimateText(w) ? <Text variant="bodySm" tone="muted">{estimateText(w)}</Text> : null}
          </View>
          {!w.visible && <Text variant="bodySm" tone="muted">{t("O aluno ainda não vê este treino: a semana não foi liberada.")}</Text>}
          {/* Done with an activity: the plan folds to its profile so the splits or tiros (D-055) come up sooner. */}
          {detail.data?.activity ? <FoldedPlan key={w.id} structure={w.structure} sport={w.sport} /> : (
            <>
              <IntensityProfile structure={w.structure} sport={w.sport} />
              <WorkoutSteps structure={w.structure} sport={w.sport} />
            </>
          )}
          {w.notes ? (
            <View style={{ padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.brand.subtle }}>
              <Text variant="bodySm" color={c.brand.subtleFg}><Text variant="bodySm" color={c.brand.subtleFg} style={{ fontWeight: weight("bold") }}>{t("Recado:")}</Text>{` ${w.notes}`}</Text>
            </View>
          ) : null}
          {(w.completion || detail.data?.activity) && (() => {
            const a = detail.data?.activity;
            const fb = w.completion;
            const feedback = fb && (fb.rpe != null || fb.feeling);
            // How it went in one box: the activity's numbers, then what the student said about it.
            return (
              <View style={[styles.box, { gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderColor: c.line }]}>
                <View style={{ gap: theme.space["0.5"] }}>
                  <Text variant="titleSm" accessibilityRole="header">{t("Como foi")}</Text>
                  {a && <Text variant="caption" tone="muted" numberOfLines={1}>{`${a.source === "strava" ? "Strava" : t("Registro manual")} · ${a.name} · ${timeOf(a.started_at, club.timezone)}`}</Text>}
                </View>
                {a && (
                  <View style={[styles.row, styles.wrap, { columnGap: theme.space[5], rowGap: theme.space[2] }]}>
                    {a.distance_m ? <Stat size="sm" value={distance(a.distance_m, { swim: a.sport === "swim" })} label={t("Distância")} /> : null}
                    <Stat size="sm" value={duration(a.duration_s)} label={t("Tempo")} />
                    {a.avg_pace_s_per_km && a.sport === "run" ? <Stat size="sm" value={pace(a.avg_pace_s_per_km)} unit="/km" label={t("Pace médio")} /> : null}
                    {a.avg_hr ? <Stat size="sm" value={String(a.avg_hr)} unit="bpm" label={t("FC média")} /> : null}
                  </View>
                )}
                {feedback && (
                  <View style={[styles.row, styles.wrap, { columnGap: theme.space[5], rowGap: theme.space[2] }]}>
                    {fb.rpe != null && <Stat size="sm" value={String(fb.rpe)} unit="/10" label={t("Esforço (PSE)")} />}
                    {fb.feeling && <Stat size="sm" value={feelingLabel(fb.feeling)} label={t("Sensação")} />}
                  </View>
                )}
                {fb?.comment ? <Quote text={fb.comment} /> : null}
                {a?.source === "strava" && <StravaAttribution externalId={a.external_id} />}
              </View>
            );
          })()}
          {/* The student's training as their watch recorded it (D-055), under the same consent as the activity. */}
          {detail.data?.activity && <ActivityAnalysis a={detail.data.activity} />}
          {detail.isPending && <Skeleton style={{ height: theme.space[16] }} />}
          <View style={[styles.box, { borderRadius: theme.radius.lg, borderColor: c.line, padding: theme.space[1] }]}>
            <ListItem title={t("Conversa com {name}", { name: first || t("o aluno") })} icon={MessageSquare} chevron onPress={() => setMode("thread")}
              subtitle={w.comments_count ? tn(w.comments_count, "{n} mensagem", "{n} mensagens") + (w.unread_count ? ` · ${tn(w.unread_count, "{n} nova", "{n} novas")}` : "") : t("Nenhuma mensagem ainda")} />
          </View>
          {/* The destructive action sits apart from Mover/Editar and asks first. */}
          <Button variant="ghost" icon={Trash2} onPress={() => setMode("remove")} style={styles.start}>{t("Remover treino")}</Button>
        </View>
      ) : mode === "move" ? (
        <MovePicker current={w.date} today={today} week={week ?? mondayOf(w.date)} onWeek={setWeek} value={moveTo} onChange={setMoveTo} />
      ) : mode === "edit" ? (
        <View style={{ gap: theme.space[4] }}>
          <Field label={t("Nome do treino")} error={titleError}>
            {(a) => <Input {...a} value={title} onChangeText={(v) => { setTitle(v); setTitleError(null); }} returnKeyType="next" maxLength={120} />}
          </Field>
          <Field label={t("Recado para o aluno")} optional hint={t("Aparece junto do treino para o aluno.")}>
            {(a) => <Textarea {...a} value={notes} onChangeText={setNotes} placeholder={t("Ex.: foco nos últimos tiros, braço solto")} maxLength={1000} />}
          </Field>
          {structure && <WorkoutBuilder compact sport={w.sport} structure={structure} onChange={setStructure} />}
        </View>
      ) : mode === "remove" ? (
        <View style={{ gap: theme.space[3] }}>
          <Text>{athlete ? t("O treino sai da agenda de {name}.", { name: athlete.user.name }) : t("O treino sai da agenda do aluno.")}</Text>
          {(w.completion || w.comments_count > 0) && <Text tone="muted">{t("O feedback e a conversa deste treino também deixam de aparecer.")}</Text>}
          <Text tone="muted">{t("Não dá para desfazer.")}</Text>
        </View>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          {w.completion ? (
            <View style={{ gap: theme.space[3] }}>
              <View style={[styles.row, styles.wrap, { gap: theme.space[2] }]}>
                <StatusBadge status={w.completion.status} />
                {w.completion.rpe != null && <Badge>{t("PSE {n}", { n: w.completion.rpe })}</Badge>}
                {w.completion.feeling && <Badge>{feelingLabel(w.completion.feeling)}</Badge>}
              </View>
              {w.completion.comment ? <Quote text={w.completion.comment} /> : null}
            </View>
          ) : <Text variant="bodySm" tone="muted">{w.date < today ? t("Sem registro deste treino.") : t("Treino ainda não feito.")}</Text>}
          <Button variant="ghost" size="sm" onPress={() => setMode("view")} style={styles.start}>{t("Ver treino")}</Button>
          {thread.isPending ? <Skeleton style={{ height: theme.space[16] }} />
            : thread.data?.length ? <Bubbles items={thread.data} mine={ctx.membership.id} trainerLabel={club.trainer_label} />
            : <Text variant="bodySm" tone="muted">{t("Nenhuma mensagem ainda. Responda pelo campo abaixo ou toque numa resposta rápida.")}</Text>}
        </View>
      )}
    </Dialog>
  );
}

/** A done workout's plan: its intensity profile, the steps a tap away. */
function FoldedPlan({ structure, sport }: { structure: Structure; sport: PlannedWorkout["sport"] }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={{ gap: theme.space[3] }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        accessibilityLabel={open ? t("Esconder as etapas") : t("Ver as etapas")}
        style={({ pressed }) => [{ gap: theme.space[2], minHeight: theme.size.touchMin, justifyContent: "center" }, pressed && styles.off]}>
        <IntensityProfile structure={structure} sport={sport} height={theme.space[8]} />
        <View style={[styles.row, { gap: theme.space[1] }]}>
          <Text variant="caption" color={theme.color.brand.text}>{open ? t("Esconder as etapas") : t("Ver as etapas")}</Text>
          <Chevron size={theme.size.iconSm} color={theme.color.brand.text} aria-hidden />
        </View>
      </Pressable>
      {open && <WorkoutSteps structure={structure} sport={sport} />}
    </View>
  );
}

function Quote({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: theme.color.brand.border, paddingLeft: theme.space[3] }}>
      <Text tone="muted" style={styles.italic}>{`“${text}”`}</Text>
    </View>
  );
}

/** Another day for the workout: a week strip with week arrows (no native date picker in Expo Go). */
function MovePicker({ current, today, week, onWeek, value, onChange }: { current: string; today: string; week: string; onWeek: (m: string) => void; value: string | null; onChange: (d: string) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <View style={{ gap: theme.space[4] }}>
      <Text tone="muted">{t("Escolha o novo dia. O treino continua com o mesmo aluno.")}</Text>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <IconButton icon={ChevronLeft} variant="secondary" label={t("Semana anterior")} onPress={() => onWeek(addDays(week, -7))} />
        <Text variant="labelMd" style={[styles.flex, styles.centerText]}>{`${dayMonth(week)} – ${dayMonth(addDays(week, 6))}`}</Text>
        <IconButton icon={ChevronRight} variant="secondary" label={t("Próxima semana")} onPress={() => onWeek(addDays(week, 7))} />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("Novo dia")} style={[styles.row, { gap: theme.space[1] }]}>
        {days.map((d) => {
          const on = d === value;
          const isCurrent = d === current;
          const fg = on ? c.brand.onSolid : d === today ? c.brand.text : c.fg;
          return (
            <Pressable key={d} accessibilityRole="radio" accessibilityState={{ checked: on }}
              accessibilityLabel={`${shortDate(d)}${isCurrent ? `, ${t("dia atual do treino")}` : ""}${d === today ? `, ${t("hoje")}` : ""}`}
              onPress={() => onChange(d)}
              style={({ pressed }) => [styles.day, {
                minHeight: theme.size.touchMin + theme.space[5], borderRadius: theme.radius.md, borderWidth: 1,
                borderStyle: isCurrent && !on ? "dashed" : "solid", borderColor: on ? c.brand.solid : isCurrent ? c.lineStrong : c.line,
                backgroundColor: on ? c.brand.solid : pressed ? c.soft : c.surface,
              }]}>
              <Text variant="overline" color={on ? c.brand.onSolid : c.fgMuted}>{weekdayShort(d)}</Text>
              <Text variant="titleMd" color={fg} style={styles.tabular}>{String(Number(d.slice(8)))}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="bodySm" tone="muted" accessibilityLiveRegion="polite">
        {value && value !== current ? t("De {a} para {b}.", { a: shortDate(current), b: shortDate(value) }) : t("Dia atual do treino: {d} (borda tracejada).", { d: shortDate(current) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  full: { flexBasis: "100%" },
  start: { alignSelf: "flex-start" },
  box: { borderWidth: 1 },
  day: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
  italic: { fontStyle: "italic" },
  off: { opacity: 0.5 },
});

/**
 * W4 · Planejamento on the phone: the week's workouts by day (or by student), with the week's release state (D-031)
 * and "Liberar semana"; "Atribuir treino" from the library (the day on screen prefilled) and "Copiar semana". Tapping
 * a workout opens its sheet: move it to another day, change the title or the note, remove it, or answer the student.
 * Building a new workout is the builder's (X12); until then it opens on the web.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAthletes, useGroups, usePlanned } from "@/api/staff";
import type { AthleteRef, AthleteSummary, PlannedWorkout } from "@/api/types";
import { AssignSheet, type AssignPrefill } from "@/components/staff/AssignSheet";
import { CopyWeekSheet } from "@/components/staff/CopyWeekSheet";
import { WeekRelease } from "@/components/staff/WeekRelease";
import { FilterChips, Section, WorkoutRow } from "@/components/staff/workout";
import { WorkoutSheet, type WorkoutSeed } from "@/components/staff/WorkoutSheet";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, duration, mondayOf, shortDate, today as todayFn, weekdayShort } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, EmptyState, IconButton, Input, PageHeader, Screen, Segmented, Skeleton, Text } from "@/ui";
import { CalendarRange, ChevronLeft, ChevronRight, CircleAlert, Copy, Plus, Search } from "@/ui/icons";

type View_ = "day" | "week";
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const refOf = (a: AthleteSummary): AthleteRef => ({ membership_id: a.membership.id, user: a.user });
const byOrder = (x: PlannedWorkout, y: PlannedWorkout) => x.date.localeCompare(y.date) || x.position - y.position;

function DayStrip({ days, value, onChange, today, counts }: { days: string[]; value: string; onChange: (d: string) => void; today: string; counts: Map<string, number> }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t("Dias da semana")} style={[styles.row, { gap: theme.space[1] }]}>
      {days.map((d) => {
        const on = d === value;
        const n = counts.get(d) ?? 0;
        const isToday = d === today;
        return (
          <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={`${shortDate(d)}${isToday ? `, ${t("hoje")}` : ""}, ${n ? tn(n, "{n} treino", "{n} treinos") : t("sem treinos")}`}
            onPress={() => onChange(d)}
            style={({ pressed }) => [styles.day, {
              minHeight: theme.size.touchMin + theme.space[6], gap: theme.space["0.5"], borderRadius: theme.radius.md, borderWidth: 1,
              borderColor: on ? c.brand.solid : isToday ? c.brand.border : c.line, backgroundColor: on ? c.brand.solid : pressed ? c.soft : c.surface,
            }]}>
            <Text variant="overline" color={on ? c.brand.onSolid : isToday ? c.brand.text : c.fgMuted}>{weekdayShort(d)}</Text>
            <Text variant="titleMd" color={on ? c.brand.onSolid : isToday ? c.brand.text : c.fg} style={styles.tabular}>{String(Number(d.slice(8)))}</Text>
            <View aria-hidden style={{ height: theme.space[1] + theme.space["0.5"], width: theme.space[4], borderRadius: theme.radius.full, backgroundColor: n ? (on ? c.brand.onSolid : c.brand.text) : "transparent" }} />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PlanningScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [monday, setMonday] = useState(mondayOf(today));
  const [day, setDay] = useState(today);
  const [view, setView] = useState<View_>("day");
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<WorkoutSeed | null>(null);
  const [assign, setAssign] = useState<AssignPrefill | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const gid = group === "all" ? undefined : group;
  const sunday = addDays(monday, 6);
  const groups = useGroups(club?.id);
  const athletes = useAthletes(club?.id, { group_id: gid });
  const planned = usePlanned(club?.id, { from: monday, to: sunday, group_id: gid });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const people = useMemo(() => {
    const needle = norm(q.trim());
    return (athletes.data ?? []).filter((a) => !needle || norm(a.user.name).includes(needle));
  }, [athletes.data, q]);
  const byAthlete = useMemo(() => {
    const m = new Map<string, PlannedWorkout[]>();
    for (const w of [...(planned.data ?? [])].sort(byOrder)) m.set(w.athlete_membership_id, [...(m.get(w.athlete_membership_id) ?? []), w]);
    return m;
  }, [planned.data]);
  const shown = useMemo(() => new Set(people.map((a) => a.membership.id)), [people]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of planned.data ?? []) if (shown.has(w.athlete_membership_id)) m.set(w.date, (m.get(w.date) ?? 0) + 1);
    return m;
  }, [planned.data, shown]);

  if (!club) return null;
  const thisWeek = mondayOf(today);
  const goWeek = (m: string) => { setMonday(m); setDay(m === thisWeek ? today : m); };
  const all = planned.data ?? [];
  const done = all.filter((w) => w.completion?.status === "completed" || w.completion?.status === "partial").length;
  const loading = athletes.isPending || planned.isPending;
  const failed = (athletes.error ?? planned.error) as Error | null;

  const dayRows = people.flatMap((a) => (byAthlete.get(a.membership.id) ?? []).filter((w) => w.date === day).map((w) => ({ w, a })));
  const free = people.filter((a) => !(byAthlete.get(a.membership.id) ?? []).some((w) => w.date === day));
  const weekFree = people.filter((a) => !(byAthlete.get(a.membership.id)?.length));
  const names = (list: AthleteSummary[]) => list.map((a) => a.user.name.split(" ")[0]).join(", ");

  return (
    <Screen refreshing={planned.isRefetching && !planned.isPending} onRefresh={() => { void planned.refetch(); void athletes.refetch(); }}>
      <PageHeader eyebrow={t("Semana de {a} a {b}", { a: dayMonth(monday), b: dayMonth(sunday) })} title={t("Planejamento")}
        subtitle={planned.data ? (all.length ? t("{done} de {total} treinos feitos nesta semana", { done, total: all.length }) : t("Nenhum treino nesta semana ainda")) : " "} />

      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Button icon={Plus} onPress={() => setAssign({ dates: view === "day" ? [day] : [] })} style={styles.flex}>{t("Atribuir treino")}</Button>
        <Button variant="secondary" icon={Copy} disabled={!all.length} onPress={() => setCopyOpen(true)}>{t("Copiar semana")}</Button>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <IconButton variant="secondary" icon={ChevronLeft} label={t("Semana anterior")} onPress={() => goWeek(addDays(monday, -7))} />
          <Button variant="secondary" disabled={monday === thisWeek} onPress={() => goWeek(thisWeek)} style={styles.flex}>{t("Esta semana")}</Button>
          <IconButton variant="secondary" icon={ChevronRight} label={t("Próxima semana")} onPress={() => goWeek(addDays(monday, 7))} />
          <Segmented label={t("Mostrar por")} value={view} onChange={setView} options={[{ value: "day", label: t("Dia") }, { value: "week", label: t("Aluno") }]} />
        </View>
        {(groups.data?.length ?? 0) > 0 && (
          <FilterChips label={t("Filtrar por grupo")} value={group} onChange={setGroup} items={[{ value: "all", label: t("Todos") }, ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} />
        )}
        <View style={styles.search}>
          <Input value={q} onChangeText={setQ} placeholder={t("Buscar aluno")} accessibilityLabel={t("Buscar aluno")} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" style={{ paddingLeft: theme.space[10] }} />
          <View pointerEvents="none" style={[styles.searchIcon, { left: theme.space[3] }]}><Search size={theme.size.iconSm} color={theme.color.fgSubtle} aria-hidden /></View>
        </View>
      </View>

      <WeekRelease club={club} monday={monday} />

      {view === "day" && <DayStrip days={days} value={day} onChange={setDay} today={today} counts={counts} />}

      {loading ? (
        <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[10] }} />)}</Card>
      ) : failed && !planned.data ? (
        <Card>
          <EmptyState icon={CircleAlert} title={failed instanceof ApiError ? failed.title : t("Algo deu errado")}
            action={<Button variant="secondary" onPress={() => { void planned.refetch(); void athletes.refetch(); }}>{t("Tentar de novo")}</Button>}>
            {failed instanceof ApiError ? failed.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : people.length === 0 ? (
        <Card><EmptyState icon={CalendarRange} title={t("Nenhum aluno aqui")}>{q.trim() ? t("Tente outro nome.") : t("Convide alunos ou escolha outro grupo.")}</EmptyState></Card>
      ) : view === "day" ? (
        <Section title={day === today ? t("Hoje, {d}", { d: dayMonth(day) }) : shortDate(day)} flush
          action={<Text variant="bodySm" tone="muted">{dayRows.length ? tn(dayRows.length, "{n} treino", "{n} treinos") : ""}</Text>}>
          {dayRows.length ? (
            <View>{dayRows.map(({ w, a }, i) => <WorkoutRow key={w.id} w={w} athlete={refOf(a)} today={today} divider={i > 0} onPress={() => setSheet({ workout: w, athlete: refOf(a) })} />)}</View>
          ) : <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{t("Nenhum treino neste dia.")}</Text>}
          {free.length > 0 && dayRows.length > 0 && (
            <Text variant="bodySm" tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{`${t("Sem treino neste dia:")} ${names(free)}`}</Text>
          )}
        </Section>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {people.filter((a) => byAthlete.get(a.membership.id)?.length).map((a) => {
            const mine = byAthlete.get(a.membership.id)!;
            const secs = mine.reduce((s, w) => s + (w.est_duration_s ?? 0), 0);
            return (
              <Card key={a.membership.id} style={{ paddingVertical: theme.space[3] }}>
                <View style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingBottom: theme.space[2] }]}>
                  <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[8]} />
                  <View style={styles.flex}>
                    <Text variant="labelMd" accessibilityRole="header" numberOfLines={1}>{a.user.name}</Text>
                    <Text variant="caption" tone="muted">{`${tn(mine.length, "{n} treino", "{n} treinos")}${secs ? ` · ${duration(secs)}` : ""}`}</Text>
                  </View>
                </View>
                {mine.map((w) => <WorkoutRow key={w.id} w={w} showDate today={today} divider onPress={() => setSheet({ workout: w, athlete: refOf(a) })} />)}
              </Card>
            );
          })}
          {weekFree.length > 0 && (
            <Text variant="bodySm" tone="muted">{`${t("Sem treinos nesta semana:")} ${names(weekFree)}`}</Text>
          )}
        </View>
      )}

      <WorkoutSheet seed={sheet} onClose={() => setSheet(null)} />
      <AssignSheet club={club} monday={monday} open={!!assign} onOpenChange={(v) => !v && setAssign(null)} prefill={assign ?? undefined} />
      <CopyWeekSheet club={club} monday={monday} athleteIds={people.map((a) => a.membership.id)} open={copyOpen} onOpenChange={setCopyOpen} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  stretch: { alignSelf: "stretch" },
  start: { alignSelf: "flex-start" },
  day: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

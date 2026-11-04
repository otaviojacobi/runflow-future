/**
 * W3 · Aluno (staff), phone-sized: header (goal, level, groups, consent, Strava; WhatsApp and "Atribuir treino"), the
 * numbers that matter, then tabs: Treinos (next 7 and last 14 days as a list, or the month as a calendar; tap for the
 * workout sheet with its thread), Atividades (weekly volume done vs planned, synced activities; only with consent),
 * Zonas (tables + recalculation from a threshold pace, a race or the max heart rate) and Perfil (goal, level,
 * physiology and the private trainer notes).
 */
import { useLocalSearchParams } from "expo-router";
import { Tabs as RouterTabs } from "expo-router/js-tabs";
import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useAthlete, usePlanned, useSaveAthleteProfile, useSetZones, type ZonesInput } from "@/api/staff";
import type { AthleteDetail, AthleteProfile, Goal, Level, Zone } from "@/api/types";
import { AssignSheet } from "@/components/staff/AssignSheet";
import { brToIso, isoToBr, maskDate } from "@/components/account/inputs";
import { GOAL_LABEL, LEVEL_LABEL, parsePace, parseTime } from "@/components/staff/athlete";
import { ZoneTable } from "@/components/account/parts";
import { ActivityRow } from "@/components/activity";
import { ComplianceBar, Section, WorkoutRow } from "@/components/staff/workout";
import { WorkoutSheet, type WorkoutSeed } from "@/components/staff/WorkoutSheet";
import { MonthGrid, dayList, monthRange, monthStart } from "@/components/workout/MonthGrid";
import { Stat } from "@/components/workout/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, dayMonth, distance, duration, mondayOf, monthTitle, pace, today as todayFn, upperFirst, weekdayLong } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, ButtonLink, Card, EmptyState, Field, IconButton, Input, Screen, Segmented, Select, Skeleton, Tabs, Text, Textarea, toast } from "@/ui";
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, Gauge, Lock, Phone, Plus, ShieldCheck, ShieldOff, Users } from "@/ui/icons";
import { StravaAttribution } from "@/components/strava";

type Tab = "workouts" | "activities" | "zones" | "profile";
const ZONE_SOURCE = { race: "prova", test: "teste", manual: "manual", estimated: "estimativa" } as const;
const GOALS: Goal[] = ["health", "5k", "10k", "21k", "42k", "trail", "triathlon", "swim", "strength", "other"];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];
const RACES = [{ m: 5000, label: "5 km" }, { m: 10000, label: "10 km" }, { m: 21097, label: "21 km" }, { m: 42195, label: "42 km" }] as const;

export default function StudentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { club } = useClub();
  const q = useAthlete(club?.id, id ?? "");
  const a = q.data;
  if (!club || !id) return null;
  return (
    <>
      <RouterTabs.Screen options={{ title: a?.user.name ?? t("Aluno") }} />
      {/* A new student resets the tabs and the forms being edited (the route stays mounted between students). */}
      <Student key={id} id={id} q={q} />
    </>
  );
}

function Student({ id, q }: { id: string; q: ReturnType<typeof useAthlete> }) {
  const { theme } = useTheme();
  const { club } = useClub();
  const [tab, setTab] = useState<Tab>("workouts");
  const [sheet, setSheet] = useState<WorkoutSeed | null>(null);
  const [assign, setAssign] = useState(false);
  const a = q.data;
  if (!club) return null;
  if (q.isPending) {
    return (
      <Screen>
        <View style={[styles.row, { gap: theme.space[4] }]}><Skeleton style={{ width: theme.space[16], height: theme.space[16], borderRadius: theme.radius.full }} /><View style={[styles.flex, { gap: theme.space[2] }]}><Skeleton style={{ height: theme.space[6] }} /><Skeleton style={{ height: theme.space[4], width: "60%" }} /></View></View>
        <Skeleton style={{ height: theme.space[20] * 2 }} />
        <Skeleton style={{ height: theme.space[20] * 3 }} />
      </Screen>
    );
  }
  if (!a) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <Screen>
        <Card>
          <EmptyState icon={notFound ? Users : CircleAlert} title={notFound ? t("Aluno não encontrado") : q.error instanceof ApiError ? q.error.title : t("Algo deu errado")}
            action={notFound ? <ButtonLink href="/students" variant="secondary" icon={ArrowLeft}>{t("Ver alunos")}</ButtonLink> : <Button variant="secondary" loading={q.isFetching} onPress={() => void q.refetch()}>{t("Tentar de novo")}</Button>}>
            {notFound ? t("Ele pode ter saído do clube.") : q.error instanceof ApiError ? q.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      </Screen>
    );
  }
  const last4 = a.weekly.slice(-5, -1);
  const avgWeek = last4.length ? last4.reduce((s, w) => s + w.done_s, 0) / last4.length : 0;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Header a={a} onAssign={() => setAssign(true)} />
      <View style={{ gap: theme.space[3] }}>
        <View style={[styles.row, styles.stretch, { gap: theme.space[3] }]}>
          <Card style={[styles.flex, { padding: theme.space[4], gap: theme.space[2] }]}>
            <Text variant="caption" tone="muted">{a.shares_data ? t("Aderência 28 dias") : t("Aderência: não compartilha os treinos")}</Text>
            {a.shares_data ? <ComplianceBar pct={a.compliance_pct} /> : <Text variant="titleMd">–</Text>}
          </Card>
          <Card style={[styles.flex, { padding: theme.space[4] }]}><Stat value={`${a.week.done}/${a.week.planned}`} label={t("Nesta semana")} /></Card>
        </View>
        <View style={[styles.row, styles.stretch, { gap: theme.space[3] }]}>
          <Card style={[styles.flex, { padding: theme.space[4] }]}><Stat value={duration(avgWeek)} label={t("Média semanal (4 sem.)")} /></Card>
          <Card style={[styles.flex, { padding: theme.space[4] }]}>
            <Stat value={a.profile.threshold_pace_s_per_km ? pace(a.profile.threshold_pace_s_per_km) : "–"} unit={a.profile.threshold_pace_s_per_km ? "/km" : undefined} label={t("Pace de limiar")} />
          </Card>
        </View>
      </View>

      <Tabs<Tab> label={t("Seções do aluno")} value={tab} onValueChange={setTab}
        items={[{ value: "workouts", label: t("Treinos") }, { value: "activities", label: t("Atividades") }, { value: "zones", label: t("Zonas") }, { value: "profile", label: t("Perfil") }]} />
      {tab === "workouts" ? <Workouts clubId={club.id} a={a} tz={club.timezone} onOpen={setSheet} />
        : tab === "activities" ? <Activities a={a} />
        : tab === "zones" ? <Zones clubId={club.id} a={a} />
        : <Profile clubId={club.id} a={a} />}
      <WorkoutSheet seed={sheet} onClose={() => setSheet(null)} />
      <AssignSheet club={club} monday={mondayOf(todayFn(club.timezone))} open={assign} onOpenChange={setAssign} prefill={{ athleteIds: [id] }} />
    </Screen>
  );
}

function Header({ a, onAssign }: { a: AthleteDetail; onAssign: () => void }) {
  const { theme } = useTheme();
  const goal = a.goal === "other" && a.profile.goal_note ? a.profile.goal_note : a.goal ? t(GOAL_LABEL[a.goal]) : null;
  const line = [goal, a.profile.goal_date ? t("prova em {d}", { d: dayMonth(a.profile.goal_date) }) : null, a.level ? t(LEVEL_LABEL[a.level]) : null].filter(Boolean).join(" · ");
  const phone = a.user.phone?.replace(/\D/g, "");
  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={[styles.row, { gap: theme.space[4] }]}>
        <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[16]} />
        <View style={[styles.flex, { gap: theme.space[1] }]}>
          <Text variant="titleLg" accessibilityRole="header">{a.user.name}</Text>
          <Text tone="muted">{line || t("Sem objetivo definido")}</Text>
        </View>
      </View>
      <View style={[styles.row, styles.wrap, { gap: theme.space["1.5"] }]}>
        {a.groups.map((g) => <Badge key={g.id}>{g.name}</Badge>)}
        {a.consents.training_data ? <Badge tone="success" icon={ShieldCheck}>{t("Compartilha dados")}</Badge> : <Badge tone="warning" icon={ShieldOff}>{t("Não compartilha os treinos")}</Badge>}
        {a.strava !== "none" && <Badge tone={a.strava === "shared" ? "info" : "neutral"}>{a.strava === "shared" ? t("Strava compartilhado") : t("Não compartilha o Strava")}</Badge>}
      </View>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Button icon={Plus} onPress={onAssign} style={styles.flex}>{t("Atribuir treino")}</Button>
        {phone ? (
          <Button variant="secondary" icon={Phone} accessibilityRole="link" accessibilityHint={t("Abre o WhatsApp")} onPress={() => void Linking.openURL(`https://wa.me/${phone}`).catch(() => toast.info(t("Não deu para abrir o WhatsApp")))}>
            {t("WhatsApp")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function Workouts({ clubId, a, tz, onOpen }: { clubId: string; a: AthleteDetail; tz: string; onOpen: (s: WorkoutSeed) => void }) {
  const { theme } = useTheme();
  const [view, setView] = useState<"list" | "month">("list");
  return (
    <View style={{ gap: theme.space[4] }}>
      <Segmented label={t("Mostrar")} value={view} onChange={setView} style={styles.stretchSelf}
        options={[{ value: "list", label: t("Lista") }, { value: "month", label: t("Mês") }]} />
      {view === "list" ? <WorkoutList clubId={clubId} a={a} tz={tz} onOpen={onOpen} /> : <Month clubId={clubId} a={a} tz={tz} onOpen={onOpen} />}
    </View>
  );
}

function WorkoutList({ clubId, a, tz, onOpen }: { clubId: string; a: AthleteDetail; tz: string; onOpen: (s: WorkoutSeed) => void }) {
  const { theme } = useTheme();
  const today = todayFn(tz);
  const q = usePlanned(clubId, { from: addDays(today, -14), to: addDays(today, 7), athlete_id: a.membership.id });
  const athlete = { membership_id: a.membership.id, user: a.user };
  const { next, recent } = useMemo(() => {
    const all = q.data ?? [];
    return {
      next: all.filter((w) => w.date >= today).sort((x, y) => x.date.localeCompare(y.date) || x.position - y.position),
      recent: all.filter((w) => w.date < today).sort((x, y) => y.date.localeCompare(x.date) || x.position - y.position),
    };
  }, [q.data, today]);
  if (q.isPending) return <Skeleton style={{ height: theme.space[20] * 2 }} />;
  const list = (title: string, items: typeof next, empty: string) => (
    <Section title={title} flush>
      {items.length ? <View>{items.map((w, i) => <WorkoutRow key={w.id} w={w} showDate today={today} divider={i > 0} onPress={() => onOpen({ workout: w, athlete })} />)}</View>
        : <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{empty}</Text>}
    </Section>
  );
  return (
    <View style={{ gap: theme.space[4] }}>
      {list(t("Próximos 7 dias"), next, t("Nada marcado para os próximos dias."))}
      {list(t("Últimas 2 semanas"), recent, t("Nenhum treino nas últimas 2 semanas."))}
    </View>
  );
}

/** The month as a calendar (the student's Agenda grid); the picked day's workouts below. */
function Month({ clubId, a, tz, onOpen }: { clubId: string; a: AthleteDetail; tz: string; onOpen: (s: WorkoutSeed) => void }) {
  const { theme } = useTheme();
  const today = todayFn(tz);
  const [anchor, setAnchor] = useState(monthStart(today));
  const [picked, setPicked] = useState<string | null>(today);
  const { first, last } = monthRange(anchor);
  const q = usePlanned(clubId, { from: first, to: last, athlete_id: a.membership.id });
  const athlete = { membership_id: a.membership.id, user: a.user };
  const items = q.data ?? [];
  const byDay = (d: string) => items.filter((w) => w.date === d).sort((x, y) => x.position - y.position);
  const move = (dir: 1 | -1) => { setAnchor(monthStart(anchor, dir)); setPicked(null); };
  const sel = picked && picked >= first && picked <= last ? picked : null;
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <IconButton variant="secondary" icon={ChevronLeft} label={t("Mês anterior")} onPress={() => move(-1)} />
        <Text variant="titleSm" accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.flex, styles.centerText]}>{monthTitle(anchor)}</Text>
        <IconButton variant="secondary" icon={ChevronRight} label={t("Próximo mês")} onPress={() => move(1)} />
      </View>
      {q.isPending ? <Skeleton style={{ height: theme.space[20] * 4 }} />
        : <MonthGrid days={dayList(first, last)} month={anchor.slice(0, 7)} today={today} byDay={byDay} selected={sel} onSelect={setPicked} />}
      {sel && q.data && (
        <Section title={sel === today ? t("Hoje") : upperFirst(`${weekdayLong(sel)}, ${dayMonth(sel)}`)} flush>
          {byDay(sel).length ? <View>{byDay(sel).map((w, i) => <WorkoutRow key={w.id} w={w} today={today} divider={i > 0} onPress={() => onOpen({ workout: w, athlete })} />)}</View>
            : <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{t("Nenhum treino neste dia.")}</Text>}
        </Section>
      )}
    </View>
  );
}

/** Weeks in groups of three counted from the newest (the first group may be shorter). */
const groupsOf3 = <T,>(xs: T[]) => { const out: T[][] = []; for (let end = xs.length; end > 0; end -= 3) out.unshift(xs.slice(Math.max(0, end - 3), end)); return out; };

/**
 * Weekly volume, 12 weeks: done (solid, the club's brand text role) against planned (outline). Two series, so a
 * legend; tapping a week reads it below (the phone's tooltip). The week in progress is lighter.
 */
function VolumeChart({ weeks }: { weeks: AthleteDetail["weekly"] }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.done_s, w.planned_s)));
  const plot = theme.space[20] + theme.space[12];
  const reading = (w: AthleteDetail["weekly"][number]) =>
    [t("Semana de {d}", { d: dayMonth(w.week_start) }) + (w.current ? ` (${t("em andamento")})` : ""), t("Feito: {a} · Planejado: {b}", { a: duration(w.done_s), b: duration(w.planned_s) }), w.distance_m > 0 ? `${distance(w.distance_m)}` : null].filter(Boolean).join(" · ");
  const shown = sel ?? weeks.length - 1;
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.row, { gap: theme.space[4] }]} aria-hidden>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}><View style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.xs, backgroundColor: c.brand.text }} /><Text variant="caption" tone="muted">{t("Feito")}</Text></View>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}><View style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.xs, borderWidth: 2, borderColor: c.lineStrong }} /><Text variant="caption" tone="muted">{t("Planejado")}</Text></View>
      </View>
      <View accessibilityRole="list" accessibilityLabel={t("Volume semanal")} style={[styles.row, styles.bottom, { height: plot, gap: theme.space["0.5"] }]}>
        {weeks.map((w, i) => (
          <Pressable key={w.week_start} accessibilityRole="button" accessibilityLabel={reading(w)} accessibilityState={{ selected: sel === i }} onPress={() => setSel(sel === i ? null : i)}
            style={[styles.col, { opacity: sel !== null && sel !== i ? 0.45 : 1 }]}>
            <View style={[styles.bar, { height: `${(w.planned_s / max) * 100}%`, maxWidth: theme.space[6], borderWidth: 2, borderBottomWidth: 0, borderColor: c.lineStrong, borderTopLeftRadius: theme.radius.xs, borderTopRightRadius: theme.radius.xs }]} />
            <View style={{ width: "100%", maxWidth: theme.space[6], height: `${Math.max(1, (w.done_s / max) * 100)}%`, backgroundColor: c.brand.text, opacity: w.current ? 0.6 : 1, borderTopLeftRadius: theme.radius.xs, borderTopRightRadius: theme.radius.xs }} />
          </Pressable>
        ))}
      </View>
      {/* One date per 3 weeks (12 bars are too narrow for each), under the last bar of each group, newest at the right edge. */}
      <View aria-hidden style={[styles.row, { gap: theme.space["0.5"] }]}>
        {groupsOf3(weeks).map((g) => (
          <Text key={g[0]!.week_start} variant="caption" tone="subtle" numberOfLines={1} style={[{ flex: g.length }, styles.right, styles.tabular]}>
            {`${Number(g[g.length - 1]!.week_start.slice(8))}/${g[g.length - 1]!.week_start.slice(5, 7)}`}
          </Text>
        ))}
      </View>
      {weeks[shown] ? <Text variant="bodySm" tone="muted" accessibilityLiveRegion="polite">{reading(weeks[shown]!)}</Text> : null}
    </View>
  );
}

function Activities({ a }: { a: AthleteDetail }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[4] }}>
      {a.weekly.length > 0 && <Section title={t("Volume semanal")}><VolumeChart weeks={a.weekly} /></Section>}
      <Section title={t("Atividades recentes")} flush>
        {!a.consents.training_data ? <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{t("O aluno não compartilha os dados de treino com o clube.")}</Text>
          : a.recent_activities.length ? <View style={{ paddingHorizontal: theme.space[2] }}>{a.recent_activities.map((x) => <ActivityRow key={x.id} a={x} />)}{a.recent_activities.some((x) => x.source === "strava") && <StravaAttribution style={{ paddingTop: theme.space[2] }} />}</View>
          : <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{t("Nenhuma atividade sincronizada.")}</Text>}
      </Section>
    </View>
  );
}

function Zones({ clubId, a }: { clubId: string; a: AthleteDetail }) {
  const { theme } = useTheme();
  const set = useSetZones(clubId, a.membership.id);
  const [thr, setThr] = useState(a.profile.threshold_pace_s_per_km ? pace(a.profile.threshold_pace_s_per_km) : "");
  const [race, setRace] = useState<{ m: number; time: string }>({ m: 10000, time: "" });
  const [maxHr, setMaxHr] = useState(a.profile.max_hr ? String(a.profile.max_hr) : "");
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const err = set.error instanceof ApiError ? set.error : null;
  const source = (z: Zone) => t("Fonte: {s} · desde {d}", { s: t(ZONE_SOURCE[z.source]), d: dayMonth(z.valid_from) });
  const paceZ = a.zones.find((z) => z.kind === "pace");
  const hrZ = a.zones.find((z) => z.kind === "hr");
  const run = (body: ZonesInput) => set.mutate(body, {
    onSuccess: () => { setLocal({}); toast.success(t("Zonas atualizadas"), t("Os treinos do aluno já usam os novos ritmos.")); },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  const fieldErr = (k: string) => local[k] ?? err?.fieldError(k) ?? null;
  return (
    <View style={{ gap: theme.space[4] }}>
      {/* Field tests (Cooper, 3 km, CSS, FTP, FC máx) set zones too, with the history (W14). */}
      <ButtonLink variant="secondary" icon={Gauge} block href={{ pathname: "/assessments", params: { athlete: a.membership.id } }}>{t("Avaliações e testes")}</ButtonLink>
      <Section title={t("Zonas de pace")}>
        <Text variant="bodySm" tone="muted" style={{ marginTop: -theme.space[2] }}>{paceZ ? source(paceZ) : t("Ainda sem zonas.")}</Text>
        {paceZ && <ZoneTable z={paceZ} unit="pace" />}
        <View style={[styles.form, { gap: theme.space[3], paddingTop: theme.space[3], borderTopColor: theme.color.lineSubtle }]}>
          <View style={[styles.row, styles.bottom, { gap: theme.space[2] }]}>
            <Field label={t("Pace de limiar (/km)")} error={fieldErr("threshold_pace_s_per_km")} style={styles.flex}>
              {(f) => <Input {...f} value={thr} onChangeText={setThr} placeholder="4:30" keyboardType="numbers-and-punctuation" />}
            </Field>
            <Button variant="secondary" loading={set.isPending} onPress={() => { const s = parsePace(thr); if (s) run({ kind: "pace", threshold_pace_s_per_km: s }); else setLocal({ threshold_pace_s_per_km: t("Use minutos:segundos, ex.: 4:30.") }); }}>{t("Calcular")}</Button>
          </View>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="labelSm">{t("Ou a partir de uma prova")}</Text>
            <Segmented label={t("Distância da prova")} value={String(race.m)} onChange={(v) => setRace({ ...race, m: Number(v) })} style={styles.stretchSelf}
              options={RACES.map((r) => ({ value: String(r.m), label: r.label }))} />
            <View style={[styles.row, styles.bottom, { gap: theme.space[2] }]}>
              <Field label={t("Tempo da prova")} error={local.race ?? null} style={styles.flex}>
                {(f) => <Input {...f} value={race.time} onChangeText={(v) => setRace({ ...race, time: v })} placeholder="52:30" keyboardType="numbers-and-punctuation" />}
              </Field>
              <Button variant="secondary" loading={set.isPending} onPress={() => { const s = parseTime(race.time); if (s) run({ kind: "pace", race: { distance_m: race.m, time_s: s } }); else setLocal({ race: t("Use h:mm:ss ou mm:ss, ex.: 52:30.") }); }}>{t("Calcular")}</Button>
            </View>
          </View>
        </View>
      </Section>
      <Section title={t("Zonas de frequência cardíaca")}>
        <Text variant="bodySm" tone="muted" style={{ marginTop: -theme.space[2] }}>{hrZ ? t("Pela FC máxima de {n} bpm", { n: hrZ.bounds[hrZ.bounds.length - 1]?.max ?? "–" }) : t("Ainda sem zonas.")}</Text>
        {hrZ && <ZoneTable z={hrZ} unit="hr" />}
        <View style={[styles.form, styles.row, styles.bottom, { gap: theme.space[2], paddingTop: theme.space[3], borderTopColor: theme.color.lineSubtle }]}>
          <Field label={t("FC máxima (bpm)")} error={fieldErr("max_hr")} style={styles.flex}>
            {(f) => <Input {...f} value={maxHr} onChangeText={setMaxHr} keyboardType="number-pad" maxLength={3} />}
          </Field>
          <Button variant="secondary" loading={set.isPending} onPress={() => { const n = Number(maxHr); if (n > 0) run({ kind: "hr", max_hr: n }); else setLocal({ max_hr: t("Informe a FC máxima em bpm.") }); }}>{t("Calcular")}</Button>
        </View>
      </Section>
    </View>
  );
}

const num = (s: string) => (s.trim() ? Number(s.replace(/\D/g, "")) : null);

function Profile({ clubId, a }: { clubId: string; a: AthleteDetail }) {
  const { theme } = useTheme();
  const save = useSaveAthleteProfile(clubId, a.membership.id);
  const p = a.profile;
  const [goal, setGoal] = useState<Goal | "">(p.goal ?? "");
  const [goalNote, setGoalNote] = useState(p.goal_note ?? "");
  const [goalDate, setGoalDate] = useState(isoToBr(p.goal_date));
  const [level, setLevel] = useState<Level | "">(p.level ?? "");
  const [sessions, setSessions] = useState(p.weekly_sessions != null ? String(p.weekly_sessions) : "");
  const [restHr, setRestHr] = useState(p.resting_hr ? String(p.resting_hr) : "");
  const [maxHr, setMaxHr] = useState(p.max_hr ? String(p.max_hr) : "");
  const [notes, setNotes] = useState(p.trainer_notes ?? "");
  const [dateErr, setDateErr] = useState<string | null>(null);
  const err = save.error instanceof ApiError ? save.error : null;
  const submit = () => {
    const goal_date = goalDate.trim() ? brToIso(goalDate) : null;
    if (goalDate.trim() && !goal_date) return setDateErr(t("Use o formato dd/mm/aaaa, como 15/03/2027."));
    setDateErr(null);
    const body: Partial<AthleteProfile> = {
      goal: goal || null, goal_note: goal === "other" ? goalNote.trim() || null : null, goal_date, level: level || null,
      weekly_sessions: num(sessions), resting_hr: num(restHr), max_hr: num(maxHr), trainer_notes: notes.trim() || null,
    };
    save.mutate(body, { onSuccess: () => toast.success(t("Perfil salvo")), onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } });
  };
  const facts = [
    { label: t("Prova recente"), value: p.recent_race ? `${distance(p.recent_race.distance_m)} · ${duration(p.recent_race.time_s)}${p.recent_race.date ? ` · ${dayMonth(p.recent_race.date)}` : ""}` : null },
    { label: t("CSS (natação)"), value: p.css_s_per_100m ? `${pace(p.css_s_per_100m)} /100 m` : null },
    { label: t("FTP"), value: p.ftp_w ? `${p.ftp_w} W` : null },
  ].filter((f) => f.value);
  return (
    <View style={{ gap: theme.space[4] }}>
      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="titleMd" accessibilityRole="header">{t("Objetivo e nível")}</Text>
        <Field label={t("Objetivo")} error={err?.fieldError("goal")}>
          {(f) => <Select<Goal> {...f} value={goal || null} onChange={setGoal} placeholder={t("Sem objetivo")} options={GOALS.map((g) => ({ value: g, label: t(GOAL_LABEL[g]) }))} />}
        </Field>
        {goal === "other" && (
          <Field label={t("Qual objetivo?")} error={err?.fieldError("goal_note")}>
            {(f) => <Input {...f} value={goalNote} onChangeText={setGoalNote} placeholder={t("Ex.: correr com a filha")} maxLength={120} />}
          </Field>
        )}
        <Field label={t("Data da prova-alvo")} optional hint={t("dd/mm/aaaa")} error={dateErr ?? err?.fieldError("goal_date")}>
          {(f) => <Input {...f} value={goalDate} onChangeText={(x) => setGoalDate(maskDate(x))} placeholder="15/03/2027" keyboardType="number-pad" maxLength={10} />}
        </Field>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Nível")}</Text>
          <Segmented<Level | ""> label={t("Nível")} value={level} onChange={setLevel} style={styles.stretchSelf}
            options={LEVELS.map((l) => ({ value: l, label: t(LEVEL_LABEL[l]) }))} />
        </View>
        <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
          <Field label={t("Treinos/semana")} error={err?.fieldError("weekly_sessions")} style={styles.flex}>
            {(f) => <Input {...f} value={sessions} onChangeText={setSessions} keyboardType="number-pad" maxLength={2} />}
          </Field>
          <Field label={t("FC repouso")} error={err?.fieldError("resting_hr")} style={styles.flex}>
            {(f) => <Input {...f} value={restHr} onChangeText={setRestHr} keyboardType="number-pad" maxLength={3} />}
          </Field>
          <Field label={t("FC máxima")} error={err?.fieldError("max_hr")} style={styles.flex}>
            {(f) => <Input {...f} value={maxHr} onChangeText={setMaxHr} keyboardType="number-pad" maxLength={3} />}
          </Field>
        </View>
      </Card>
      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <Text variant="titleMd" accessibilityRole="header">{t("Notas do treinador")}</Text>
          <Lock size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
        </View>
        <Field label={t("Notas privadas")} hint={t("Só a equipe do clube vê. O aluno não tem acesso.")}>
          {(f) => <Textarea {...f} value={notes} onChangeText={setNotes} placeholder={t("Ex.: lesão no joelho em 2025, prefere treinar cedo")} maxLength={4000} />}
        </Field>
      </Card>
      <Button size="lg" loading={save.isPending} onPress={submit}>{t("Salvar perfil")}</Button>
      {facts.length > 0 && (
        <Section title={t("Dos testes e provas")}>
          <View>
            {facts.map((f, i) => (
              <View key={f.label} style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space[2], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }]}>
                <Text variant="bodySm" tone="muted" style={styles.flex}>{f.label}</Text>
                <Text variant="labelMd" style={[styles.tabular, { fontWeight: weight("semibold") }]}>{f.value}</Text>
              </View>
            ))}
          </View>
          <Text variant="caption" tone="muted">{tn(facts.length, "Atualizado pelas avaliações.", "Atualizados pelas avaliações.")}</Text>
        </Section>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  bottom: { alignItems: "flex-end" },
  stretch: { alignItems: "stretch" },
  stretchSelf: { alignSelf: "stretch" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  col: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  bar: { position: "absolute", bottom: 0, width: "100%" },
  form: { borderTopWidth: StyleSheet.hairlineWidth },
  centerText: { textAlign: "center" },
  right: { textAlign: "right" },
  tabular: { fontVariant: ["tabular-nums"] },
});

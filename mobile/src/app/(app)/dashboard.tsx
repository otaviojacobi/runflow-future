/**
 * W1 · Painel (staff home), phone-sized: today's board (who trained, who didn't yet, who missed), alerts, feedback
 * waiting for a reply (answered right here in the workout's thread), the 8-week compliance trend, plan usage and the
 * first steps while they're open. Desktop tools (builder, Club Studio) open the web app.
 */
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDashboard } from "@/api/staff";
import type { AthleteRef, Dashboard, PlannedWorkout } from "@/api/types";
import { ComplianceTrend } from "@/components/staff/ComplianceTrend";
import { Count, Section, WorkoutRow } from "@/components/staff/workout";
import { WorkoutSheet, type WorkoutSeed } from "@/components/staff/WorkoutSheet";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { useOpenLink } from "@/lib/links";
import { ago, duration, km, longDate, shortDate, today as todayFn } from "@/lib/format";
import { hasWeb } from "@/lib/web";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, EmptyState, PageHeader, ProgressBar, Screen, Skeleton, Text, type Icon } from "@/ui";
import { Activity, ArrowRight, Cake, Check, Circle, CircleAlert, CircleCheck, ExternalLink, TriangleAlert, UserCog, UserPlus, Users, X } from "@/ui/icons";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };
const ALERT_ICON: Record<Dashboard["alerts"][number]["kind"], Icon> = { missed_streak: X, high_rpe: TriangleAlert, no_sync: Activity, birthday: Cake, new_member: UserPlus, plan_limit: Users };
const PLAN_NAME = { free: "Free", pro: "Pro", max: "Max" } as const;
/** Rows shown per group on the board before "see all" (Planejamento has the full day). */
const BOARD_ROWS = 5;

function Kpi({ label, value, sub, onPress }: { label: string; value: string; sub: string; onPress?: () => void }) {
  const { theme } = useTheme();
  return (
    <Card onPress={onPress} accessibilityRole={onPress ? "link" : undefined} accessibilityLabel={`${label}: ${value}, ${sub}`} style={[styles.kpi, { padding: theme.space[4], gap: theme.space["0.5"] }]}>
      <Text variant="bodySm" tone="muted" numberOfLines={1}>{label}</Text>
      <Text variant="metricLg" numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text>
    </Card>
  );
}

function SeeAll({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return <Button variant="ghost" size="sm" iconRight={ArrowRight} accessibilityRole="link" onPress={onPress} style={{ marginRight: -theme.space[2] }}>{label}</Button>;
}

type Item = { workout: PlannedWorkout; athlete: AthleteRef };
function TodayBoard({ items, date, onOpen }: { items: Item[]; date: string; onOpen: (i: Item) => void }) {
  const { theme } = useTheme();
  if (!items.length) return <Text tone="muted">{t("Nenhum treino marcado para hoje.")}</Text>;
  const done = items.filter((i) => i.workout.completion?.status === "completed" || i.workout.completion?.status === "partial");
  const missed = items.filter((i) => i.workout.completion?.status === "missed" || i.workout.completion?.status === "skipped");
  const next = items.filter((i) => !i.workout.completion);
  const groups = [
    { key: "done", title: t("Treinaram"), rows: done },
    { key: "next", title: t("Ainda não treinaram"), rows: next },
    { key: "missed", title: t("Não fizeram"), rows: missed },
  ].filter((g) => g.rows.length);
  return (
    <View style={{ gap: theme.space[3] }}>
      {groups.map((g) => (
        <View key={g.key} style={{ gap: theme.space[1] }}>
          <Text variant="overline" tone="subtle" accessibilityRole="header" style={{ paddingHorizontal: theme.space[4] }}>{`${g.title} · ${g.rows.length}`}</Text>
          <View>
            {g.rows.slice(0, BOARD_ROWS).map((i, n) => <WorkoutRow key={i.workout.id} w={i.workout} athlete={i.athlete} today={date} divider={n > 0} onPress={() => onOpen(i)} />)}
          </View>
          {g.rows.length > BOARD_ROWS && (
            <Button variant="ghost" size="sm" accessibilityRole="link" onPress={() => router.push("/planning")} style={[styles.start, { marginLeft: theme.space[2] }]}>
              {tn(g.rows.length - BOARD_ROWS, "Ver mais {n} no planejamento", "Ver mais {n} no planejamento")}
            </Button>
          )}
        </View>
      ))}
    </View>
  );
}

function Alerts({ alerts }: { alerts: Dashboard["alerts"] }) {
  const { theme } = useTheme();
  const openLink = useOpenLink();
  const c = theme.color;
  if (!alerts.length) {
    return (
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Check size={theme.size.iconMd} color={c.success.text} aria-hidden />
        <Text tone="muted">{t("Tudo em dia por aqui.")}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space[1] }}>
      {alerts.map((al, i) => {
        const I = ALERT_ICON[al.kind] ?? CircleAlert;
        const tone = c[al.severity];
        return (
          <Pressable key={i} accessibilityRole="link" onPress={() => openLink(al.link)}
            style={({ pressed }) => [styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin, padding: theme.space[1], marginHorizontal: -theme.space[1], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
            <View style={[styles.center, { width: theme.space[8], height: theme.space[8], borderRadius: theme.radius.full, backgroundColor: tone.subtle }]}>
              <I size={theme.size.iconSm} color={tone.subtleFg} aria-hidden />
            </View>
            <Text variant="bodySm" style={styles.flex}>{al.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FeedbackList({ items, onOpen }: { items: Dashboard["feedback"]; onOpen: (i: Item) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  if (!items.length) return <Text tone="muted" style={{ paddingHorizontal: theme.space[4] }}>{t("Nenhum feedback novo.")}</Text>;
  return (
    <View>
      {items.slice(0, 4).map((f, n) => {
        const text = f.last_comment?.body ?? f.workout.completion?.comment ?? f.workout.title;
        const when = f.last_comment ? ago(f.last_comment.created_at) : shortDate(f.workout.date);
        return (
          <Pressable key={f.workout.id} accessibilityRole="button" accessibilityHint={t("Abre a conversa")}
            accessibilityLabel={[f.athlete.user.name, f.workout.title, when, f.workout.unread_count ? tn(f.workout.unread_count, "{n} mensagem nova", "{n} mensagens novas") : null, text].filter(Boolean).join(", ")}
            onPress={() => onOpen({ workout: f.workout, athlete: f.athlete })}
            style={({ pressed }) => [styles.row, styles.top, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: pressed ? c.soft : "transparent", borderTopWidth: n ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
            <Avatar name={f.athlete.user.name} src={f.athlete.user.avatar_url} size={theme.space[8] + theme.space[1]} />
            <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
              <View style={[styles.row, { gap: theme.space[2] }]}>
                <Text variant="labelMd" numberOfLines={1} style={styles.shrink}>{f.athlete.user.name}</Text>
                {f.workout.unread_count > 0 && <Count n={f.workout.unread_count} />}
                <Text variant="caption" tone="muted" style={styles.pushRight}>{when}</Text>
              </View>
              <Text variant="caption" tone="muted" numberOfLines={1}>{f.workout.title}</Text>
              <Text variant="bodySm" numberOfLines={2} tone={f.workout.unread_count ? "default" : "muted"}>{text}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Onboarding({ o, owner }: { o: Dashboard["onboarding"]; owner: boolean }) {
  const { theme } = useTheme();
  const openLink = useOpenLink();
  const c = theme.color;
  const items = [
    { ok: o.colors || o.logo, label: t("Personalize o clube com logo e cores"), to: "/club/studio", owner: true },
    { ok: o.students, label: t("Convide os primeiros alunos"), to: "/club/members", owner: true },
    { ok: o.workouts, label: t("Monte a semana no planejamento"), to: "/planning" },
    { ok: o.groups, label: t("Organize os alunos em grupos"), to: "/students" },
    { ok: o.strava, label: t("Peça aos alunos para conectar o Strava"), to: "/students" },
  ].filter((i) => owner || !i.owner);
  const done = items.filter((i) => i.ok).length;
  if (done === items.length) return null;
  return (
    <Card edge="brand" style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Text variant="titleMd" accessibilityRole="header" style={styles.flex}>{t("Primeiros passos")}</Text>
        <Text variant="bodySm" tone="muted">{`${done}/${items.length}`}</Text>
      </View>
      <ProgressBar value={done} max={items.length} label={t("Primeiros passos")} />
      <View>
        {items.map((i) => (
          <Pressable key={i.label} accessibilityRole="link" accessibilityState={{ checked: i.ok }} onPress={() => openLink(i.to)}
            style={({ pressed }) => [styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin, paddingHorizontal: theme.space[1], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
            {i.ok ? <CircleCheck size={theme.size.iconMd} color={c.success.text} aria-hidden /> : <Circle size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />}
            <Text variant="bodySm" tone={i.ok ? "muted" : "default"} style={[styles.flex, i.ok && styles.strike]}>{i.label}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

/** One seat meter (the web's O4 Seats): a hard limit (Free, Pro) or seats included with paid extras (Max). */
function Seats({ label, icon: I, used, limit, included, one, other }: { label: string; icon: Icon; used: number; limit: number | null; included: number; one: string; other: string }) {
  const { theme } = useTheme();
  const cap = limit ?? included;
  const pct = used / Math.max(1, cap);
  const tone = limit === null ? "brand" : pct >= 1 ? "danger" : pct >= 0.8 ? "warning" : "brand";
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={[styles.row, styles.baseline, { gap: theme.space[2] }]}>
        <I size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
        <Text variant="labelMd" style={styles.flex}>{label}</Text>
        <Text variant="titleMd" style={styles.tabular}>{`${used}`}<Text variant="bodySm" tone="muted">{`/${cap}`}</Text></Text>
      </View>
      <ProgressBar value={Math.min(used, cap)} max={Math.max(1, cap)} tone={tone} label={label} />
      <Text variant="bodySm" tone={limit !== null && pct >= 1 ? "danger" : "muted"}>
        {limit === null ? t("{n} incluídas no plano; as próximas são cobradas por pessoa.", { n: included })
          : pct >= 1 ? t("Limite atingido. Ninguém novo entra até liberar uma vaga ou mudar de plano; quem já está continua normalmente.")
          : tn(limit - used, one, other)}
      </Text>
    </View>
  );
}

/** The plan and its seats (D-043). Owners get a way to Plano e cobrança (on the web until X15). */
function PlanUsage({ s, owner }: { s: Dashboard["subscription"]; owner: boolean }) {
  const { theme } = useTheme();
  const openLink = useOpenLink();
  return (
    <Section title={t("Plano {plan}", { plan: PLAN_NAME[s.plan] })}
      action={owner && hasWeb ? <Button variant="ghost" size="sm" iconRight={ExternalLink} accessibilityRole="link" accessibilityLabel={t("Ver plano, abre na web")} onPress={() => openLink("/club/billing")}>{t("Ver plano")}</Button> : undefined}>
      <View style={{ gap: theme.space[4] }}>
        <Seats label={t("Alunos ativos")} icon={Users} used={s.active_students} limit={s.student_limit} included={s.included_students}
          one="Ainda cabe {n} aluno neste plano." other="Ainda cabem {n} alunos neste plano." />
        {owner && (
          <Seats label={t("Treinadores")} icon={UserCog} used={s.active_trainers} limit={s.trainer_limit} included={s.included_trainers}
            one="Ainda cabe {n} treinador neste plano." other="Ainda cabem {n} treinadores neste plano." />
        )}
      </View>
    </Section>
  );
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const { me, club, role } = useClub();
  const d = useDashboard(club?.id);
  const [sheet, setSheet] = useState<WorkoutSeed | null>(null);
  if (!club || !me) return null;
  const x = d.data;
  const date = x?.date ?? todayFn(club.timezone);
  const first = me.user.name.split(" ")[0] ?? "";
  const owner = role === "owner";
  return (
    <Screen refreshing={d.isRefetching && !d.isPending} onRefresh={() => void d.refetch()}>
      <PageHeader eyebrow={longDate(date)} title={first ? `${t(greet())}, ${first}` : t("Painel")} />
      {!x ? (
        d.error ? (
          <Card>
            <EmptyState icon={CircleAlert} title={d.error instanceof ApiError ? d.error.title : t("Algo deu errado")}
              action={<Button variant="secondary" loading={d.isFetching} onPress={() => void d.refetch()}>{t("Tentar de novo")}</Button>}>
              {d.error instanceof ApiError ? d.error.detail : t("Tente novamente em instantes.")}
            </EmptyState>
          </Card>
        ) : (
          <View style={{ gap: theme.space[3] }} accessibilityLabel={t("Carregando…")}>
            <View style={[styles.row, { gap: theme.space[3] }]}><Skeleton style={[styles.flex, { height: theme.space[20] + theme.space[4] }]} /><Skeleton style={[styles.flex, { height: theme.space[20] + theme.space[4] }]} /></View>
            <View style={[styles.row, { gap: theme.space[3] }]}><Skeleton style={[styles.flex, { height: theme.space[20] + theme.space[4] }]} /><Skeleton style={[styles.flex, { height: theme.space[20] + theme.space[4] }]} /></View>
            <Skeleton style={{ height: theme.space[20] * 3 }} />
          </View>
        )
      ) : (
        <>
          <Onboarding o={x.onboarding} owner={owner} />
          <View style={{ gap: theme.space[3] }}>
            <View style={[styles.row, styles.stretch, { gap: theme.space[3] }]}>
              <Kpi label={t("Treinos hoje")} value={`${x.today.done}/${x.today.planned}`} sub={x.today.planned ? t("feitos até agora") : t("nenhum treino hoje")} onPress={() => router.push("/planning")} />
              <Kpi label={t("Aderência da semana")} value={x.week.compliance_pct != null ? `${x.week.compliance_pct}%` : "–"} sub={t("{done} de {planned} treinos", { done: x.week.done, planned: x.week.planned })} />
            </View>
            <View style={[styles.row, styles.stretch, { gap: theme.space[3] }]}>
              <Kpi label={t("Feedbacks para ver")} value={String(x.feedback.length)} sub={t("últimos 7 dias")} onPress={() => router.push("/feedback")} />
              <Kpi label={t("Alunos ativos")} value={String(x.students)} sub={x.subscription.student_limit === null ? t("{n} incluídos no plano", { n: x.subscription.included_students }) : t("de {n} no plano", { n: x.subscription.student_limit })} onPress={() => router.push("/students")} />
            </View>
          </View>

          <Section title={t("Hoje")} flush action={<SeeAll label={t("Ver semana")} onPress={() => router.push("/planning")} />}>
            <View style={x.today.items.length ? undefined : { paddingHorizontal: theme.space[4] }}>
              <TodayBoard items={x.today.items} date={x.date} onOpen={(i) => setSheet({ workout: i.workout, athlete: i.athlete })} />
            </View>
          </Section>

          <Section title={t("Atenção")}><Alerts alerts={x.alerts} /></Section>

          <Section title={t("Feedbacks")} flush action={<SeeAll label={t("Abrir caixa")} onPress={() => router.push("/feedback")} />}>
            <FeedbackList items={x.feedback} onOpen={(i) => setSheet({ ...i, mode: "thread" })} />
          </Section>

          <Section title={t("Aderência por semana")}>
            <Text variant="bodySm" tone="muted" style={{ marginTop: -theme.space[2] }}>{t("Últimas 8 semanas · todos os alunos")}</Text>
            <ComplianceTrend data={x.compliance_trend} />
            <View style={[styles.row, styles.wrap, { gap: theme.space[1], paddingTop: theme.space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.lineSubtle }]}>
              <Text variant="bodySm" tone="muted">{t("Esta semana:")}</Text>
              <Text variant="bodySm" style={[styles.tabular, { fontWeight: weight("bold") }]}>{duration(x.week.duration_s)}</Text>
              <Text variant="bodySm" tone="muted">{t("planejadas")}</Text>
              {x.week.distance_m ? <><Text variant="bodySm" tone="muted">·</Text><Text variant="bodySm" style={[styles.tabular, { fontWeight: weight("bold") }]}>{`${km(x.week.distance_m)} km`}</Text></> : null}
            </View>
          </Section>

          <PlanUsage s={x.subscription} owner={owner} />
        </>
      )}
      <WorkoutSheet seed={sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  baseline: { alignItems: "baseline" },
  stretch: { alignItems: "stretch" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  kpi: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  start: { alignSelf: "flex-start" },
  pushRight: { marginLeft: "auto" },
  strike: { textDecorationLine: "line-through" },
  tabular: { fontVariant: ["tabular-nums"] },
});

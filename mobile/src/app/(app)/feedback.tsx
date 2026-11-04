/**
 * W8 · Feedbacks (staff), phone-sized: the inbox of completions and comments from the last 30 days with its filters
 * (to reply, unread, warning signs, all). Tapping opens the workout's thread in a sheet (opening marks it as read):
 * quick replies or a message. A long press offers "mark as read" and the student; the header marks everything read.
 * `?workout=<id>` (a `feedback` notification, the dashboard) opens that workout's conversation right away.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFeedback, useMarkRead } from "@/api/staff";
import type { FeedbackFilter, FeedbackItem } from "@/api/types";
import { FilterChips } from "@/components/staff/workout";
import { feelingLabel } from "@/components/workout/workout";
import { WorkoutSheet, type WorkoutSeed } from "@/components/staff/WorkoutSheet";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { ago, shortDate } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, Dialog, EmptyState, ListItem, PageHeader, Screen, Skeleton, Text, toast } from "@/ui";
import { CheckCheck, CircleAlert, Inbox, MessageSquare, TriangleAlert, User } from "@/ui/icons";

const FILTERS: { value: FeedbackFilter; label: string }[] = [
  { value: "needs_reply", label: "Para responder" }, { value: "unread", label: "Não lidos" }, { value: "flagged", label: "Sinais de alerta" }, { value: "all", label: "Todos" },
];
const EMPTY: Record<FeedbackFilter, string> = {
  needs_reply: "Ninguém esperando resposta. Bom trabalho!", unread: "Nenhuma mensagem nova.", flagged: "Nenhum sinal de alerta: ninguém relatou esforço alto ou que se sentiu mal.", all: "Nenhum feedback nos últimos 30 dias.",
};

function Row({ i, divider, onOpen, onMore }: { i: FeedbackItem; divider: boolean; onOpen: () => void; onMore: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const w = i.workout;
  const unread = w.unread_count > 0;
  const when = i.last_comment ? ago(i.last_comment.created_at) : shortDate(w.date);
  const meta = [w.title, w.completion?.feeling ? feelingLabel(w.completion.feeling) : null, w.completion?.rpe ? t("PSE {n}", { n: w.completion.rpe }) : null].filter(Boolean).join(" · ");
  const text = i.last_comment?.body ?? w.completion?.comment ?? t("Sem comentário");
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} onLongPress={onMore} delayLongPress={350}
      accessibilityLabel={[i.athlete.user.name, i.flagged ? t("sinal de alerta") : null, when, meta, unread ? t("não lido") : null, text].filter(Boolean).join(", ")}
      accessibilityHint={t("Abre a conversa")}
      accessibilityActions={[{ name: "activate" }, { name: "longpress", label: t("Mais opções") }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "longpress" ? onMore() : onOpen())}
      style={({ pressed }) => [styles.row, styles.top, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: pressed ? c.soft : "transparent", borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
      <Avatar name={i.athlete.user.name} src={i.athlete.user.avatar_url} size={theme.space[10]} />
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <Text variant="labelMd" numberOfLines={1} style={styles.shrink}>{i.athlete.user.name}</Text>
          {i.flagged && <TriangleAlert size={theme.size.iconSm - 2} color={c.warning.text} aria-hidden />}
          <Text variant="caption" tone="muted" style={styles.pushRight}>{when}</Text>
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1}>{meta}</Text>
        <View style={[styles.row, { gap: theme.space["1.5"] }]}>
          <MessageSquare size={theme.size.iconSm - 2} color={c.fgSubtle} aria-hidden />
          <Text variant="bodySm" numberOfLines={2} tone={unread ? "default" : "muted"} style={[styles.flex, unread && styles.bold]}>{text}</Text>
          {unread && <View aria-hidden style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.full, backgroundColor: c.brand.solid }} />}
        </View>
      </View>
    </Pressable>
  );
}

export default function FeedbackScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  // A link to one conversation shows "Todos" (it's there even if already answered) and opens it once.
  const { workout: target } = useLocalSearchParams<{ workout?: string }>();
  const [filter, setFilter] = useState<FeedbackFilter>(target ? "all" : "needs_reply");
  const [sheet, setSheet] = useState<WorkoutSeed | null>(null);
  const [more, setMore] = useState<FeedbackItem | null>(null);
  const q = useFeedback(club?.id, filter);
  const read = useMarkRead(club?.id ?? "");
  const opened = useRef<string | null>(null);
  useEffect(() => { if (target) setFilter("all"); }, [target]);
  useEffect(() => {
    if (!target || opened.current === target || filter !== "all") return;
    const i = q.data?.items.find((x) => x.workout.id === target);
    if (!i) return;
    opened.current = target;
    setSheet({ workout: i.workout, athlete: i.athlete, mode: "thread" });
    router.setParams({ workout: undefined });
  }, [target, filter, q.data]);
  if (!club) return null;
  const items = q.data?.items ?? [];
  const counts = q.data?.counts;
  const open = (i: FeedbackItem) => setSheet({ workout: i.workout, athlete: i.athlete, mode: "thread" });
  return (
    <Screen refreshing={q.isRefetching && !q.isPending} onRefresh={() => void q.refetch()}>
      <PageHeader title={t("Feedbacks")} subtitle={t("Como os alunos estão se sentindo nos últimos 30 dias.")}
        actions={<Button variant="secondary" size="sm" icon={CheckCheck} loading={read.isPending} disabled={!counts?.unread}
          onPress={() => read.mutate(undefined, { onSuccess: () => toast.success(t("Tudo marcado como lido")), onError: toast.error })}>{t("Marcar tudo como lido")}</Button>} />
      <FilterChips label={t("Filtro")} value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ value: f.value, label: t(f.label), count: counts?.[f.value] }))} />

      {q.isPending ? (
        <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[12] }} />)}</Card>
      ) : q.error && !q.data ? (
        <Card>
          <EmptyState icon={CircleAlert} title={q.error instanceof ApiError ? q.error.title : t("Algo deu errado")}
            action={<Button variant="secondary" loading={q.isFetching} onPress={() => void q.refetch()}>{t("Tentar de novo")}</Button>}>
            {q.error instanceof ApiError ? q.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={Inbox} title={t("Caixa em dia")}>{t(EMPTY[filter])}</EmptyState></Card>
      ) : (
        <>
          <Card style={[styles.clip, q.isPlaceholderData && styles.dim]}>
            {items.map((i, n) => <Row key={i.workout.id} i={i} divider={n > 0} onOpen={() => open(i)} onMore={() => setMore(i)} />)}
          </Card>
          <Text variant="caption" tone="muted" style={styles.centerText}>{t("Toque e segure para mais opções.")}</Text>
        </>
      )}

      <Dialog open={!!more} onOpenChange={(v) => !v && setMore(null)} title={more?.athlete.user.name ?? ""} description={more ? `${more.workout.title} · ${shortDate(more.workout.date)}` : null}>
        {more && (
          <View accessibilityRole="menu">
            <ListItem title={t("Abrir conversa")} icon={MessageSquare} accessibilityRole="menuitem" onPress={() => { const i = more; setMore(null); open(i); }} />
            {more.workout.unread_count > 0 && (
              <ListItem title={t("Marcar como lido")} icon={CheckCheck} accessibilityRole="menuitem"
                onPress={() => { const id = more.workout.id; setMore(null); read.mutate([id], { onSuccess: () => toast.success(t("Marcado como lido")), onError: toast.error }); }} />
            )}
            <ListItem title={t("Ver aluno")} icon={User} accessibilityRole="menuitem" onPress={() => { const id = more.athlete.membership_id; setMore(null); router.push(`/students/${id}`); }} />
          </View>
        )}
      </Dialog>
      <WorkoutSheet seed={sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  pushRight: { marginLeft: "auto" },
  bold: { fontWeight: weight("semibold") },
  clip: { overflow: "hidden" },
  dim: { opacity: 0.6 },
  centerText: { textAlign: "center" },
});

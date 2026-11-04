/**
 * W2 · Alunos (staff), phone-sized: search, group filter, sort (name or lowest compliance), and per student the
 * 28-day compliance, this week's progress, the last activity and Strava. Tapping opens the student (W3); "Grupos"
 * manages the groups (name and members). Invites are the owner's Membros (X15; the web until then).
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAthletes, useGroups } from "@/api/staff";
import type { AthleteSummary } from "@/api/types";
import { GOAL_LABEL, LEVEL_LABEL } from "@/components/staff/athlete";
import { GroupsSheet } from "@/components/staff/GroupsSheet";
import { ComplianceBar, FilterChips } from "@/components/staff/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { hasWeb, openOnWeb } from "@/lib/web";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, EmptyState, Input, PageHeader, Screen, Segmented, Skeleton, Text } from "@/ui";
import { Activity, CircleAlert, ExternalLink, Lock, Search, Users } from "@/ui/icons";

function Row({ a, divider }: { a: AthleteSummary; divider: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const week = a.week.planned ? t("{done}/{planned} na semana", { done: a.week.done, planned: a.week.planned }) : t("Sem treinos na semana");
  const last = a.last_activity_at ? ago(a.last_activity_at) : t("sem atividade");
  const goal = [a.goal ? t(GOAL_LABEL[a.goal]) : null, a.level ? t(LEVEL_LABEL[a.level]) : null].filter(Boolean).join(" · ");
  // What the club sees (D-011): sharing off reads as such, like the web's list.
  const sharing = !a.shares_data ? t("Não compartilha os treinos") : a.strava === "private" ? t("Não compartilha o Strava") : a.strava === "shared" ? t("Strava") : null;
  const compliance = a.shares_data && a.compliance_pct != null ? t("aderência {p}%", { p: a.compliance_pct }) : null;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/students/${a.membership.id}`)}
      accessibilityLabel={[a.user.name, goal, week, t("última atividade {when}", { when: last }), compliance, sharing].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], minHeight: theme.size.touchMin + theme.space[4], backgroundColor: pressed ? c.soft : "transparent", borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
      <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[10]} />
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="labelMd" numberOfLines={1}>{a.user.name}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{`${week} · ${last}`}</Text>
        {goal ? <Text variant="caption" tone="subtle" numberOfLines={1}>{goal}</Text> : null}
        {sharing ? (
          <View style={[styles.row, { gap: theme.space[1] }]}>
            {a.shares_data && a.strava === "shared"
              ? <Activity size={theme.size.iconSm - 4} color={c.success.text} aria-hidden />
              : <Lock size={theme.size.iconSm - 4} color={c.fgMuted} aria-hidden />}
            <Text variant="caption" numberOfLines={1} style={[styles.shrink, { color: a.shares_data && a.strava === "shared" ? c.success.text : c.fgMuted, fontWeight: weight("semibold") }]}>{sharing}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ width: theme.space[16] }}>
        {a.shares_data ? <ComplianceBar pct={a.compliance_pct} /> : <Text variant="caption" tone="subtle" style={styles.right}>–</Text>}
      </View>
    </Pressable>
  );
}

export default function StudentsScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const groups = useGroups(club?.id);
  const athletes = useAthletes(club?.id, { group_id: group === "all" ? undefined : group });
  // Search filters on the device (accents ignored): instant while typing, no request per letter.
  const rows = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const needle = norm(q.trim());
    const list = (athletes.data ?? []).filter((a) => !needle || norm(a.user.name).includes(needle) || norm(a.user.email).includes(needle));
    if (sort === "compliance") list.sort((a, b) => (a.compliance_pct ?? 101) - (b.compliance_pct ?? 101));
    return list;
  }, [athletes.data, q, sort]);
  if (!club) return null;
  const total = athletes.data?.length;
  const filtered = !!q.trim() || group !== "all";
  return (
    <Screen refreshing={athletes.isRefetching && !athletes.isPending} onRefresh={() => { void athletes.refetch(); void groups.refetch(); }}>
      <PageHeader title={t("Alunos")} subtitle={total != null ? (group === "all" ? tn(total, "{n} aluno ativo", "{n} alunos ativos") : tn(total, "{n} aluno no grupo", "{n} alunos no grupo")) : " "}
        actions={<Button variant="secondary" size="sm" icon={Users} onPress={() => setGroupsOpen(true)}>{t("Grupos")}</Button>} />
      <View style={{ gap: theme.space[3] }}>
        <View style={styles.search}>
          <Input value={q} onChangeText={setQ} placeholder={t("Buscar aluno")} accessibilityLabel={t("Buscar aluno")} returnKeyType="search" autoCorrect={false} autoCapitalize="none"
            clearButtonMode="while-editing" style={{ paddingLeft: theme.space[10] }} />
          <View pointerEvents="none" style={[styles.searchIcon, { left: theme.space[3] }]}><Search size={theme.size.iconSm} color={theme.color.fgSubtle} aria-hidden /></View>
        </View>
        {(groups.data?.length ?? 0) > 0 && (
          <FilterChips label={t("Filtrar por grupo")} value={group} onChange={setGroup} items={[{ value: "all", label: t("Todos") }, ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} />
        )}
        <Segmented size="sm" label={t("Ordenar")} value={sort} onChange={setSort} options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} style={styles.stretch} />
      </View>

      {athletes.isPending ? (
        <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[10] }} />)}</Card>
      ) : athletes.error && !athletes.data ? (
        <Card>
          <EmptyState icon={CircleAlert} title={athletes.error instanceof ApiError ? athletes.error.title : t("Algo deu errado")}
            action={<Button variant="secondary" loading={athletes.isFetching} onPress={() => void athletes.refetch()}>{t("Tentar de novo")}</Button>}>
            {athletes.error instanceof ApiError ? athletes.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={filtered ? t("Ninguém encontrado") : t("Nenhum aluno ainda")}
            action={!filtered && hasWeb ? <Button variant="secondary" icon={ExternalLink} onPress={() => openOnWeb("/students")}>{t("Convidar pela web")}</Button> : undefined}>
            {filtered ? t("Tente outro nome ou grupo.") : t("Convide os alunos por e-mail. Eles aparecem aqui quando aceitarem.")}
          </EmptyState>
        </Card>
      ) : (
        <Card style={styles.clip}>
          {rows.map((a, i) => <Row key={a.membership.id} a={a} divider={i > 0} />)}
        </Card>
      )}
      <GroupsSheet clubId={club.id} open={groupsOpen} onOpenChange={setGroupsOpen} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  right: { textAlign: "right" },
  stretch: { alignSelf: "stretch" },
  clip: { overflow: "hidden" },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

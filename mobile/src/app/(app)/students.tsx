/**
 * W2 · Alunos (staff), phone-sized: search, group filter, sort (name or lowest compliance), and per student the
 * 28-day compliance, this week's progress, the last activity and Strava. Tapping opens the student (W3). Groups are
 * easy to reach: "+ Novo grupo" by the filter, "Editar grupo" for the selected one, and "Selecionar" (or a long
 * press on a student) to pick students and add them to a group or take them out at once. "Grupos" lists them all.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAthletes, useGroups, useSetGroupMembers } from "@/api/staff";
import type { AthleteSummary, Group } from "@/api/types";
import { GOAL_LABEL, LEVEL_LABEL } from "@/components/staff/athlete";
import { GroupsSheet } from "@/components/staff/GroupsSheet";
import { ComplianceBar, FilterChips } from "@/components/staff/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { ago } from "@/lib/format";
import { hasWeb, openOnWeb } from "@/lib/web";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, EmptyState, Input, Menu, PageHeader, Screen, Segmented, Skeleton, Text, toast, type MenuItem } from "@/ui";
import { Activity, Check, CircleAlert, ExternalLink, FolderMinus, FolderPlus, ListChecks, Lock, Pencil, Plus, Search, Users, X } from "@/ui/icons";

/** `strava`: the last activity and the Strava state only where the club's modalities sync activities (D-052). */
function Row({ a, divider, groupNames, selecting, checked, onToggle, onSelectStart, strava }: {
  a: AthleteSummary; divider: boolean; groupNames: string; selecting: boolean; checked: boolean; onToggle: () => void; onSelectStart: () => void; strava: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const week = a.week.planned ? t("{done}/{planned} na semana", { done: a.week.done, planned: a.week.planned }) : t("Sem treinos na semana");
  const last = !strava ? null : a.last_activity_at ? ago(a.last_activity_at) : t("sem atividade");
  const goal = [a.goal ? t(GOAL_LABEL[a.goal]) : null, a.level ? t(LEVEL_LABEL[a.level]) : null].filter(Boolean).join(" · ");
  // What the club sees (D-011): sharing off reads as such, like the web's list.
  const sharing = !a.shares_data ? t("Não compartilha os treinos") : !strava ? null : a.strava === "private" ? t("Não compartilha o Strava") : a.strava === "shared" ? t("Strava") : null;
  const compliance = a.shares_data && a.compliance_pct != null ? t("aderência {p}%", { p: a.compliance_pct }) : null;
  const label = [a.user.name, goal, groupNames, week, last && t("última atividade {when}", { when: last }), compliance, sharing].filter(Boolean).join(", ");
  return (
    <Pressable accessibilityRole={selecting ? "checkbox" : "link"} accessibilityState={selecting ? { checked } : undefined}
      accessibilityHint={selecting ? undefined : t("Toque e segure para selecionar")}
      onPress={selecting ? onToggle : () => router.push(`/students/${a.membership.id}`)} onLongPress={selecting ? undefined : onSelectStart}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], minHeight: theme.size.touchMin + theme.space[4], backgroundColor: pressed ? c.soft : checked ? c.brand.subtle : "transparent", borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
      {selecting && (
        <View style={[styles.center, { width: theme.size.iconMd, height: theme.size.iconMd, borderRadius: theme.radius.xs, borderWidth: 2, borderColor: checked ? c.brand.solid : c.lineStrong, backgroundColor: checked ? c.brand.solid : c.surface }]}>
          {checked && <Check size={theme.size.iconSm} color={c.brand.onSolid} strokeWidth={3} aria-hidden />}
        </View>
      )}
      <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[10]} />
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="labelMd" numberOfLines={1}>{a.user.name}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{last ? `${week} · ${last}` : week}</Text>
        {goal ? <Text variant="caption" tone="subtle" numberOfLines={1}>{goal}</Text> : null}
        {groupNames ? <Text variant="caption" tone="subtle" numberOfLines={1}>{groupNames}</Text> : null}
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
  const c = theme.color;
  const { club } = useClub();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsStart, setGroupsStart] = useState<Partial<Group> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const groups = useGroups(club?.id);
  const setMembers = useSetGroupMembers(club?.id ?? "");
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
  const list = groups.data ?? [];
  const current = list.find((g) => g.id === group) ?? null;
  const total = athletes.data?.length;
  const filtered = !!q.trim() || group !== "all";
  const openGroups = (start: Partial<Group> | null = null) => { setGroupsStart(start); setGroupsOpen(true); };
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = [...selected];
  const move = (g: Group, add: boolean) => {
    const members = add ? [...new Set([...g.member_ids, ...picked])] : g.member_ids.filter((id) => !selected.has(id));
    const n = add ? members.length - g.member_ids.length : g.member_ids.length - members.length;
    setMembers.mutate({ id: g.id, member_ids: members }, {
      onSuccess: () => {
        toast.success(n === 0 ? t("Já estavam em {g}", { g: g.name }) : add ? tn(n, "{n} aluno adicionado a {g}", "{n} alunos adicionados a {g}", { g: g.name }) : tn(n, "{n} aluno saiu de {g}", "{n} alunos saíram de {g}", { g: g.name }));
        stopSelecting();
      },
      onError: toast.error,
    });
  };
  const addItems: MenuItem[] = [
    ...list.map((g) => ({ label: g.name, icon: Users, onSelect: () => move(g, true) })),
    ...(list.length ? (["separator"] as const) : []),
    { label: t("Novo grupo com eles…"), icon: Plus, onSelect: () => { openGroups({ member_ids: picked }); stopSelecting(); } },
  ];
  const removeItems: MenuItem[] = list.filter((g) => g.member_ids.some((id) => selected.has(id))).map((g) => ({ label: g.name, icon: Users, onSelect: () => move(g, false) }));
  const groupNames = (a: AthleteSummary) => a.group_ids.map((id) => list.find((g) => g.id === id)?.name).filter(Boolean).join(" · ");

  return (
    <Screen refreshing={athletes.isRefetching && !athletes.isPending} onRefresh={() => { void athletes.refetch(); void groups.refetch(); }}>
      <PageHeader title={t("Alunos")} subtitle={total != null ? (group === "all" ? tn(total, "{n} aluno ativo", "{n} alunos ativos") : tn(total, "{n} aluno no grupo", "{n} alunos no grupo")) : " "}
        actions={(
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Button variant="secondary" size="sm" icon={Users} onPress={() => openGroups()}>{t("Grupos")}</Button>
            {!selecting && rows.length > 0 && <Button variant="secondary" size="sm" icon={ListChecks} onPress={() => setSelecting(true)}>{t("Selecionar")}</Button>}
          </View>
        )} />
      <View style={{ gap: theme.space[3] }}>
        <View style={styles.search}>
          <Input value={q} onChangeText={setQ} placeholder={t("Buscar aluno")} accessibilityLabel={t("Buscar aluno")} returnKeyType="search" autoCorrect={false} autoCapitalize="none"
            clearButtonMode="while-editing" style={{ paddingLeft: theme.space[10] }} />
          <View pointerEvents="none" style={[styles.searchIcon, { left: theme.space[3] }]}><Search size={theme.size.iconSm} color={theme.color.fgSubtle} aria-hidden /></View>
        </View>
        {list.length > 0 ? (
          <>
            <FilterChips label={t("Filtrar por grupo")} value={group} onChange={(v) => { setGroup(v); stopSelecting(); }} items={[{ value: "all", label: t("Todos") }, ...list.map((g) => ({ value: g.id, label: g.name }))]} />
            <View style={[styles.row, styles.between, { gap: theme.space[2] }]}>
              <Button variant="ghost" size="sm" icon={Plus} onPress={() => openGroups({})}>{t("Novo grupo")}</Button>
              {current && <Button variant="ghost" size="sm" icon={Pencil} onPress={() => openGroups(current)}>{t("Editar grupo")}</Button>}
            </View>
          </>
        ) : groups.data ? (
          <Card style={[styles.row, { gap: theme.space[3], padding: theme.space[4] }]}>
            <View style={[styles.center, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.full, backgroundColor: c.brand.subtle }]}>
              <Users size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />
            </View>
            <View style={[styles.flex, { gap: theme.space[2] }]}>
              <Text variant="bodySm" tone="muted">{t("Agrupe alunos para atribuir treinos e planilhas de uma vez.")}</Text>
              <Button size="sm" icon={Plus} onPress={() => openGroups({})} style={styles.start}>{t("Criar grupo")}</Button>
            </View>
          </Card>
        ) : null}
        <Segmented size="sm" label={t("Ordenar")} value={sort} onChange={setSort} options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} style={styles.stretch} />
        {selecting && (
          <Card style={{ gap: theme.space[3], padding: theme.space[3], borderColor: c.brand.solid }}>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Text variant="labelMd" style={styles.flex}>{selected.size ? tn(selected.size, "{n} aluno selecionado", "{n} alunos selecionados") : t("Toque nos alunos para selecionar")}</Text>
              <Button variant="ghost" size="sm" icon={X} onPress={stopSelecting}>{t("Cancelar")}</Button>
            </View>
            {selected.size > 0 && (
              <View style={[styles.row, styles.wrap, { gap: theme.space[2] }]}>
                <Menu title={t("Adicionar ao grupo")} items={addItems} trigger={(open) => <Button size="sm" icon={FolderPlus} loading={setMembers.isPending} onPress={open}>{t("Adicionar ao grupo")}</Button>} />
                {removeItems.length > 0 && <Menu title={t("Remover do grupo")} items={removeItems} trigger={(open) => <Button variant="secondary" size="sm" icon={FolderMinus} onPress={open}>{t("Remover do grupo")}</Button>} />}
              </View>
            )}
          </Card>
        )}
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
            action={current && !q.trim() ? <Button variant="secondary" icon={Pencil} onPress={() => openGroups(current)}>{t("Adicionar alunos ao grupo")}</Button>
              : !filtered && hasWeb ? <Button variant="secondary" icon={ExternalLink} onPress={() => openOnWeb("/students")}>{t("Convidar pela web")}</Button> : undefined}>
            {q.trim() ? t("Tente outro nome.") : current ? t("Este grupo ainda não tem alunos.") : t("Convide os alunos por e-mail. Eles aparecem aqui quando aceitarem.")}
          </EmptyState>
        </Card>
      ) : (
        <Card style={styles.clip}>
          {rows.map((a, i) => (
            <Row key={a.membership.id} a={a} divider={i > 0} groupNames={group === "all" ? groupNames(a) : ""} selecting={selecting} checked={selected.has(a.membership.id)}
              onToggle={() => toggle(a.membership.id)} onSelectStart={() => { setSelecting(true); setSelected(new Set([a.membership.id])); }} strava={has(club, "strava")} />
          ))}
        </Card>
      )}
      <GroupsSheet clubId={club.id} open={groupsOpen} onOpenChange={setGroupsOpen} start={groupsStart} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { justifyContent: "space-between", flexWrap: "wrap" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  right: { textAlign: "right" },
  center: { alignItems: "center", justifyContent: "center" },
  start: { alignSelf: "flex-start" },
  stretch: { alignSelf: "stretch" },
  clip: { overflow: "hidden" },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

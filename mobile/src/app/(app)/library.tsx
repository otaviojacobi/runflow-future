/**
 * W6 · Biblioteca (the web's screens/staff/Library.tsx): the club's workout templates, searchable by name or #tag,
 * filtered by sport and tag; each card shows its intensity profile, estimate and tags. Tap to open in the builder;
 * "⋯" duplicates or archives. "Novo treino" opens the builder.
 */
import { router } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useArchiveTemplate, useSaveTemplate, useTemplates } from "@/api/library";
import type { Sport, WorkoutTemplate } from "@/api/types";
import { Chip } from "@/components/builder/parts";
import { SPORT_LABEL, SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import { tagNeedle } from "@/domain/tags";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago, distance, duration } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, EmptyState, IconButton, Input, Menu, Screen, Skeleton, Text, toast } from "@/ui";
import { Archive, Copy, Library as LibraryIcon, MoreHorizontal, Pencil, Plus, Search } from "@/ui/icons";

const open = (id: string) => router.push({ pathname: "/library/[id]", params: { id } });

function TemplateCard({ w, onDuplicate, onArchive }: { w: WorkoutTemplate; onDuplicate: () => void; onArchive: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const est = [w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : null, w.est_distance_m ? distance(w.est_distance_m, { swim: w.sport === "swim" }) : null].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, styles.top, { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }]}>
      <Pressable onPress={() => open(w.id)} accessibilityRole="link" accessibilityLabel={[w.name, t(SPORT_LABEL[w.sport]), est, w.tags.map((x) => `#${x}`).join(" ")].filter(Boolean).join(", ")}
        style={({ pressed }) => [styles.flex, { gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: pressed ? c.soft : "transparent" }]}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <SportChip sport={w.sport} size="sm" />
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>{est}</Text>
        </View>
        <Text variant="labelMd">{w.name}</Text>
        <IntensityProfile structure={w.structure} sport={w.sport} height={theme.space[8]} />
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>{w.tags.slice(0, 3).map((x) => `#${x}`).join(" ")}</Text>
          <Text variant="caption" tone="muted">{t("editado {when}", { when: ago(w.updated_at) })}</Text>
        </View>
      </Pressable>
      <Menu title={w.name} trigger={(o) => <IconButton icon={MoreHorizontal} label={t("Ações para {name}", { name: w.name })} onPress={o} style={{ margin: theme.space[1] }} />} items={[
        { label: t("Editar"), icon: Pencil, onSelect: () => open(w.id) },
        { label: t("Duplicar"), icon: Copy, onSelect: onDuplicate },
        "separator",
        { label: t("Arquivar"), icon: Archive, danger: true, onSelect: onArchive },
      ]} />
    </View>
  );
}

export default function LibraryScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const [q, setQ] = useState("");
  const [sport, setSport] = useState<Sport | "">("");
  const [tag, setTag] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const all = useTemplates(club?.id);
  const save = useSaveTemplate(club?.id ?? "");
  const archive = useArchiveTemplate(club?.id ?? "");
  const [toArchive, setToArchive] = useState<WorkoutTemplate | null>(null);
  const sports = useMemo(() => [...new Set((all.data ?? []).map((w) => w.sport))], [all.data]);
  const topTags = useMemo(() => {
    const n = new Map<string, number>();
    for (const w of all.data ?? []) if (!sport || w.sport === sport) for (const x of w.tags) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([x]) => x);
  }, [all.data, sport]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase(), tagQ = tagNeedle(q), hash = q.trim().startsWith("#");
    return (all.data ?? []).filter((w) => (!sport || w.sport === sport) && (!tag || w.tags.includes(tag)) &&
      (!needle || (!hash && w.name.toLowerCase().includes(needle)) || w.tags.some((x) => x.includes(tagQ))));
  }, [all.data, q, sport, tag]);
  if (!club) return null;
  const filtered = !!(q || sport || tag);

  const duplicate = (w: WorkoutTemplate) =>
    save.mutate({ data: { name: t("{name} (cópia)", { name: w.name }), sport: w.sport, description: w.description, structure: w.structure, est_duration_s: w.est_duration_s, est_distance_m: w.est_distance_m, tags: w.tags } }, {
      onSuccess: (r) => { toast.success(t("Treino duplicado")); open(r.id); },
      onError: toast.error,
    });
  const refresh = async () => { setRefreshing(true); await all.refetch(); setRefreshing(false); };
  const chipRow = (children: ReactNode, label: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={label}
      style={{ marginHorizontal: -theme.space[4], flexGrow: 0 }} contentContainerStyle={{ gap: theme.space["1.5"], paddingHorizontal: theme.space[4] }}>{children}</ScrollView>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Text tone="muted" style={styles.flex}>{all.data ? tn(all.data.length, "{n} treino pronto para usar", "{n} treinos prontos para usar") : " "}</Text>
        <Button icon={Plus} onPress={() => router.push("/library/new")}>{t("Novo treino")}</Button>
      </View>
      <View style={{ gap: theme.space[3] }}>
        <View style={styles.search}>
          <Input value={q} onChangeText={setQ} placeholder={t("Buscar por nome ou tag")} accessibilityLabel={t("Buscar treino")} autoCapitalize="none" autoCorrect={false}
            returnKeyType="search" style={{ paddingLeft: theme.space[10] }} />
          <View pointerEvents="none" style={[styles.searchIcon, { left: theme.space[3] }]}><Search size={theme.size.iconSm} color={theme.color.fgSubtle} aria-hidden /></View>
        </View>
        {sports.length > 1 && chipRow((["", ...sports] as (Sport | "")[]).map((s) => (
          <Chip key={s || "all"} accessibilityRole="radio" label={s ? t(SPORT_LABEL[s]) : t("Todos")} on={sport === s} onPress={() => setSport(s)} />
        )), t("Filtrar por modalidade"))}
        {topTags.length > 0 && chipRow((tag && !topTags.includes(tag) ? [tag, ...topTags] : topTags).map((x) => (
          <Chip key={x} label={`#${x}`} on={tag === x} onPress={() => setTag(tag === x ? "" : x)} />
        )), t("Filtrar por tag"))}
      </View>
      {all.isPending ? (
        <View style={{ gap: theme.space[3] }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[20] + theme.space[12] }} />)}</View>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={LibraryIcon} title={filtered ? t("Nada encontrado") : t("Sua biblioteca está vazia")}
            action={!filtered ? <Button icon={Plus} onPress={() => router.push("/library/new")}>{t("Criar o primeiro treino")}</Button> : undefined}>
            {filtered ? t("Tente outra busca, modalidade ou tag.") : t("Monte treinos uma vez e reaproveite para todos os alunos.")}
          </EmptyState>
        </Card>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {items.map((w) => <TemplateCard key={w.id} w={w} onDuplicate={() => duplicate(w)} onArchive={() => setToArchive(w)} />)}
        </View>
      )}
      <Dialog open={!!toArchive} onOpenChange={(v) => !v && setToArchive(null)} title={t("Arquivar “{name}”?", { name: toArchive?.name ?? "" })}
        description={t("Ele sai da biblioteca. Os treinos já atribuídos aos alunos não mudam.")}
        footer={<>
          <Button variant="secondary" onPress={() => setToArchive(null)}>{t("Cancelar")}</Button>
          <Button variant="danger" loading={archive.isPending} onPress={() => toArchive && archive.mutate(toArchive.id, { onSuccess: () => { toast.success(t("Treino arquivado")); setToArchive(null); }, onError: toast.error })}>{t("Arquivar")}</Button>
        </>} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  search: { justifyContent: "center" },
  searchIcon: { position: "absolute" },
});

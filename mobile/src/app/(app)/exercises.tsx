/**
 * W18 · Exercícios (the web's screens/staff/Exercises.tsx; clubs that teach musculação, D-035): Runflow's catalog and
 * the club's own exercises, searchable by name or muscle and filtered by category. Tapping one shows how to do it and
 * opens its video (YouTube/Vimeo in the browser). Staff create club exercises, edit or remove them, or make a club
 * version of a catalog one (their own video and cues for their students).
 */
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useArchiveExercise, useExercises, useSaveExercise } from "@/api/exercises";
import type { Club, ExerciseCategory, LibraryExercise } from "@/api/types";
import { ConfirmDialog } from "@/components/account/parts";
import { FilterChips } from "@/components/staff/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { parseVideo, thumbnailUrl } from "@/lib/video";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, Screen, Select, Skeleton, Text, Textarea, toast } from "@/ui";
import { Dumbbell, MoreHorizontal, Pencil, PlayCircle, Plus, Search, Trash2 } from "@/ui/icons";

const CATEGORY_LABEL: Record<ExerciseCategory, string> = { strength: "Força", core: "Core", mobility: "Mobilidade", stretch: "Alongamento", plyometrics: "Pliometria", drill: "Educativo" };
const CATS = Object.keys(CATEGORY_LABEL) as ExerciseCategory[];
type EditState = { value: LibraryExercise | null; copyFrom?: LibraryExercise };

const openVideo = (url: string) => void WebBrowser.openBrowserAsync(url).catch(() => toast.error(null));

export default function ExercisesScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"" | ExerciseCategory>("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [view, setView] = useState<LibraryExercise | null>(null);
  const [remove, setRemove] = useState<LibraryExercise | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const list = useExercises(club?.id, { q: q.trim() || undefined, category: cat || undefined });
  const archive = useArchiveExercise(club?.id ?? "");
  if (!club) return null;
  const refresh = async () => { setRefreshing(true); await list.refetch(); setRefreshing(false); };
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{t("Catálogo do Runflow e os exercícios do clube, com vídeo e dicas. Aparecem para o aluno nos treinos de força e mobilidade.")}</Text>
      <Button icon={Plus} block onPress={() => setEdit({ value: null })}>{t("Novo exercício")}</Button>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Search size={theme.size.iconMd} color={theme.color.fgSubtle} aria-hidden />
        <Input style={styles.flex} value={q} onChangeText={setQ} placeholder={t("Buscar por nome ou músculo")} accessibilityLabel={t("Buscar exercício")} autoCorrect={false} returnKeyType="search" />
      </View>
      <FilterChips<"" | ExerciseCategory> label={t("Categoria")} value={cat} onChange={setCat}
        items={[{ value: "", label: t("Todos") }, ...CATS.map((c) => ({ value: c, label: t(CATEGORY_LABEL[c]) }))]} />

      {list.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : !list.data?.length ? (
        <Card><EmptyState icon={Dumbbell} title={t("Nenhum exercício encontrado")}>{t("Tente outro termo ou crie um exercício do clube.")}</EmptyState></Card>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {list.data.map((e) => <ExerciseCard key={e.id} e={e} onOpen={() => setView(e)}
            onEdit={() => setEdit({ value: e })} onCopy={() => setEdit({ value: null, copyFrom: e })} onRemove={() => setRemove(e)} />)}
        </View>
      )}

      {edit && <ExerciseForm club={club} state={edit} onClose={() => setEdit(null)} />}
      <HowTo exercise={view} onClose={() => setView(null)} />
      <ConfirmDialog open={!!remove} onOpenChange={(v) => { if (!v) setRemove(null); }} title={t("Remover este exercício?")} description={remove?.name} confirmLabel={t("Remover")}
        loading={archive.isPending}
        onConfirm={() => remove && archive.mutate(remove.id, { onSuccess: () => { setRemove(null); toast.success(t("Exercício removido")); }, onError: toast.error })}>
        <Text tone="muted">{t("Os treinos que já usam este exercício continuam com o nome dele.")}</Text>
      </ConfirmDialog>
    </Screen>
  );
}

function ExerciseCard({ e, onOpen, onEdit, onCopy, onRemove }: { e: LibraryExercise; onOpen: () => void; onEdit: () => void; onCopy: () => void; onRemove: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const thumb = thumbnailUrl(e.video_url);
  const video = !!parseVideo(e.video_url);
  return (
    <Card style={{ overflow: "hidden" }}>
      {video && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("Ver {name}", { name: e.name })} onPress={onOpen}
          style={({ pressed }) => [styles.center, { aspectRatio: 16 / 9, backgroundColor: pressed ? c.soft : c.sunken }]}>
          {thumb ? <Image source={{ uri: thumb }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
          <View style={[styles.center, { width: theme.space[16], height: theme.space[16], borderRadius: theme.radius.full, backgroundColor: c.overlay }]}>
            <PlayCircle size={theme.space[10]} color={c.fgInverse} aria-hidden />
          </View>
        </Pressable>
      )}
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        <View style={[styles.row, styles.top, { gap: theme.space[2] }]}>
          <Text variant="titleSm" style={styles.flex}>{e.name}</Text>
          <Menu title={e.name} trigger={(open) => <IconButton icon={MoreHorizontal} label={t("Ações de {name}", { name: e.name })} onPress={open} />}
            items={e.scope === "club"
              ? [{ label: t("Editar"), icon: Pencil, onSelect: onEdit }, { label: t("Remover"), icon: Trash2, danger: true, onSelect: onRemove }]
              : [{ label: t("Criar versão do clube"), icon: Pencil, onSelect: onCopy }]} />
        </View>
        <View style={[styles.wrap, { gap: theme.space["1.5"] }]}>
          <Badge>{t(CATEGORY_LABEL[e.category])}</Badge>
          {e.scope === "club" ? <Badge tone="brand">{t("Do clube")}</Badge> : <Badge tone="neutral">{t("Runflow")}</Badge>}
        </View>
        {e.muscles.length > 0 && <Text variant="bodySm" tone="muted">{e.muscles.join(" · ")}</Text>}
        {!video && e.cues ? <Button variant="ghost" size="sm" icon={Dumbbell} style={styles.start} accessibilityLabel={t("Como fazer: {name}", { name: e.name })} onPress={onOpen}>{t("Como fazer")}</Button> : null}
      </View>
    </Card>
  );
}

/** How to do it: the cues, the equipment and the video (opens in the browser; the phone has no embedded player). */
function HowTo({ exercise: e, onClose }: { exercise: LibraryExercise | null; onClose: () => void }) {
  const { theme } = useTheme();
  return (
    <Dialog open={!!e} onOpenChange={(v) => { if (!v) onClose(); }} title={e?.name ?? ""} description={e ? [t(CATEGORY_LABEL[e.category]), ...e.muscles].join(" · ") : null}
      footer={e?.video_url ? <Button size="lg" icon={PlayCircle} style={styles.flex} onPress={() => openVideo(e.video_url!)}>{t("Ver vídeo")}</Button> : undefined}>
      {e && (
        <View style={{ gap: theme.space[4] }}>
          {!e.video_url && <Text variant="bodySm" tone="muted">{t("Este exercício ainda não tem vídeo.")}</Text>}
          {e.cues ? (
            <View style={{ gap: theme.space[1] }}>
              <Text variant="titleSm" accessibilityRole="header">{t("Como fazer")}</Text>
              <Text>{e.cues}</Text>
            </View>
          ) : null}
          {e.equipment.length > 0 && <Text variant="bodySm" tone="muted">{t("Equipamento: {e}", { e: e.equipment.join(", ") })}</Text>}
        </View>
      )}
    </Dialog>
  );
}

function ExerciseForm({ club, state, onClose }: { club: Club; state: EditState; onClose: () => void }) {
  const { theme } = useTheme();
  const save = useSaveExercise(club.id);
  const base = state.value ?? state.copyFrom;
  const [v, setV] = useState({ name: base?.name ?? "", category: base?.category ?? ("strength" as ExerciseCategory), muscles: base?.muscles.join(", ") ?? "", equipment: base?.equipment.join(", ") ?? "", cues: base?.cues ?? "", video_url: base?.video_url ?? "" });
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const submit = () => save.mutate({ id: state.value?.id, name: v.name.trim(), category: v.category, muscles: list(v.muscles), equipment: list(v.equipment), cues: v.cues.trim() || null, video_url: v.video_url.trim() || null }, {
    onSuccess: () => { toast.success(t("Exercício salvo")); onClose(); },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={state.value ? t("Editar exercício") : state.copyFrom ? t("Versão do clube") : t("Novo exercício")}
      description={state.copyFrom ? t("Substitui o exercício do catálogo para os seus alunos: use seu vídeo e suas dicas.") : null}
      footer={<>
        <Button variant="secondary" size="lg" onPress={onClose}>{t("Cancelar")}</Button>
        <Button size="lg" style={styles.flex} loading={save.isPending} disabled={!v.name.trim()} onPress={submit}>{t("Salvar")}</Button>
      </>}>
      <View style={{ gap: theme.space[4] }}>
        <Field label={t("Nome")} error={err?.fieldError("name")}>
          {(a) => <Input {...a} value={v.name} onChangeText={(name) => set({ name })} readOnly={!!state.copyFrom} autoCapitalize="sentences" />}
        </Field>
        <Field label={t("Categoria")}>
          {(a) => <Select<ExerciseCategory> {...a} title={t("Categoria")} value={v.category} onChange={(category) => set({ category })} options={CATS.map((c) => ({ value: c, label: t(CATEGORY_LABEL[c]) }))} />}
        </Field>
        <Field label={t("Músculos")} optional hint={t("Separe por vírgula")}>
          {(a) => <Input {...a} value={v.muscles} onChangeText={(muscles) => set({ muscles })} placeholder={t("glúteos, quadríceps")} autoCapitalize="none" />}
        </Field>
        <Field label={t("Equipamento")} optional hint={t("Separe por vírgula")}>
          {(a) => <Input {...a} value={v.equipment} onChangeText={(equipment) => set({ equipment })} placeholder={t("halteres, banco")} autoCapitalize="none" />}
        </Field>
        <Field label={t("Link do vídeo")} optional hint={t("YouTube ou Vimeo. Dica: grave no seu estúdio e publique como não listado.")} error={err?.fieldError("video_url")}>
          {(a) => <Input {...a} value={v.video_url} onChangeText={(video_url) => set({ video_url })} placeholder="https://youtu.be/…" keyboardType="url" autoCapitalize="none" autoCorrect={false} />}
        </Field>
        {parseVideo(v.video_url) && <Button variant="ghost" icon={PlayCircle} style={styles.start} onPress={() => openVideo(v.video_url.trim())}>{t("Testar o link")}</Button>}
        <Field label={t("Como fazer")} optional>
          {(a) => <Textarea {...a} value={v.cues} onChangeText={(cues) => set({ cues })} placeholder={t("Postura, amplitude, respiração, erros comuns")} maxLength={2000} />}
        </Field>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
});

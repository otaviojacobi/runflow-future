/**
 * W5 · Construtor de treino for a library template (the web's screens/staff/Builder.tsx): name, sport, tags, "Descrever
 * com IA", the builder (quick text ⇄ blocks ⇄ summary) and the note for the student. Save and the .FIT file sit in a
 * bar at the bottom so they're always in reach. Used by /library/new and /library/[id].
 */
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSaveTemplate, useTemplate, useTemplates } from "@/api/library";
import type { Sport } from "@/api/types";
import { emptyStructure } from "@/domain/builder";
import { cleanTags } from "@/domain/tags";
import { estimate, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { textStyle } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Field, Input, Skeleton, Text, Textarea, toast } from "@/ui";
import { Save, SearchX } from "@/ui/icons";
import { AiDescribe, FitButton } from "./extras";
import { SportPicker, TagInput } from "./parts";
import { WorkoutBuilder } from "./WorkoutBuilder";

export function TemplateEditor({ id }: { id?: string }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { club } = useClub();
  const isNew = !id;
  const tpl = useTemplate(club?.id, id);
  const save = useSaveTemplate(club?.id ?? "");
  const library = useTemplates(club?.id);
  const [name, setName] = useState("");
  const [sport, setSport] = useState<Sport>(club?.modalities[0] ?? "run");
  const [description, setDescription] = useState("");
  const [structure, setStructure] = useState<Structure>(emptyStructure);
  const [tags, setTags] = useState<string[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const known = useMemo(() => {
    const n = new Map<string, number>();
    for (const w of library.data ?? []) for (const x of w.tags) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  }, [library.data]);
  // The full template (not the list's placeholder) fills the form once.
  useEffect(() => {
    if (tpl.data && !tpl.isPlaceholderData && tpl.data.id !== loadedId) {
      setName(tpl.data.name); setSport(tpl.data.sport); setDescription(tpl.data.description ?? ""); setStructure(tpl.data.structure); setTags(tpl.data.tags); setLoadedId(tpl.data.id);
    }
  }, [tpl.data, tpl.isPlaceholderData, loadedId]);
  if (!club) return null;
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = () => {
    const est = estimate(structure, sport);
    save.mutate({ id, data: { name: name.trim(), sport, description: description.trim() || null, structure, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m, tags } }, {
      onSuccess: (r) => {
        toast.success(isNew ? t("Treino salvo na biblioteca") : t("Alterações salvas"));
        if (isNew) router.replace({ pathname: "/library/[id]", params: { id: r.id } });
      },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  if (!isNew && !loadedId) {
    return (
      <View style={[styles.fill, { padding: theme.space[4], gap: theme.space[4], backgroundColor: theme.color.canvas }]}>
        {tpl.isError ? (
          <Card><EmptyState icon={SearchX} title={tpl.error instanceof ApiError ? tpl.error.title : t("Treino não encontrado")}
            action={<Button variant="secondary" onPress={() => router.navigate("/library")}>{t("Voltar para a biblioteca")}</Button>}>
            {tpl.error instanceof ApiError ? tpl.error.detail : null}
          </EmptyState></Card>
        ) : (
          <>
            <Skeleton style={{ height: theme.space[12] }} />
            <Skeleton style={{ height: theme.space[20] * 2 }} />
            <Skeleton style={{ height: theme.space[20] * 3 }} />
          </>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.fill, { backgroundColor: theme.color.canvas }]}>
      <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.space[4], paddingTop: theme.space[5], paddingBottom: theme.space[8], gap: theme.space[5], maxWidth: theme.size.readingMax }]}>
        <Field label={t("Nome do treino")} error={err?.fieldError("name")}>
          {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Ex.: Intervalado 6×1 km")} autoCapitalize="sentences" maxLength={120} style={styles.title} />}
        </Field>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Modalidade")}</Text>
          <SportPicker value={sport} allowed={club.modalities}
            onChange={(s) => { setSport(s); if (s === "strength" || sport === "strength") setStructure(emptyStructure()); }} />
        </View>
        <Field label={t("Tags")} optional hint={t("Para achar o treino na biblioteca. Também vale #tag na escrita rápida.")} error={err?.fieldError("tags")}>
          {(a) => <TagInput label={a.accessibilityLabel} value={tags} onChange={setTags} suggestions={known} />}
        </Field>
        {err?.fieldError("structure") ? <Text variant="bodySm" tone="danger">{err.fieldError("structure")}</Text> : null}
        <AiDescribe clubId={club.id} sport={sport} onResult={(w) => { setStructure(w.structure); if (!name.trim()) setName(w.name); if (w.tags?.length) setTags((cur) => cleanTags([...cur, ...w.tags])); }} />
        <WorkoutBuilder sport={sport} structure={structure} onChange={setStructure} onTags={(x) => setTags((cur) => cleanTags([...cur, ...x]))} />
        <Field label={t("Descrição para o aluno")} optional hint={t("Aparece no app do aluno junto do treino.")}>
          {(a) => <Textarea {...a} value={description} onChangeText={setDescription} placeholder={t("Ex.: foco em manter o pace constante nos tiros.")} maxLength={2000} />}
        </Field>
      </ScrollView>
      <View style={[styles.bar, { gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[3] + insets.bottom, borderTopColor: theme.color.line, backgroundColor: theme.color.surface }]}>
        <FitButton name={name} sport={sport} structure={structure} label={t(".FIT")} />
        <Button icon={Save} loading={save.isPending} onPress={submit} style={styles.flex}>{isNew ? t("Salvar na biblioteca") : t("Salvar alterações")}</Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: "100%", alignSelf: "center" },
  bar: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: textStyle("titleMd").fontSize, fontWeight: textStyle("titleMd").fontWeight },
});

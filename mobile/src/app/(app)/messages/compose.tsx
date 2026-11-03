/**
 * W13 · Novo aviso / Editar aviso (staff, `?id=` edits): title, text, who it's for (the whole club or some groups),
 * pinned. Publishing notifies the audience. The keyboard never covers the fields or the button; leaving with unsaved
 * text asks first.
 */
import { Redirect, Stack, router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type AnnouncementInput, useAnnouncements, useGroups, useSaveAnnouncement } from "@/api/messages";
import type { Announcement, Group, MembershipContext } from "@/api/types";
import { useKeyboardVisible } from "@/components/messages/Composer";
import { LoadError } from "@/components/messages/parts";
import { TopBar, goBack } from "@/components/messages/TopBar";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, EmptyState, Field, Input, Skeleton, Switch, Text, Textarea, toast } from "@/ui";
import { Check, Megaphone } from "@/ui/icons";

const MURAL = { pathname: "/messages", params: { tab: "mural" } } as const;
const MAX_TITLE = 120;
const MAX_BODY = 4000;

export default function ComposeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { ctx, isStaff } = useClub();
  if (ctx && !isStaff) return <Redirect href="/messages" />;
  return ctx ? <Compose key={id || "new"} ctx={ctx} id={id || undefined} /> : null;
}

function Compose({ ctx, id }: { ctx: MembershipContext; id?: string }) {
  const { theme } = useTheme();
  const mural = useAnnouncements(id ? ctx.club.id : undefined, false);
  if (!id) return <Form ctx={ctx} />;
  const a = mural.data?.find((x) => x.id === id);
  if (a) return <Form ctx={ctx} value={a} />;
  return (
    <View style={[styles.fill, { backgroundColor: theme.color.canvas }]}>
      <TopBar title={t("Editar aviso")} fallback={MURAL} />
      <View style={{ padding: theme.space[4] }}>
        {mural.error ? <LoadError error={mural.error} retrying={mural.isFetching} retry={() => void mural.refetch()} />
          : mural.isPending ? <Skeleton style={{ height: theme.space[16] * 3, borderRadius: theme.radius.lg }} />
          : <Card><EmptyState icon={Megaphone} title={t("Aviso não encontrado")}>{t("Ele pode ter sido apagado.")}</EmptyState></Card>}
      </View>
    </View>
  );
}

function Form({ ctx, value }: { ctx: MembershipContext; value?: Announcement }) {
  const { theme } = useTheme();
  const c = theme.color;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const club = ctx.club;
  const groups = useGroups(club.id);
  const save = useSaveAnnouncement(club.id);
  const [v, setV] = useState<AnnouncementInput>({ title: value?.title ?? "", body: value?.body ?? "", group_ids: value?.group_ids ?? [], pinned: value?.pinned ?? false });
  // The API's field errors (pt-BR) stay until that field is edited.
  const [edited, setEdited] = useState<string[]>([]);
  const set = (p: Partial<AnnouncementInput>) => {
    setV((o) => ({ ...o, ...p }));
    setEdited((e) => [...new Set([...e, ...Object.keys(p)])]);
  };
  const [discard, setDiscard] = useState(false);
  const err = save.error instanceof ApiError ? save.error : null;
  const fieldError = (f: keyof AnnouncementInput) => (edited.includes(f) ? null : err?.fieldError(f));
  const dirty = value
    ? v.title !== value.title || v.body !== value.body || v.pinned !== value.pinned || [...v.group_ids].sort().join() !== [...value.group_ids].sort().join()
    : !!(v.title.trim() || v.body.trim());

  // Leaving with unsaved text asks first: the back button, Android's back and (no swipe while dirty) iOS's gesture.
  const resume = useRef<(() => void) | null>(null);
  const allowLeaving = usePreventRemove(dirty, ({ repeat }) => { resume.current = repeat; setDiscard(true); });
  const leave = () => {
    allowLeaving();
    if (resume.current) resume.current();
    else goBack(MURAL);
  };

  const submit = () => {
    setEdited([]);
    save.mutate({ ...v, title: v.title.trim(), body: v.body.trim(), id: value?.id }, {
      onSuccess: () => {
        toast.success(value ? t("Aviso atualizado") : t("Aviso publicado"), value ? undefined : t("Os alunos recebem uma notificação."));
        allowLeaving();
        // Back to the mural (also when the composer was opened by a link, with only the list under it).
        router.dismissTo(MURAL);
      },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <TopBar title={value ? t("Editar aviso") : t("Novo aviso")} subtitle={t("Mural · {club}", { club: club.name })} fallback={MURAL} />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: theme.space[4], paddingBottom: theme.space[8], gap: theme.space[5], width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center" }}>
          <Field label={t("Título")} error={fieldError("title")}>
            {(a) => <Input {...a} value={v.title} onChangeText={(title) => set({ title })} maxLength={MAX_TITLE} placeholder={t("Ex.: Treino de pista no feriado")} returnKeyType="next" />}
          </Field>
          <Field label={t("Aviso")} error={fieldError("body")} hint={v.body.length > MAX_BODY - 300 ? t("{n} caracteres restantes", { n: MAX_BODY - v.body.length }) : null}>
            {(a) => <Textarea {...a} value={v.body} onChangeText={(body) => set({ body })} maxLength={MAX_BODY} placeholder={t("Escreva o aviso para os alunos")}
              style={{ minHeight: theme.size.controlLg * 3 }} />}
          </Field>
          <Audience groups={groups.data} loading={groups.isPending} value={v.group_ids} onChange={(group_ids) => set({ group_ids })} />
          <Switch checked={v.pinned} onCheckedChange={(pinned) => set({ pinned })} label={t("Fixar no topo do mural")}
            description={t("Fica acima dos outros avisos até alguém da equipe desafixar.")} />
          {!value && <Text variant="bodySm" tone="muted">{t("Os alunos que recebem o aviso ganham uma notificação, e você acompanha quem já leu.")}</Text>}
        </ScrollView>
        <View style={[styles.footer, { paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: (keyboard ? 0 : insets.bottom) + theme.space[3], backgroundColor: c.surface, borderTopColor: c.line }]}>
          <Button size="lg" block loading={save.isPending} onPress={submit} style={{ width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center" }}>
            {value ? t("Salvar aviso") : t("Publicar aviso")}
          </Button>
        </View>
      </KeyboardAvoidingView>
      <Dialog open={discard} onOpenChange={(o) => { setDiscard(o); if (!o) resume.current = null; }}title={value ? t("Descartar alterações?") : t("Descartar aviso?")}
        description={value ? t("O que você mudou neste aviso não será salvo.") : t("O texto que você escreveu será perdido.")}
        footer={(
          <>
            <Button variant="ghost" onPress={() => setDiscard(false)}>{t("Continuar editando")}</Button>
            <Button variant="danger" onPress={() => { setDiscard(false); leave(); }}>{t("Descartar")}</Button>
          </>
        )} />
    </View>
  );
}

/** "Para quem": the whole club, or one or more groups (chips you toggle). */
function Audience({ groups, loading, value, onChange }: { groups: Group[] | undefined; loading: boolean; value: string[]; onChange: (ids: string[]) => void }) {
  const { theme } = useTheme();
  const all = value.length === 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="labelSm" accessibilityRole="header">{t("Para quem")}</Text>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        <Chip label={t("Todo o clube")} on={all} onPress={() => onChange([])} />
        {(groups ?? []).map((g) => <Chip key={g.id} label={g.name} on={value.includes(g.id)} onPress={() => toggle(g.id)} />)}
        {loading && <Skeleton style={{ width: theme.space[20], height: theme.size.touchMin, borderRadius: theme.radius.full }} />}
      </View>
      <Text variant="caption" tone="muted">
        {all ? t("Todos os alunos ativos do clube recebem.") : t("Só os alunos dos grupos escolhidos recebem.")}
        {!loading && !groups?.length ? ` ${t("Crie grupos na tela Alunos para avisar só uma parte do clube.")}` : ""}
      </Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.chip, {
        minHeight: theme.size.touchMin, paddingHorizontal: theme.space[4], gap: theme.space["1.5"], borderRadius: theme.radius.full,
        borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
      }]}>
      {on && <Check size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />}
      <Text variant="labelMd" color={on ? c.brand.subtleFg : c.fgMuted}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});

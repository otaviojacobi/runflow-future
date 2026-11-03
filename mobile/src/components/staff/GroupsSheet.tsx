/**
 * W2 · Grupos (the web's GroupsDialog as a bottom sheet): the club's groups, then one group's name and members.
 * Deleting asks first; students stay in the club.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAthletes, useDeleteGroup, useGroups, useSaveGroup } from "@/api/staff";
import type { Group } from "@/api/types";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, Skeleton, Text, toast } from "@/ui";
import { ArrowLeft, Check, Pencil, Plus, Trash2, Users } from "@/ui/icons";

export function GroupsSheet({ clubId, open, onOpenChange }: { clubId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const groups = useGroups(clubId);
  const athletes = useAthletes(open ? clubId : undefined);
  const save = useSaveGroup(clubId);
  const del = useDeleteGroup(clubId);
  const [editing, setEditing] = useState<Partial<Group> | null>(null);
  const [removing, setRemoving] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const edit = (g: Partial<Group>) => { save.reset(); setEditing(g); setName(g.name ?? ""); setMembers(new Set(g.member_ids ?? [])); };
  const close = (v: boolean) => { onOpenChange(v); if (!v) { setEditing(null); setRemoving(null); } };
  const err = save.error instanceof ApiError ? save.error.fieldError("name") : null;
  const submit = () => save.mutate({ id: editing?.id, name: name.trim(), member_ids: [...members] }, {
    onSuccess: () => { toast.success(t("Grupo salvo")); setEditing(null); },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  const remove = (g: Group) => del.mutate(g.id, { onSuccess: () => { toast.success(t("Grupo excluído")); setRemoving(null); }, onError: toast.error });

  const title = removing ? t("Excluir o grupo?") : editing ? (editing.id ? t("Editar grupo") : t("Novo grupo")) : t("Grupos");
  const description = removing ? removing.name : editing ? null : t("Agrupe alunos para atribuir treinos e liberar semanas de uma vez.");
  const footer = removing ? (
    <>
      <Button variant="secondary" onPress={() => setRemoving(null)}>{t("Cancelar")}</Button>
      <Button variant="danger" icon={Trash2} loading={del.isPending} onPress={() => remove(removing)}>{t("Excluir")}</Button>
    </>
  ) : editing ? (
    <>
      <Button variant="secondary" icon={ArrowLeft} onPress={() => setEditing(null)}>{t("Voltar")}</Button>
      <Button loading={save.isPending} disabled={!name.trim()} onPress={submit}>{t("Salvar grupo")}</Button>
    </>
  ) : <Button icon={Plus} onPress={() => edit({})}>{t("Novo grupo")}</Button>;

  return (
    <Dialog open={open} onOpenChange={close} title={title} description={description} footer={footer}>
      {removing ? (
        <Text>{t("Os alunos continuam no clube; só o grupo deixa de existir.")}</Text>
      ) : editing ? (
        <View style={{ gap: theme.space[4] }}>
          <Field label={t("Nome do grupo")} error={err}>
            {(f) => <Input {...f} value={name} onChangeText={setName} placeholder={t("Ex.: Maratona SP 2027")} maxLength={60} returnKeyType="done" />}
          </Field>
          <View accessibilityLabel={t("Alunos")} style={{ gap: theme.space[1] }}>
            <Text variant="labelSm" accessibilityRole="header">{`${t("Alunos")} · ${members.size}`}</Text>
            {athletes.isPending ? <Skeleton style={{ height: theme.space[20] }} /> : (athletes.data ?? []).map((a) => {
              const on = members.has(a.membership.id);
              return (
                <Pressable key={a.membership.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.user.name}
                  onPress={() => { const n = new Set(members); if (on) n.delete(a.membership.id); else n.add(a.membership.id); setMembers(n); }}
                  style={({ pressed }) => [styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin, paddingHorizontal: theme.space[1], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
                  <View style={[styles.box, { width: theme.size.iconMd, height: theme.size.iconMd, borderRadius: theme.radius.xs, borderColor: on ? c.brand.solid : c.lineStrong, backgroundColor: on ? c.brand.solid : c.surface }]}>
                    {on && <Check size={theme.size.iconSm} color={c.brand.onSolid} strokeWidth={3} aria-hidden />}
                  </View>
                  <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[6] + theme.space[1]} />
                  <Text variant="labelMd" numberOfLines={1} style={styles.flex}>{a.user.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : groups.isPending ? (
        <Skeleton style={{ height: theme.space[20] }} />
      ) : (groups.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={t("Nenhum grupo ainda")}>{t("Ex.: Iniciantes, Maratona SP 2027, Turma das 6h.")}</EmptyState>
      ) : (
        <View>
          {(groups.data ?? []).map((g) => (
            <View key={g.id} style={[styles.row, { gap: theme.space[3], minHeight: theme.size.touchMin + theme.space[2] }]}>
              <View style={[styles.center, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.full, backgroundColor: c.brand.subtle }]}>
                <Users size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />
              </View>
              <View style={styles.flex}>
                <Text variant="labelMd" numberOfLines={1}>{g.name}</Text>
                <Text variant="bodySm" tone="muted">{tn(g.member_ids.length, "{n} aluno", "{n} alunos")}</Text>
              </View>
              <IconButton icon={Pencil} variant="ghost" label={t("Editar {name}", { name: g.name })} onPress={() => edit(g)} />
              <IconButton icon={Trash2} variant="ghost" label={t("Excluir {name}", { name: g.name })} onPress={() => setRemoving(g)} />
            </View>
          ))}
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  box: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
});

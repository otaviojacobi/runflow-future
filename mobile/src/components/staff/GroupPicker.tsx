/**
 * Groups for one student (the student page, Membros), like the web's components/club/GroupPicker: the groups as
 * removable chips; "Adicionar a um grupo" opens a sheet with the club's groups as checkboxes and a new group by name
 * (created and ticked at once). Saves through PUT /athletes/{id}/groups, which joins and leaves in one go.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useGroups, useSaveGroup, useSetAthleteGroups } from "@/api/staff";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Checkbox, Dialog, EmptyState, Field, Input, Skeleton, Text, toast } from "@/ui";
import { Plus, Users, X } from "@/ui/icons";

/** The club's groups as checkboxes + a new group by name; `onSave` gets the chosen ids. */
export function GroupPickerSheet({ clubId, open, onOpenChange, title, description, selected, onSave, saving }: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string;
  selected: string[]; onSave: (ids: string[]) => void; saving?: boolean;
}) {
  const { theme } = useTheme();
  const groups = useGroups(open ? clubId : undefined);
  const create = useSaveGroup(clubId);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [name, setName] = useState("");
  const [seen, setSeen] = useState(open);
  // Start from the student's groups each time the sheet opens.
  if (open !== seen) { setSeen(open); if (open) { setPicked(new Set(selected)); setName(""); create.reset(); } }
  const err = create.error instanceof ApiError ? create.error.fieldError("name") : null;
  const add = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate({ name: name.trim() }, {
      onSuccess: (g) => { setPicked((p) => new Set(p).add(g.id)); setName(""); toast.success(t("Grupo criado"), g.name); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const list = groups.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<><Button variant="secondary" onPress={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button loading={saving} onPress={() => onSave([...picked])}>{t("Salvar")}</Button></>}>
      <View style={{ gap: theme.space[4] }}>
        {groups.isPending ? <Skeleton style={{ height: theme.space[16] }} /> : list.length === 0 ? (
          <EmptyState icon={Users} title={t("Nenhum grupo ainda")}>{t("Crie o primeiro abaixo. Ex.: Iniciantes, Maratona SP 2027, Turma das 6h.")}</EmptyState>
        ) : (
          <View style={{ gap: theme.space[3] }}>
            {list.map((g) => (
              <Checkbox key={g.id} checked={picked.has(g.id)} onCheckedChange={(v) => toggle(g.id, v)} label={g.name}
                description={g.member_ids.length ? tn(g.member_ids.length, "{n} aluno", "{n} alunos") : t("Nenhum aluno ainda")} />
            ))}
          </View>
        )}
        <View style={[styles.row, { gap: theme.space[2], alignItems: "flex-end" }]}>
          <View style={styles.flex}>
            <Field label={t("Novo grupo")} error={err}>
              {(f) => <Input {...f} value={name} onChangeText={setName} placeholder={t("Ex.: Turma das 6h")} maxLength={60} returnKeyType="done" onSubmitEditing={add} />}
            </Field>
          </View>
          <Button variant="secondary" icon={Plus} loading={create.isPending} disabled={!name.trim()} onPress={add}>{t("Criar")}</Button>
        </View>
      </View>
    </Dialog>
  );
}

/** The student's groups as chips (× leaves the group) + "Adicionar a um grupo". */
export function StudentGroups({ clubId, membershipId, studentName, groups }: {
  clubId: string; membershipId: string; studentName: string; groups: { id: string; name: string }[];
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const set = useSetAthleteGroups(clubId);
  const [open, setOpen] = useState(false);
  const save = (ids: string[], done?: () => void) => set.mutate({ membershipId, group_ids: ids }, {
    onSuccess: (r) => { toast.success(t("Grupos atualizados"), r.groups.length ? r.groups.map((g) => g.name).join(", ") : t("{name} não está em nenhum grupo", { name: studentName })); done?.(); },
    onError: toast.error,
  });
  const ids = groups.map((g) => g.id);
  const chip = { height: theme.space[8] + theme.space[1], borderRadius: theme.radius.full, borderWidth: 1 } as const;
  return (
    <View style={[styles.wrap, { gap: theme.space["1.5"] }]}>
      <Text variant="labelSm" tone="muted" style={{ marginRight: theme.space[1] }}>{t("Grupos")}</Text>
      {groups.map((g) => (
        <View key={g.id} style={[styles.row, chip, { gap: theme.space[1], paddingLeft: theme.space[3], paddingRight: theme.space[1], borderColor: c.line, backgroundColor: c.surface }]}>
          <Text variant="labelSm" style={{ fontWeight: weight("semibold") }}>{g.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Tirar {name} do grupo {group}", { name: studentName, group: g.name })} disabled={set.isPending}
            onPress={() => save(ids.filter((x) => x !== g.id))} hitSlop={theme.space[2] + theme.space["0.5"]}
            style={({ pressed }) => [styles.center, { width: theme.space[6], height: theme.space[6], borderRadius: theme.radius.full, backgroundColor: pressed ? c.soft : "transparent" }]}>
            <X size={theme.size.iconSm - 2} color={c.fgMuted} aria-hidden />
          </Pressable>
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, chip, { gap: theme.space[1], paddingHorizontal: theme.space[3], borderStyle: "dashed", borderColor: c.lineStrong, backgroundColor: pressed ? c.soft : "transparent" }]}>
        <Plus size={theme.size.iconSm - 2} color={c.fgMuted} aria-hidden />
        <Text variant="labelSm" tone="muted" style={{ fontWeight: weight("semibold") }}>{groups.length ? t("Grupo") : t("Adicionar a um grupo")}</Text>
      </Pressable>
      <GroupPickerSheet clubId={clubId} open={open} onOpenChange={setOpen} title={t("Grupos de {name}", { name: studentName })}
        description={t("Marque os grupos deste aluno. Treinos e planilhas podem ser atribuídos a um grupo inteiro.")}
        selected={ids} saving={set.isPending} onSave={(next) => save(next, () => setOpen(false))} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
});

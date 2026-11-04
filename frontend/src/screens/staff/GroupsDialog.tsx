import { ArrowLeft, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useAthletes, useDeleteGroup, useGroups, useSaveGroup } from "@/api/members";
import type { Group } from "@/api/types";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, toast } from "@/ui";

/**
 * Manage groups: list → edit (name + members). `start` opens straight on one group, or on a new one (with
 * `member_ids` already ticked, e.g. the students selected on Alunos); saving it then closes the dialog.
 */
export function GroupsDialog({ clubId, open, onOpenChange, start }: { clubId: string; open: boolean; onOpenChange: (v: boolean) => void; start?: Partial<Group> | null }) {
  const groups = useGroups(clubId);
  const athletes = useAthletes(open ? clubId : undefined);
  const save = useSaveGroup(clubId);
  const del = useDeleteGroup(clubId);
  const [editing, setEditing] = useState<Partial<Group> | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const edit = (g: Partial<Group>) => { setEditing(g); setName(g.name ?? ""); setMembers(new Set(g.member_ids ?? [])); save.reset(); };
  const [seen, setSeen] = useState(false);
  if (open !== seen) { setSeen(open); if (open) { if (start) edit(start); else setEditing(null); } }
  const err = save.error instanceof ApiError ? save.error.fieldError("name") : null;
  const submit = () => save.mutate({ id: editing?.id, name, member_ids: [...members] }, { onSuccess: () => { toast.success(t("Grupo salvo"), name); if (start) onOpenChange(false); setEditing(null); }, onError: (e) => !(e instanceof ApiError && e.errors.length) && toast.error(e) });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setEditing(null); }} title={editing ? (editing.id ? t("Editar grupo") : t("Novo grupo")) : t("Grupos")}
      description={editing ? undefined : t("Agrupe alunos para atribuir treinos e planilhas de uma vez.")}
      footer={editing ? <><Button variant="secondary" icon={<ArrowLeft />} onClick={() => setEditing(null)}>{t("Voltar")}</Button><Button onClick={submit} loading={save.isPending}>{t("Salvar grupo")}</Button></> : <Button icon={<Plus />} onClick={() => edit({})}>{t("Novo grupo")}</Button>}>
      {editing ? (
        <div className="grid gap-4">
          <Field label={t("Nome do grupo")} error={err}>{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Maratona SP 2027")} invalid={!!err} />}</Field>
          <fieldset className="grid gap-1"><legend className="mb-2 rf-text-label-sm">{t("Alunos")} · {members.size}</legend>
            {(athletes.data ?? []).map((a) => (
              <label key={a.membership.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-soft">
                <input type="checkbox" className="size-[18px] accent-brand" checked={members.has(a.membership.id)} onChange={(e) => { const n = new Set(members); if (e.target.checked) n.add(a.membership.id); else n.delete(a.membership.id); setMembers(n); }} />
                <Avatar name={a.user.name} size={28} /><span className="font-medium">{a.user.name}</span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : (groups.data ?? []).length === 0 ? (
        <EmptyState icon={<Users />} title={t("Nenhum grupo ainda")}>{t("Ex.: Iniciantes, Maratona SP 2027, Turma das 6h.")}</EmptyState>
      ) : (
        <ul className="-mx-2 grid gap-0.5">
          {(groups.data ?? []).map((g) => (
            <li key={g.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-soft">
              <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><Users className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{g.name}</span><span className="text-sm text-fg-muted">{g.member_ids.length ? tn(g.member_ids.length, "{n} aluno", "{n} alunos") : t("Nenhum aluno ainda")}</span></span>
              <IconButton label={t("Editar")} onClick={() => edit(g)}><Pencil /></IconButton>
              <IconButton label={t("Excluir")} onClick={() => del.mutate(g.id, { onSuccess: () => toast.success(t("Grupo excluído")) })}><Trash2 /></IconButton>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * Groups for one student (W3 student page, O2 Membros): the groups as removable chips, "Adicionar a um grupo" opens
 * the picker (the club's groups as checkboxes + a new group by name, created and ticked at once). Saves through
 * PUT /athletes/{id}/groups, so it joins and leaves in one go.
 */
import { Plus, Users, X } from "lucide-react";
import { useState } from "react";
import { useGroups, useSaveGroup, useSetAthleteGroups } from "@/api/members";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { Button, Checkbox, Dialog, EmptyState, Field, Input, toast } from "@/ui";

/** Pick groups (checkboxes) and create one inline; `onSave` gets the chosen ids. */
export function GroupPickerDialog({ clubId, open, onOpenChange, title, description, selected, onSave, saving }: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string;
  selected: string[]; onSave: (ids: string[]) => void; saving?: boolean;
}) {
  const groups = useGroups(open ? clubId : undefined);
  const create = useSaveGroup(clubId);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [name, setName] = useState("");
  const [seen, setSeen] = useState(open);
  // Start from the student's groups each time the dialog opens.
  if (open !== seen) { setSeen(open); if (open) { setPicked(new Set(selected)); setName(""); create.reset(); } }
  const err = create.error instanceof ApiError ? create.error.fieldError("name") : null;
  const add = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, {
      onSuccess: (g) => { setPicked((p) => new Set(p).add(g.id)); setName(""); toast.success(t("Grupo criado"), g.name); },
      onError: (e) => !(e instanceof ApiError && e.errors.length) && toast.error(e),
    });
  };
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const list = groups.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button loading={saving} onClick={() => onSave([...picked])}>{t("Salvar")}</Button></>}>
      <div className="grid gap-4">
        {groups.isPending ? null : list.length === 0 ? (
          <EmptyState icon={<Users />} title={t("Nenhum grupo ainda")}>{t("Crie o primeiro abaixo. Ex.: Iniciantes, Maratona SP 2027, Turma das 6h.")}</EmptyState>
        ) : (
          <fieldset className="grid gap-1">
            <legend className="sr-only">{t("Grupos")}</legend>
            {list.map((g) => (
              <Checkbox key={g.id} className="rounded-md px-2 py-1.5 hover:bg-soft" checked={picked.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} label={g.name}
                description={g.member_ids.length ? tn(g.member_ids.length, "{n} aluno", "{n} alunos") : t("Nenhum aluno ainda")} />
            ))}
          </fieldset>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Field label={t("Novo grupo")} error={err} className="flex-1">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Turma das 6h")} maxLength={60} invalid={!!err} />}</Field>
          <Button type="submit" variant="secondary" icon={<Plus />} loading={create.isPending} disabled={!name.trim()}>{t("Criar")}</Button>
        </form>
      </div>
    </Dialog>
  );
}

/** The student's groups as chips (× leaves the group) + "Adicionar a um grupo". */
export function StudentGroups({ clubId, membershipId, studentName, groups, compact }: {
  clubId: string; membershipId: string; studentName: string; groups: { id: string; name: string }[]; compact?: boolean;
}) {
  const set = useSetAthleteGroups(clubId);
  const [open, setOpen] = useState(false);
  const save = (ids: string[], done?: () => void) => set.mutate({ membershipId, group_ids: ids }, {
    onSuccess: (r) => { toast.success(t("Grupos atualizados"), r.groups.length ? r.groups.map((g) => g.name).join(", ") : t("{name} não está em nenhum grupo", { name: studentName })); done?.(); },
    onError: toast.error,
  });
  const ids = groups.map((g) => g.id);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!compact && <span className="mr-1 text-sm font-semibold text-fg-muted">{t("Grupos")}</span>}
      {groups.map((g) => (
        <span key={g.id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1 text-[13px] font-semibold">
          {g.name}
          <button type="button" onClick={() => save(ids.filter((x) => x !== g.id))} disabled={set.isPending}
            className="grid size-5 place-items-center rounded-full text-fg-muted hover:bg-soft hover:text-fg focus-visible:outline-2 focus-visible:outline-brand-ring">
            <X className="size-3.5" aria-hidden /><span className="sr-only">{t("Tirar {name} do grupo {group}", { name: studentName, group: g.name })}</span>
          </button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[13px] font-semibold text-fg-muted hover:bg-soft hover:text-fg focus-visible:outline-2 focus-visible:outline-brand-ring">
        <Plus className="size-3.5" aria-hidden />{groups.length ? t("Grupo") : t("Adicionar a um grupo")}
      </button>
      <GroupPickerDialog clubId={clubId} open={open} onOpenChange={setOpen} title={t("Grupos de {name}", { name: studentName })}
        description={t("Marque os grupos deste aluno. Treinos e planilhas podem ser atribuídos a um grupo inteiro.")}
        selected={ids} saving={set.isPending} onSave={(next) => save(next, () => setOpen(false))} />
    </div>
  );
}

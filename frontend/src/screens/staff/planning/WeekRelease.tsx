/** W4 · week release (D-031): the week's state above the planning grid, and the dialog that releases it. */
import { Eye, EyeOff, Send } from "lucide-react";
import { useState } from "react";
import { useGroups } from "@/api/members";
import type { Club } from "@/api/types";
import { useReleaseWeek, useUndoRelease, useWeek } from "@/api/workouts";
import { t, tn } from "@/i18n";
import { addDays, dateTimeShort, dayMonth } from "@/lib/format";
import { Button, Checkbox, Dialog, Field, Segmented, Select, toast } from "@/ui";

export function WeekRelease({ club, monday }: { club: Club; monday: string }) {
  const weekly = club.release_mode === "weekly";
  const week = useWeek(club.id, monday, weekly);
  const undo = useUndoRelease(club.id);
  const [open, setOpen] = useState(false);
  const w = week.data;
  // A week that has started is always visible; immediate clubs have nothing to release.
  if (!weekly || !w || w.started) return null;
  const tz = club.timezone;
  if (w.released_at) {
    return (
      <div data-print="hide" role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-success-line bg-success-soft px-4 py-3 text-on-success-soft">
        <Eye className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm"><b>{t("Semana liberada")}</b> · {t("Os alunos veem os treinos desde {when}.", { when: dateTimeShort(w.released_at, tz) })}</p>
        <Button size="sm" variant="secondary" loading={undo.isPending}
          onClick={() => undo.mutate(monday, { onSuccess: () => toast.info(t("Liberação desfeita"), t("A semana voltou a ser rascunho.")), onError: toast.error })}>{t("Desfazer")}</Button>
      </div>
    );
  }
  const some = w.released_athlete_ids.length;
  return (
    <div data-print="hide" className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-3">
      <EyeOff className="size-5 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <b>{t("Rascunho")}</b>
          {" · "}{w.drafts ? tn(w.drafts, "{n} treino que os alunos ainda não veem", "{n} treinos que os alunos ainda não veem") : t("os alunos ainda não veem esta semana")}
          {some > 0 && <>{" · "}{tn(some, "já liberada para {n} aluno", "já liberada para {n} alunos")}</>}
        </p>
        <p className="text-fg-muted">{w.auto_release_at ? t("Liberação automática: {when}.", { when: dateTimeShort(w.auto_release_at, tz) }) : t("Sem liberação automática: libere quando estiver pronta.")}</p>
      </div>
      <Button size="sm" icon={<Send />} onClick={() => setOpen(true)}>{t("Liberar semana")}</Button>
      <ReleaseDialog club={club} monday={monday} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ReleaseDialog({ club, monday, open, onOpenChange }: { club: Club; monday: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const release = useReleaseWeek(club.id);
  const groups = useGroups(club.id);
  const [who, setWho] = useState<"all" | "group">("all");
  const [group, setGroup] = useState("");
  const [notify, setNotify] = useState(true);
  const range = `${dayMonth(monday)} – ${dayMonth(addDays(monday, 6))}`;
  const submit = () => release.mutate(
    { monday, notify, ...(who === "group" ? { group_id: group } : {}) },
    {
      onSuccess: () => { toast.success(t("Semana liberada"), notify ? t("Cada aluno com treinos recebeu um aviso.") : t("Os alunos já veem os treinos.")); onOpenChange(false); },
      onError: toast.error,
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title={t("Liberar a semana de {range}", { range })}
      description={t("Os alunos passam a ver os treinos desta semana no app e no calendário.")}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button><Button icon={<Send />} loading={release.isPending} disabled={who === "group" && !group} onClick={submit}>{t("Liberar")}</Button></>}>
      <div className="grid gap-4">
        <Segmented label={t("Para quem")} value={who} onChange={setWho} options={[{ value: "all", label: t("Todos os alunos") }, { value: "group", label: t("Um grupo") }]} className="w-fit" />
        {who === "group" && (
          <Field label={t("Grupo")}>{(id) => (
            <Select id={id} value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t("Escolha…")}</option>
              {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          )}</Field>
        )}
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label={t("Avisar os alunos")} description={t("Uma notificação por aluno com o resumo da semana.")} />
      </div>
    </Dialog>
  );
}

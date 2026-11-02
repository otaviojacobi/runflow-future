/** W7 · Planilhas (list). Route: /plans */
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, ClipboardList, MoreHorizontal, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useArchivePlan, useCreatePlan, usePlans } from "@/api/plans";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { ago, duration } from "@/lib/format";
import { Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Skeleton, Textarea, toast } from "@/ui";

export function PlansScreen() {
  const { club } = useClub();
  const navigate = useNavigate();
  const plans = usePlans(club?.id);
  const create = useCreatePlan(club?.id ?? "");
  const archive = useArchivePlan(club?.id ?? "");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState(8);
  const [desc, setDesc] = useState("");
  if (!club) return null;
  const err = create.error instanceof ApiError ? create.error : null;
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Planilhas")} subtitle={t("Planos de várias semanas para aplicar em alunos ou grupos.")} actions={<Button icon={<Plus />} onClick={() => setOpen(true)}>{t("Nova planilha")}</Button>} />
      {plans.isPending ? <div className="grid gap-3 sm:grid-cols-2">{[1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div> : !plans.data?.length ? (
        <Card><EmptyState icon={<ClipboardList />} title={t("Nenhuma planilha ainda")} action={<Button icon={<Plus />} onClick={() => setOpen(true)}>{t("Criar planilha")}</Button>}>{t("Ex.: Base 10 km em 8 semanas, Maratona em 16 semanas.")}</EmptyState></Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.data.map((p) => {
            const max = Math.max(1, ...p.weekly_duration_s);
            return (
              <li key={p.id} className="relative">
                <Link to="/plans/$id" params={{ id: p.id }} className="grid h-full gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm hover:shadow-md">
                  <div className="pr-8"><div className="font-semibold">{p.name}</div><div className="text-sm text-fg-muted">{tn(p.weeks, "{n} semana", "{n} semanas")} · {tn(p.items_count, "{n} treino", "{n} treinos")}</div></div>
                  <div className="flex h-12 items-end gap-[2px]" role="img" aria-label={t("Volume por semana")}>{p.weekly_duration_s.map((s, i) => <span key={i} className="flex-1 rounded-t-[3px] bg-brand-text" style={{ height: `${Math.max(4, (s / max) * 100)}%`, opacity: s ? 1 : 0.2 }} title={t("Semana {n}: {d}", { n: i + 1, d: duration(s) })} />)}</div>
                  <div className="flex items-center justify-between text-xs text-fg-muted"><span className="flex items-center gap-1"><Users className="size-3.5" />{tn(p.active_assignments, "{n} aluno usando", "{n} alunos usando")}</span><span>{t("editada {when}", { when: ago(p.updated_at) })}</span></div>
                </Link>
                <div className="absolute right-2 top-2"><Menu trigger={<IconButton size="sm" label={t("Ações")}><MoreHorizontal /></IconButton>} items={[{ label: t("Arquivar"), icon: <Archive />, danger: true, onSelect: () => archive.mutate(p.id, { onSuccess: () => toast.success(t("Planilha arquivada")) }) }]} /></div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen} size="sm" title={t("Nova planilha")}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t("Cancelar")}</Button><Button loading={create.isPending} onClick={() => create.mutate({ name, weeks, description: desc }, { onSuccess: (p) => { setOpen(false); navigate({ to: "/plans/$id", params: { id: p.id } }); }, onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } })}>{t("Criar e editar")}</Button></>}>
        <div className="grid gap-4">
          <Field label={t("Nome")} error={err?.fieldError("name")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Meia maratona em 12 semanas")} autoFocus />}</Field>
          <Field label={t("Duração (semanas)")} error={err?.fieldError("weeks")}>{(id) => <Input id={id} type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />}</Field>
          <Field label={t("Descrição")} optional>{(id) => <Textarea id={id} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </div>
  );
}

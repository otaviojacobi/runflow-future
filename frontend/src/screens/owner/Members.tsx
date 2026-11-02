/** O2 · Membros e convites: trainers, students (suspend/remove), invite links. Route: /club/members */
import { Link } from "@tanstack/react-router";
import { Ban, Copy, MessageCircle, MoreHorizontal, Plus, RotateCcw, Ticket, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { useCreateInvite, useInvites, useRevokeInvite } from "@/api/clubs";
import { useMembers, useRemoveMember, useUpdateMember } from "@/api/members";
import type { Member } from "@/api/types";
import { whatsappLink } from "@/components/club/InviteShare";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Menu, PageHeader, ProgressBar, Select, Skeleton, Tabs, toast } from "@/ui";
import { ROLE_LABEL } from "../clubs/Clubs";

export function MembersScreen() {
  const { club, ctx } = useClub();
  const staff = useMembers(club?.id, { role: "owner,trainer" });
  const students = useMembers(club?.id, { role: "student" });
  const invites = useInvites(club?.id);
  const update = useUpdateMember(club?.id ?? "");
  const remove = useRemoveMember(club?.id ?? "");
  const revoke = useRevokeInvite(club?.id ?? "");
  const create = useCreateInvite(club?.id ?? "");
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [newInvite, setNewInvite] = useState(false);
  const [role, setRole] = useState<"student" | "trainer">("student");
  const [maxUses, setMaxUses] = useState("");
  if (!club || !ctx) return null;
  const sub = ctx.subscription;
  const me = ctx.membership.id;

  const row = (m: Member) => (
    <li key={m.membership.id} className="flex items-center gap-3 px-4 py-3">
      <Avatar name={m.user.name} src={m.user.avatar_url} size={36} />
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.user.name}{m.membership.id === me && <span className="font-normal text-fg-muted"> ({t("você")})</span>}</span><span className="block truncate text-sm text-fg-muted">{m.user.email}</span></span>
      {m.membership.status === "suspended" ? <Badge tone="warning">{t("Suspenso")}</Badge> : <Badge tone={m.membership.role === "owner" ? "brand" : "neutral"}>{t(ROLE_LABEL[m.membership.role])}</Badge>}
      <span className="hidden w-24 text-right text-xs text-fg-muted sm:block">{t("desde {when}", { when: ago(m.membership.joined_at) })}</span>
      {m.membership.id !== me ? (
        <Menu trigger={<IconButton label={t("Ações para {name}", { name: m.user.name })}><MoreHorizontal /></IconButton>} items={[
          ...(m.membership.role === "student"
            ? [m.membership.status === "suspended"
              ? { label: t("Reativar acesso"), icon: <RotateCcw />, onSelect: () => update.mutate({ id: m.membership.id, status: "active" }, { onSuccess: () => toast.success(t("Acesso reativado")), onError: toast.error }) }
              : { label: t("Suspender acesso"), icon: <Ban />, onSelect: () => update.mutate({ id: m.membership.id, status: "suspended" }, { onSuccess: () => toast.success(t("Acesso suspenso"), t("O aluno não vê mais os treinos e não conta no plano.")), onError: toast.error }) }]
            : m.membership.role === "trainer" ? [{ label: t("Tornar gestor(a)"), icon: <Plus />, onSelect: () => update.mutate({ id: m.membership.id, role: "owner" }, { onSuccess: () => toast.success(t("Agora é gestor(a)")), onError: toast.error }) }] : []),
          "separator",
          { label: t("Remover do clube"), icon: <UserMinus />, danger: true, onSelect: () => setConfirm(m) },
        ]} />
      ) : <span className="w-10" />}
    </li>
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <PageHeader title={t("Membros e convites")} subtitle={t("Quem participa do {club} e os links para entrar.", { club: club.name })} actions={<Button icon={<Plus />} onClick={() => setNewInvite(true)}>{t("Novo link de convite")}</Button>} />
      {sub && (
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-48 flex-1"><div className="flex items-baseline justify-between text-sm"><span className="font-semibold">{t("{n} de {limit} alunos", { n: sub.active_students, limit: sub.student_limit })}</span><span className="text-fg-muted">{t("Plano {plan}", { plan: sub.plan === "free" ? "Free" : sub.plan === "pro" ? "Pro" : "Max" })}</span></div><ProgressBar className="mt-2" value={sub.active_students} max={sub.student_limit} tone={sub.active_students >= sub.student_limit ? "danger" : sub.active_students / sub.student_limit >= 0.8 ? "warning" : "brand"} label={t("Alunos no plano")} /></div>
          {sub.plan === "free" && <Link to="/club/billing" className="text-sm font-semibold text-brand-text hover:underline">{t("Ver planos")}</Link>}
        </Card>
      )}
      <Tabs.Root defaultValue="students">
        <Tabs.List>
          <Tabs.Trigger value="students">{t("Alunos")} {students.data && `· ${students.data.length}`}</Tabs.Trigger>
          <Tabs.Trigger value="staff">{t("Equipe")} {staff.data && `· ${staff.data.length}`}</Tabs.Trigger>
          <Tabs.Trigger value="invites">{t("Convites")} {invites.data && `· ${invites.data.length}`}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="students">
          <Card>{students.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : students.data?.length ? <ul className="divide-y divide-line-subtle">{students.data.map(row)}</ul> : <EmptyState icon={<Ticket />} title={t("Nenhum aluno ainda")}>{t("Crie um link de convite e mande no WhatsApp.")}</EmptyState>}</Card>
        </Tabs.Content>
        <Tabs.Content value="staff"><Card><ul className="divide-y divide-line-subtle">{(staff.data ?? []).map(row)}</ul></Card></Tabs.Content>
        <Tabs.Content value="invites">
          <Card>
            <ul className="divide-y divide-line-subtle">
              {(invites.data ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><Ticket className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold">{i.role === "trainer" ? t("Link para treinadores") : t("Link para alunos")}</span><span className="block truncate font-mono text-xs text-fg-muted">{i.url.replace("https://", "")}</span></span>
                  <span className="text-sm text-fg-muted">{i.max_uses ? t("{n} de {max} usos", { n: i.uses, max: i.max_uses }) : tn(i.uses, "{n} uso", "{n} usos")}</span>
                  <IconButton label={t("Copiar link")} onClick={async () => { try { await navigator.clipboard.writeText(i.url); } catch { /* ignore */ } toast.success(t("Link copiado")); }}><Copy /></IconButton>
                  <a className="grid size-10 place-items-center rounded-md text-fg-muted hover:bg-soft hover:text-fg" href={whatsappLink(club.name, i.url, i.role)} target="_blank" rel="noreferrer" aria-label={t("Enviar no WhatsApp")} title={t("Enviar no WhatsApp")}><MessageCircle className="size-5" /></a>
                  <IconButton label={t("Revogar link")} onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.success(t("Link revogado"), t("Quem não entrou ainda vai precisar de um novo link.")) })}><Trash2 /></IconButton>
                </li>
              ))}
            </ul>
            {invites.data?.length === 0 && <EmptyState icon={<Ticket />} title={t("Nenhum link ativo")} action={<Button icon={<Plus />} onClick={() => setNewInvite(true)}>{t("Novo link de convite")}</Button>} />}
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} size="sm" title={t("Remover {name}?", { name: confirm?.user.name ?? "" })}
        description={confirm?.membership.role === "student" ? t("O aluno perde o acesso aos treinos do clube. O histórico fica guardado e ele pode voltar com um novo convite.") : t("A pessoa deixa de ver os alunos e os treinos do clube.")}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>{t("Cancelar")}</Button><Button variant="danger" loading={remove.isPending} onClick={() => confirm && remove.mutate(confirm.membership.id, { onSuccess: () => { toast.success(t("Membro removido")); setConfirm(null); }, onError: toast.error })}>{t("Remover")}</Button></>} />
      <Dialog open={newInvite} onOpenChange={setNewInvite} size="sm" title={t("Novo link de convite")}
        footer={<><Button variant="secondary" onClick={() => setNewInvite(false)}>{t("Cancelar")}</Button><Button loading={create.isPending} onClick={() => create.mutate({ role, max_uses: maxUses ? Number(maxUses) : null }, { onSuccess: () => { setNewInvite(false); toast.success(t("Link criado")); }, onError: toast.error })}>{t("Criar link")}</Button></>}>
        <div className="grid gap-4">
          <Field label={t("Para quem")}>{(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value as "student" | "trainer")}><option value="student">{t("Alunos")}</option><option value="trainer">{t("Treinadores")}</option></Select>}</Field>
          <Field label={t("Limite de usos")} optional hint={t("Deixe em branco para um link do clube, sem limite.")}>{(id, d) => <Select id={id} aria-describedby={d} value={maxUses} onChange={(e) => setMaxUses(e.target.value)}><option value="">{t("Sem limite")}</option>{[1, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
        </div>
      </Dialog>
    </div>
  );
}

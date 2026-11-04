/** O2 · Membros e convites: trainers, students (suspend/remove), personal e-mail invites (D-023). Route: /club/members */
import { Link } from "@tanstack/react-router";
import { Ban, Copy, FileSpreadsheet, Mail, MoreHorizontal, Plus, RotateCcw, Send, Trash2, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { useInvites, useResendInvite, useRevokeInvite } from "@/api/clubs";
import { useGroups, useMembers, useRemoveMember, useSetAthleteGroups, useUpdateMember } from "@/api/members";
import type { Invitation, Member, Subscription } from "@/api/types";
import { GroupPickerDialog } from "@/components/club/GroupPicker";
import { InviteDialog } from "@/components/club/InviteDialog";
import { ImportStudentsDialog } from "@/components/ImportDialogs";
import { t, tn } from "@/i18n";
import { ROLE_LABEL, useClub } from "@/lib/club";
import { ago, fullDate, localDate } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, IconButton, Menu, PageHeader, ProgressBar, Skeleton, Tabs, toast, type Tone } from "@/ui";

export function MembersScreen() {
  const { club, ctx } = useClub();
  const staff = useMembers(club?.id, { role: "owner,trainer" });
  const students = useMembers(club?.id, { role: "student" });
  const invites = useInvites(club?.id);
  const update = useUpdateMember(club?.id ?? "");
  const remove = useRemoveMember(club?.id ?? "");
  const revoke = useRevokeInvite(club?.id ?? "");
  const resend = useResendInvite(club?.id ?? "");
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [newInvite, setNewInvite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [grouping, setGrouping] = useState<Member | null>(null);
  const groups = useGroups(club?.id);
  const setGroups = useSetAthleteGroups(club?.id ?? "");
  if (!club || !ctx) return null;
  const sub = ctx.subscription;
  const me = ctx.membership.id;
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name;
  const saveGroups = (ids: string[]) => grouping && setGroups.mutate({ membershipId: grouping.membership.id, group_ids: ids }, {
    onSuccess: (r) => { toast.success(t("Grupos atualizados"), r.groups.map((g) => g.name).join(", ") || t("{name} não está em nenhum grupo", { name: grouping.user.name.split(" ")[0] })); setGrouping(null); },
    onError: toast.error,
  });

  const row = (m: Member) => (
    <li key={m.membership.id} className="flex items-center gap-3 px-4 py-3">
      <Avatar name={m.user.name} src={m.user.avatar_url} size={36} />
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.user.name}{m.membership.id === me && <span className="font-normal text-fg-muted"> ({t("você")})</span>}</span><span className="block truncate text-sm text-fg-muted">{m.user.email}</span>
        {m.membership.role === "student" && m.group_ids.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{m.group_ids.map((g) => groupName(g) && <Badge key={g} className="text-[11px]">{groupName(g)}</Badge>)}</span>}</span>
      {m.membership.status === "suspended" ? <Badge tone="warning">{t("Suspenso")}</Badge> : <Badge tone={m.membership.role === "owner" ? "brand" : "neutral"}>{t(ROLE_LABEL[m.membership.role])}</Badge>}
      <span className="hidden w-24 text-right text-xs text-fg-muted sm:block">{t("desde {when}", { when: ago(m.membership.joined_at) })}</span>
      {m.membership.id !== me ? (
        <Menu trigger={<IconButton label={t("Ações para {name}", { name: m.user.name })}><MoreHorizontal /></IconButton>} items={[
          ...(m.membership.role === "student" && m.membership.status === "active" ? [{ label: t("Grupos…"), icon: <Users />, onSelect: () => setGrouping(m) }] : []),
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
      <PageHeader title={t("Membros e convites")} subtitle={t("Quem participa do {club}. Só entra quem recebe um convite por e-mail.", { club: club.name })} actions={<><Button variant="secondary" icon={<FileSpreadsheet />} onClick={() => setImporting(true)}>{t("Importar planilha")}</Button><Button icon={<Mail />} onClick={() => setNewInvite(true)}>{t("Convidar por e-mail")}</Button></>} />
      <ImportStudentsDialog club={club} open={importing} onOpenChange={setImporting} />
      <GroupPickerDialog clubId={club.id} open={!!grouping} onOpenChange={(v) => !v && setGrouping(null)}
        title={grouping ? t("Grupos de {name}", { name: grouping.user.name.split(" ")[0] }) : t("Grupos")}
        description={t("Marque os grupos deste aluno. Treinos e planilhas podem ser atribuídos a um grupo inteiro.")}
        selected={grouping?.group_ids ?? []} saving={setGroups.isPending} onSave={saveGroups} />
      {sub && (
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <SeatsSummary sub={sub} />
          {sub.plan !== "max" && <Link to="/club/billing" className="text-sm font-semibold text-brand-text hover:underline">{t("Ver planos")}</Link>}
        </Card>
      )}
      <Tabs.Root defaultValue="students">
        <Tabs.List>
          <Tabs.Trigger value="students">{t("Alunos")} {students.data && `· ${students.data.length}`}</Tabs.Trigger>
          <Tabs.Trigger value="staff">{t("Equipe")} {staff.data && `· ${staff.data.length}`}</Tabs.Trigger>
          <Tabs.Trigger value="invites">{t("Convites")} {invites.data && `· ${invites.data.filter((i) => i.status === "pending").length}`}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="students">
          <Card>{students.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : students.data?.length ? <ul className="divide-y divide-line-subtle">{students.data.map(row)}</ul> : <EmptyState icon={<Mail />} title={t("Nenhum aluno ainda")}>{t("Convide os alunos por e-mail: cada um recebe o próprio convite.")}</EmptyState>}</Card>
        </Tabs.Content>
        <Tabs.Content value="staff"><Card><ul className="divide-y divide-line-subtle">{(staff.data ?? []).map(row)}</ul></Card></Tabs.Content>
        <Tabs.Content value="invites">
          <Card>
            {invites.data?.length ? <ul className="divide-y divide-line-subtle">{invites.data.map((i) => <InviteRow key={i.id} i={i} onResend={() => resend.mutate(i.id, { onSuccess: () => toast.success(t("Convite reenviado"), t("O link anterior parou de funcionar; o novo vale 7 dias.")), onError: toast.error })} onCancel={() => revoke.mutate(i.id, { onSuccess: () => toast.success(t("Convite cancelado"), t("O link não funciona mais.")) })} />)}</ul>
              : invites.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              : <EmptyState icon={<Mail />} title={t("Nenhum convite enviado")} action={<Button icon={<Mail />} onClick={() => setNewInvite(true)}>{t("Convidar por e-mail")}</Button>}>{t("Cada pessoa recebe um convite pessoal, que vale 7 dias.")}</EmptyState>}
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} size="sm" title={t("Remover {name}?", { name: confirm?.user.name ?? "" })}
        description={confirm?.membership.role === "student" ? t("O aluno perde o acesso aos treinos do clube. O histórico fica guardado e ele pode voltar com um novo convite.") : t("A pessoa deixa de ver os alunos e os treinos do clube.")}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>{t("Cancelar")}</Button><Button variant="danger" loading={remove.isPending} onClick={() => confirm && remove.mutate(confirm.membership.id, { onSuccess: () => { toast.success(t("Membro removido")); setConfirm(null); }, onError: toast.error })}>{t("Remover")}</Button></>} />
      <InviteDialog club={club} open={newInvite} onOpenChange={setNewInvite} />
    </div>
  );
}

const STATUS: Record<Invitation["status"], { label: string; tone: Tone }> = { pending: { label: "Aguardando", tone: "info" }, expired: { label: "Expirado", tone: "warning" }, accepted: { label: "Aceito", tone: "success" } };
function InviteRow({ i, onResend, onCancel }: { i: Invitation; onResend: () => void; onCancel: () => void }) {
  const st = STATUS[i.status];
  const when = i.status === "accepted" ? t("entrou {a}", { a: ago(i.accepted_at!) }) : i.status === "expired" ? t("expirou em {d}", { d: fullDate(localDate(i.expires_at)) }) : t("enviado {a} · vale até {d}", { a: ago(i.sent_at ?? i.created_at), d: fullDate(localDate(i.expires_at)) });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><Mail className="size-4" /></span>
      <span className="min-w-0 flex-1 basis-48">
        <span className="block truncate font-semibold">{i.name ? `${i.name} · ` : ""}{i.email}</span>
        <span className="block text-xs text-fg-muted">{t(ROLE_LABEL[i.role])} · {when}{i.send_count > 1 ? ` · ${t("enviado {n} vezes", { n: i.send_count })}` : ""}</span>
      </span>
      <Badge tone={st.tone}>{t(st.label)}</Badge>
      {i.status !== "accepted" && (
        <Menu trigger={<IconButton label={t("Ações do convite para {email}", { email: i.email })}><MoreHorizontal /></IconButton>} items={[
          { label: t("Reenviar convite"), icon: <Send />, onSelect: onResend },
          ...(i.status === "pending" ? [{ label: t("Copiar link"), icon: <Copy />, onSelect: async () => { try { await navigator.clipboard.writeText(i.url); toast.success(t("Link copiado"), t("Só funciona para {email}.", { email: i.email })); } catch { /* ignore */ } } }] : []),
          "separator",
          { label: t("Cancelar convite"), icon: <Trash2 />, danger: true, onSelect: onCancel },
        ]} />
      )}
    </li>
  );
}

/** Students and trainers against the plan's seats (D-043); Max has included seats instead of a limit. */
function SeatsSummary({ sub }: { sub: Subscription }) {
  const cap = sub.student_limit ?? sub.included_students;
  const pct = sub.active_students / Math.max(1, cap);
  const plan = sub.plan === "free" ? "Free" : sub.plan === "pro" ? "Pro" : "Max";
  return (
    <div className="min-w-48 flex-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{sub.student_limit === null ? t("{n} alunos ({limit} incluídos)", { n: sub.active_students, limit: cap }) : t("{n} de {limit} alunos", { n: sub.active_students, limit: cap })}</span>
        <span className="text-fg-muted">{sub.trainer_limit === null ? tn(sub.active_trainers, "{n} treinador", "{n} treinadores") : t("{n} de {limit} treinadores", { n: sub.active_trainers, limit: sub.trainer_limit })} · {t("Plano {plan}", { plan })}</span>
      </div>
      <ProgressBar className="mt-2" value={Math.min(sub.active_students, cap)} max={cap} tone={sub.student_limit === null ? "brand" : pct >= 1 ? "danger" : pct >= 0.8 ? "warning" : "brand"} label={t("Alunos no plano")} />
    </div>
  );
}

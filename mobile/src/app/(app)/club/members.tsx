/**
 * O2 · Membros e convites (owner; the web's screens/owner/Members.tsx): students, the team and the personal e-mail
 * invites (D-023), seats against the plan (D-043). Invite one by one (sheet) or many from a spreadsheet; resend, copy the
 * link or cancel an invite; suspend or reactivate a student, make a trainer an owner, remove someone.
 */
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useInvites, useResendInvite, useRevokeInvite } from "@/api/clubs";
import { useMembers, useRemoveMember, useUpdateMember } from "@/api/members";
import type { Invitation, Member } from "@/api/types";
import { SeatsSummary } from "@/components/billing/Seats";
import { ImportStudentsSheet } from "@/components/club/ImportStudents";
import { InviteForm } from "@/components/club/InviteForm";
import { t } from "@/i18n";
import { ROLE_LABEL, useClub } from "@/lib/club";
import { ago, fullDate, localDate } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, IconButton, Menu, Screen, Skeleton, Tabs, Text, toast, type Tone } from "@/ui";
import { Ban, Copy, Ellipsis, FileSpreadsheet, Mail, RotateCcw, Send, Trash2, UserMinus, UserPlus } from "@/ui/icons";

type Tab = "students" | "staff" | "invites";
const INVITE_STATUS: Record<Invitation["status"], { label: string; tone: Tone }> = {
  pending: { label: "Aguardando", tone: "info" }, expired: { label: "Expirado", tone: "warning" }, accepted: { label: "Aceito", tone: "success" },
};

export default function MembersScreen() {
  const { theme } = useTheme();
  const { club, ctx } = useClub();
  const [tab, setTab] = useState<Tab>("students");
  const staff = useMembers(club?.id, { role: "owner,trainer" });
  const students = useMembers(club?.id, { role: "student" });
  const invites = useInvites(club?.id);
  const update = useUpdateMember(club?.id ?? "");
  const remove = useRemoveMember(club?.id ?? "");
  const revoke = useRevokeInvite(club?.id ?? "");
  const resend = useResendInvite(club?.id ?? "");
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  if (!club || !ctx) return null;
  const sub = ctx.subscription;
  const me = ctx.membership.id;
  const pending = invites.data?.filter((i) => i.status === "pending").length;
  const refresh = async () => { setRefreshing(true); await Promise.all([staff.refetch(), students.refetch(), invites.refetch()]); setRefreshing(false); };

  const actionsFor = (m: Member) => [
    ...(m.membership.role === "student"
      ? [m.membership.status === "suspended"
        ? { label: t("Reativar acesso"), icon: RotateCcw, onSelect: () => update.mutate({ id: m.membership.id, status: "active" }, { onSuccess: () => toast.success(t("Acesso reativado")), onError: toast.error }) }
        : { label: t("Suspender acesso"), icon: Ban, onSelect: () => update.mutate({ id: m.membership.id, status: "suspended" }, { onSuccess: () => toast.success(t("Acesso suspenso"), t("O aluno não vê mais os treinos e não conta no plano.")), onError: toast.error }) }]
      : m.membership.role === "trainer" ? [{ label: t("Tornar gestor(a)"), icon: UserPlus, onSelect: () => update.mutate({ id: m.membership.id, role: "owner" }, { onSuccess: () => toast.success(t("Agora é gestor(a)")), onError: toast.error }) }] : []),
    "separator" as const,
    { label: t("Remover do clube"), icon: UserMinus, danger: true, onSelect: () => setConfirm(m) },
  ];

  const memberRow = (m: Member, i: number) => (
    <View key={m.membership.id} style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: i ? 1 : 0, borderTopColor: theme.color.lineSubtle }]}>
      <Avatar name={m.user.name} src={m.user.avatar_url} size={theme.space[10]} />
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={1}>{m.user.name}{m.membership.id === me ? <Text variant="bodyMd" tone="muted"> ({t("você")})</Text> : null}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{m.user.email} · {t("desde {when}", { when: ago(m.membership.joined_at) })}</Text>
      </View>
      {m.membership.status === "suspended" ? <Badge tone="warning">{t("Suspenso")}</Badge> : <Badge tone={m.membership.role === "owner" ? "brand" : "neutral"}>{t(ROLE_LABEL[m.membership.role])}</Badge>}
      {m.membership.id !== me ? (
        <Menu title={m.user.name} items={actionsFor(m)} trigger={(open) => <IconButton icon={Ellipsis} label={t("Ações para {name}", { name: m.user.name })} onPress={open} />} />
      ) : <View style={{ width: theme.size.touchMin }} />}
    </View>
  );

  const list = (q: typeof students, empty: React.ReactNode) =>
    q.isPending ? <View style={{ gap: theme.space[2] }}><Skeleton style={{ height: theme.space[12] }} /><Skeleton style={{ height: theme.space[12] }} /></View>
      : q.data?.length ? <Card style={{ paddingVertical: theme.space[1] }}>{q.data.map(memberRow)}</Card>
      : <Card>{empty}</Card>;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* The back bar says "Membros e convites". */}
      <Text tone="muted">{t("Quem participa do {club}. Só entra quem recebe um convite por e-mail.", { club: club.name })}</Text>
      <View style={{ gap: theme.space[2] }}>
        <Button icon={Mail} block onPress={() => setInviting(true)}>{t("Convidar por e-mail")}</Button>
        <Button variant="secondary" icon={FileSpreadsheet} block onPress={() => setImporting(true)}>{t("Importar planilha")}</Button>
      </View>
      {sub && (
        <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <SeatsSummary sub={sub} />
          {sub.plan !== "max" && <Button variant="ghost" size="sm" style={styles.start} onPress={() => router.push("/club/billing")}>{t("Ver planos")}</Button>}
        </Card>
      )}
      <Tabs<Tab> label={t("Membros")} value={tab} onValueChange={setTab} items={[
        { value: "students", label: students.data ? `${t("Alunos")} · ${students.data.length}` : t("Alunos") },
        { value: "staff", label: staff.data ? `${t("Equipe")} · ${staff.data.length}` : t("Equipe") },
        { value: "invites", label: pending !== undefined ? `${t("Convites")} · ${pending}` : t("Convites") },
      ]} />
      {tab === "students" && list(students, <EmptyState icon={Mail} title={t("Nenhum aluno ainda")}>{t("Convide os alunos por e-mail: cada um recebe o próprio convite.")}</EmptyState>)}
      {tab === "staff" && list(staff, null)}
      {tab === "invites" && (
        invites.isPending ? <Skeleton style={{ height: theme.space[20] }} />
          : invites.data?.length ? (
            <Card style={{ paddingVertical: theme.space[1] }}>
              {invites.data.map((i, n) => (
                <InviteRow key={i.id} i={i} first={n === 0}
                  onResend={() => resend.mutate(i.id, { onSuccess: () => toast.success(t("Convite reenviado"), t("O link anterior parou de funcionar; o novo vale 7 dias.")), onError: toast.error })}
                  onCancel={() => revoke.mutate(i.id, { onSuccess: () => toast.success(t("Convite cancelado"), t("O link não funciona mais.")), onError: toast.error })} />
              ))}
            </Card>
          ) : (
            <Card><EmptyState icon={Mail} title={t("Nenhum convite enviado")} action={<Button icon={Mail} onPress={() => setInviting(true)}>{t("Convidar por e-mail")}</Button>}>{t("Cada pessoa recebe um convite pessoal, que vale 7 dias.")}</EmptyState></Card>
          )
      )}

      <Dialog open={inviting} onOpenChange={setInviting} title={t("Convidar por e-mail")} description={t("Um convite pessoal por pessoa, válido por 7 dias.")}>
        {inviting && <InviteForm club={club} onSent={() => { setTab("invites"); }} />}
      </Dialog>
      <ImportStudentsSheet clubId={club.id} open={importing} onOpenChange={setImporting} />
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title={t("Remover {name}?", { name: confirm?.user.name ?? "" })}
        description={confirm?.membership.role === "student" ? t("O aluno perde o acesso aos treinos do clube. O histórico fica guardado e ele pode voltar com um novo convite.") : t("A pessoa deixa de ver os alunos e os treinos do clube.")}
        footer={<>
          <Button variant="secondary" size="lg" onPress={() => setConfirm(null)}>{t("Cancelar")}</Button>
          <Button variant="danger" size="lg" style={styles.flex} loading={remove.isPending}
            onPress={() => confirm && remove.mutate(confirm.membership.id, { onSuccess: () => { toast.success(t("Membro removido")); setConfirm(null); }, onError: toast.error })}>{t("Remover")}</Button>
        </>} />
    </Screen>
  );
}

function InviteRow({ i, first, onResend, onCancel }: { i: Invitation; first: boolean; onResend: () => void; onCancel: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const st = INVITE_STATUS[i.status];
  const day = (iso: string) => fullDate(localDate(iso));
  const when = i.status === "accepted" ? t("entrou {a}", { a: ago(i.accepted_at!) }) : i.status === "expired" ? t("expirou em {d}", { d: day(i.expires_at) }) : t("enviado {a} · vale até {d}", { a: ago(i.sent_at ?? i.created_at), d: day(i.expires_at) });
  const side = theme.space[8] + theme.space[1];
  return (
    <View style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: first ? 0 : 1, borderTopColor: c.lineSubtle }]}>
      <View style={[styles.center, { width: side, height: side, borderRadius: theme.radius.full, backgroundColor: c.brand.subtle }]}>
        <Mail size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />
      </View>
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={1}>{i.name ? `${i.name} · ` : ""}{i.email}</Text>
        <Text variant="caption" tone="muted">{t(ROLE_LABEL[i.role])} · {when}{i.send_count > 1 ? ` · ${t("enviado {n} vezes", { n: i.send_count })}` : ""}</Text>
      </View>
      <Badge tone={st.tone}>{t(st.label)}</Badge>
      {i.status !== "accepted" ? (
        <Menu title={i.email} trigger={(open) => <IconButton icon={Ellipsis} label={t("Ações do convite para {email}", { email: i.email })} onPress={open} />} items={[
          { label: t("Reenviar convite"), icon: Send, onSelect: onResend },
          ...(i.status === "pending" ? [{ label: t("Copiar link"), icon: Copy, onSelect: async () => { await Clipboard.setStringAsync(i.url); toast.success(t("Link copiado"), t("Só funciona para {email}.", { email: i.email })); } }] : []),
          "separator",
          { label: t("Cancelar convite"), icon: Trash2, danger: true, onSelect: onCancel },
        ]} />
      ) : <View style={{ width: theme.size.touchMin }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
});

/**
 * C1 · Privacidade e dados (LGPD, §5): per club, whether its trainers see the student's training data and Strava
 * activities (grant at once, revoke after a confirmation: the club loses access right away); the terms accepted;
 * the data export (a JSON file through the share sheet); leaving a club; deleting the account (type EXCLUIR).
 */
import { router } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { exportMyData, useConsents, useDeleteAccount, useGrantConsent, useLeaveClub, useRevokeConsent } from "@/api/account";
import { endSession } from "@/api/auth";
import { fetchMe, meKey } from "@/api/me";
import type { Consent, ConsentKind, MembershipContext } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { ConfirmDialog, Section } from "@/components/account/parts";
import { t } from "@/i18n";
import { activeMembership, homeFor, ROLE_LABEL, selectClub, useClub } from "@/lib/club";
import { shareTextFile } from "@/lib/files";
import { fullDate, localDate, today } from "@/lib/format";
import { queryClient } from "@/queryClient";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Field, Input, Screen, Skeleton, Switch, Text, toast } from "@/ui";
import { Download, LogOut, ShieldCheck, Trash2 } from "@/ui/icons";

/** The sharing switches (the web's texts, A4 and C1). */
const SHARES: { kind: ConsentKind; label: string; description: string }[] = [
  { kind: "share_training_data", label: "Compartilhar meus treinos", description: "Treinadores veem atividades, ritmo e frequência cardíaca dos treinos" },
  { kind: "share_strava", label: "Incluir atividades do Strava", description: "Exigido pelo Strava para mostrar seus dados a outras pessoas" },
];

export default function PrivacyScreen() {
  const { me } = useClub();
  return (
    <Screen>
      <Text tone="muted">{t("Você decide o que cada clube vê. Pela LGPD, pode baixar ou apagar seus dados quando quiser.")}</Text>
      {me && (
        <>
          <Sharing memberships={me.memberships} />
          <Clubs memberships={me.memberships} />
          <DeleteAccount />
        </>
      )}
    </Screen>
  );
}

function Sharing({ memberships }: { memberships: MembershipContext[] }) {
  const { theme } = useTheme();
  const consents = useConsents();
  const grant = useGrantConsent(), revoke = useRevokeConsent();
  const [pending, setPending] = useState<Consent | null>(null);
  const [exporting, setExporting] = useState(false);
  const active = (kind: ConsentKind, clubId: string | null) => consents.data?.find((c) => c.kind === kind && c.club_id === clubId && !c.revoked_at);
  const terms = active("terms", null), privacy = active("privacy", null);
  const studentClubs = memberships.filter((m) => m.membership.role === "student");
  const clubName = (id: string | null) => memberships.find((m) => m.club.id === id)?.club.name ?? "";
  const toggle = (kind: ConsentKind, clubId: string, on: boolean) => {
    const c = active(kind, clubId);
    if (on) grant.mutate({ kind, club_id: clubId }, { onSuccess: () => toast.success(t("Compartilhamento ativado")), onError: toast.error });
    else if (c) setPending(c);
  };
  const confirmRevoke = () => pending && revoke.mutate(pending.id, {
    onSuccess: () => { setPending(null); toast.success(t("Compartilhamento desativado"), t("O clube deixa de ver esses dados a partir de agora.")); },
    onError: (e) => { setPending(null); toast.error(e); },
  });
  const download = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const ok = await shareTextFile(`runflow-meus-dados-${today()}.json`, JSON.stringify(data, null, 2), "application/json", t("Seus dados do Runflow"));
      if (!ok) toast.info(t("Não dá para salvar arquivos neste aparelho"), t("Baixe seus dados pelo Runflow no navegador."));
      else if (Platform.OS === "web") toast.success(t("Seus dados foram baixados"));
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };
  const busy = (kind: ConsentKind, clubId: string) => (grant.isPending && grant.variables?.kind === kind && grant.variables.club_id === clubId);
  return (
    <>
      {studentClubs.length > 0 && (
        <Section title={t("O que o clube vê")} description={t("Vale só para os clubes em que você é aluno(a).")} padded={false}>
          {consents.isPending ? <Skeleton style={{ height: theme.space[20], margin: theme.space[3] }} /> : studentClubs.map((m, i) => (
            <View key={m.club.id} style={{ gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }}>
              <View style={[styles.row, { gap: theme.space[2] }]}>
                <ClubLogo club={m.club} branding={m.branding} size={theme.space[6]} />
                <Text variant="labelMd" accessibilityRole="header" numberOfLines={1} style={styles.flex}>{m.club.name}</Text>
              </View>
              {SHARES.map((s) => (
                <Switch key={s.kind} label={t(s.label)} description={t(s.description)} checked={!!active(s.kind, m.club.id)} disabled={busy(s.kind, m.club.id)}
                  onCheckedChange={(v) => toggle(s.kind, m.club.id, v)} />
              ))}
            </View>
          ))}
        </Section>
      )}
      <Section title={t("Seus dados")}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <ShieldCheck size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
          <Text variant="bodySm" tone="muted" style={styles.flex}>
            {terms && privacy ? t("Termos e política de privacidade aceitos em {d}", { d: fullDate(localDate(terms.granted_at)) }) : t("Termos e política de privacidade")}
          </Text>
        </View>
        <Text variant="bodySm">{t("Baixe uma cópia de tudo o que o Runflow guarda sobre você: perfil, clubes, consentimentos, atividades, treinos e notificações (arquivo JSON).")}</Text>
        <Button variant="secondary" icon={Download} loading={exporting} onPress={download}>{t("Baixar meus dados")}</Button>
      </Section>
      <ConfirmDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)} loading={revoke.isPending} onConfirm={confirmRevoke}
        title={t("Parar de compartilhar com {club}?", { club: clubName(pending?.club_id ?? null) })}
        description={pending?.kind === "share_strava"
          ? t("Os treinadores deixam de ver suas atividades do Strava a partir de agora. Você pode voltar a compartilhar quando quiser.")
          : t("Os treinadores deixam de ver suas atividades, ritmo e frequência cardíaca a partir de agora. Você pode voltar a compartilhar quando quiser.")}
        confirmLabel={t("Parar de compartilhar")} />
    </>
  );
}

function Clubs({ memberships }: { memberships: MembershipContext[] }) {
  const { theme } = useTheme();
  const { club } = useClub();
  const leave = useLeaveClub();
  const [target, setTarget] = useState<MembershipContext | null>(null);
  const confirm = () => target && leave.mutate(target.club.id, {
    onSuccess: async () => {
      const left = target;
      setTarget(null);
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 0 }).catch(() => null);
      toast.success(t("Você saiu de {club}", { club: left.club.name }));
      if (left.club.id === club?.id) {
        const next = activeMembership(me, null);
        selectClub(next);
        router.replace(homeFor(next?.membership.role));
      }
    },
    onError: (e) => { setTarget(null); toast.error(e); },
  });
  if (!memberships.length) return null;
  return (
    <Section title={t("Clubes")} padded={false}>
      {memberships.map((m, i) => (
        <View key={m.club.id} style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], minHeight: theme.size.touchMin + theme.space[4], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }]}>
          <ClubLogo club={m.club} branding={m.branding} size={theme.space[8] + theme.space[1]} />
          <View style={styles.flex}>
            <Text variant="labelMd" numberOfLines={1}>{m.club.name}</Text>
            <Text variant="bodySm" tone="muted" numberOfLines={2}>{t(ROLE_LABEL[m.membership.role])} · {t("desde {d}", { d: fullDate(localDate(m.membership.joined_at)) })}</Text>
          </View>
          <Button variant="ghost" size="sm" icon={LogOut} accessibilityLabel={t("Sair de {club}", { club: m.club.name })} onPress={() => setTarget(m)}>{t("Sair")}</Button>
        </View>
      ))}
      <ConfirmDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} loading={leave.isPending} onConfirm={confirm}
        title={t("Sair de {club}?", { club: target?.club.name ?? "" })}
        description={target?.membership.role === "student"
          ? t("Você deixa de receber treinos e o clube perde acesso aos seus dados. Suas atividades continuam na sua conta.")
          : t("Você perde acesso aos alunos e treinos do clube.")}
        confirmLabel={t("Sair do clube")} />
    </Section>
  );
}

function DeleteAccount() {
  const { theme } = useTheme();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const WORD = t("EXCLUIR");
  const run = () => del.mutate(undefined, {
    onSuccess: async () => {
      // The server already ended every session: forget this one without calling logout.
      await endSession();
      router.replace("/login");
      toast.success(t("Conta excluída"), t("Sentiremos sua falta."));
    },
    onError: (e) => { setOpen(false); toast.error(e); },
  });
  return (
    <Section title={t("Excluir conta")} danger description={t("Apaga seu perfil, atividades e conexões. Os clubes deixam de ver seus dados. Não dá para desfazer.")}>
      <Button variant="danger" icon={Trash2} onPress={() => setOpen(true)}>{t("Excluir minha conta")}</Button>
      <ConfirmDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setWord(""); }} title={t("Excluir sua conta?")} description={t("Digite {w} para confirmar.", { w: WORD })}
        confirmLabel={t("Excluir para sempre")} loading={del.isPending} disabled={word.trim().toUpperCase() !== WORD} onConfirm={run}>
        <Field label={t("Confirmação")}>
          {(a) => <Input {...a} value={word} onChangeText={setWord} placeholder={WORD} autoCapitalize="characters" autoCorrect={false} autoComplete="off" style={{ marginBottom: theme.space[1] }} />}
        </Field>
      </ConfirmDialog>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

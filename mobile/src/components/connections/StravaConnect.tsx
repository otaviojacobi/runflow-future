/**
 * "Conectar com Strava" for any screen (Atividades, Relógios e apps, the student's welcome): `StravaConnectPanel` = the
 * sharing statement the connection requires + Strava's official button (components/strava.tsx). It starts
 * lib/strava.ts from the current route; on the mock a stand-in consent sheet takes the place of Strava's page, like the
 * web app (components/account/StravaConnect.tsx there).
 *
 * Strava sharing (founder, 2026-11-04; D-011, endpoints.md § Strava sharing): the connection exists for the student's
 * trainers, so the statement starts checked and unchecking it disables the button; the API shares Strava with every
 * club where the person is a student when the connection is made, refuses anyone who isn't one, and disconnects a sync
 * no club can see any more (`disconnectsStrava` tells the warnings when that will happen).
 */
import { usePathname } from "expo-router";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { Consent, ConsentKind, MembershipContext } from "@/api/types";
import { StravaConnectButton } from "@/components/strava";
import { t } from "@/i18n";
import { useSession } from "@/lib/session";
import { connectStrava, finishStrava } from "@/lib/strava";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Checkbox, Dialog, Text, toast } from "@/ui";
import { Check } from "@/ui/icons";

/** The clubs where the person is an active student: the ones a Strava connection is shared with. */
export const studentClubs = (memberships: MembershipContext[]) =>
  memberships.filter((m) => m.membership.role === "student" && m.membership.status === "active");

/** "Pace Forte", "Pace Forte e Equipe Maré", "A, B e C". */
const names = (ms: MembershipContext[]) => {
  const n = ms.map((m) => m.club.name);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} ${t("e")} ${n[n.length - 1]}` : (n[0] ?? "");
};

/**
 * Whether ending this sharing (a consent revoked, or leaving the club when `kind` is absent) leaves no club seeing the
 * Strava sync: the API then disconnects Strava, and the warning says so.
 */
export function disconnectsStrava(p: { connected: boolean; consents: Consent[] | undefined; memberships: MembershipContext[]; clubId: string; kind?: ConsentKind }) {
  if (!p.connected) return false;
  const has = (club: string, kind: ConsentKind) => !!p.consents?.some((c) => c.kind === kind && c.club_id === club && !c.revoked_at);
  const ending = (club: string) => club === p.clubId && (p.kind === undefined || p.kind === "share_training_data" || p.kind === "share_strava");
  return !studentClubs(p.memberships).some((m) => !ending(m.club.id) && has(m.club.id, "share_training_data") && has(m.club.id, "share_strava"));
}
export const disconnectWarning = () => t("Isso desconecta o Strava: as atividades sincronizadas são apagadas do Runflow e seus treinadores deixam de vê-las. Você pode conectar de novo quando quiser.");

/** The statement, Strava's official button and the mock's sheet; for anyone who isn't a student, the reason instead. */
export function StravaConnectPanel({ onConnected, style }: { onConnected?: () => void; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const { me } = useSession();
  const [share, setShare] = useState(true);
  const { connect, busy, mockSheet } = useStravaConnect(onConnected);
  const clubs = studentClubs(me?.memberships ?? []);
  if (!clubs.length) {
    return <Text variant="bodySm" tone="muted" style={style}>{t("Entre em um clube como aluno para conectar o Strava: a conexão existe para os seus treinadores acompanharem seus treinos.")}</Text>;
  }
  return (
    <View style={[{ gap: theme.space[4] }, style]}>
      <Checkbox checked={share} onCheckedChange={setShare}
        label={t("Compartilhar as atividades do Strava com os treinadores do {club}", { club: names(clubs) })}
        description={share ? t("O Strava exige o seu consentimento explícito para isso.") : t("A conexão com o Strava existe para os seus treinadores acompanharem seus treinos.")} />
      <StravaConnectButton loading={busy} disabled={!share} onPress={() => void connect()} />
      {mockSheet}
    </View>
  );
}

/** Starts the connection from the current screen; the mock's stand-in consent comes back as `mockState`. */
export function useStravaConnect(onConnected?: () => void) {
  const from = usePathname();
  const [busy, setBusy] = useState(false);
  const [mockState, setMockState] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true);
    try {
      const r = await connectStrava(from);
      if (r.result === "mock") setMockState(r.state);
      else if (r.result === "connected") onConnected?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const [finishing, setFinishing] = useState(false);
  const authorizeMock = async () => {
    if (!mockState) return;
    setFinishing(true);
    try {
      await finishStrava({ code: "mock-code", state: mockState });
      setMockState(null);
      onConnected?.();
    } catch {
      // finishStrava showed the API's error.
    } finally {
      setFinishing(false);
    }
  };
  const mockSheet = (
    <Dialog open={mockState !== null} onOpenChange={(v) => { if (!v) setMockState(null); }} title={t("Autorizar o Runflow no Strava")}
      description={t("Simulação: no app real, esta é a página do Strava.")}
      footer={<>
        <Button variant="secondary" size="lg" onPress={() => setMockState(null)}>{t("Cancelar")}</Button>
        <Button size="lg" loading={finishing} onPress={() => void authorizeMock()} style={styles.flex}>{t("Autorizar")}</Button>
      </>}>
      <MockScopes />
    </Dialog>
  );
  return { connect, busy, mockSheet };
}

function MockScopes() {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={{ gap: theme.space[2] }}>
      {[t("Ler suas atividades, inclusive as privadas"), t("Ler seu perfil público")].map((s) => (
        <View key={s} style={[styles.row, { gap: theme.space[2] }]}>
          <Check size={theme.size.iconSm} color={c.success.text} aria-hidden />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

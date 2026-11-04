/**
 * A4 · Boas-vindas do aluno (the web's screens/onboarding/Welcome.tsx), right after accepting an invite: LGPD consent
 * to share training data with the club's trainers → full name and basics → connect Strava (with its own explicit
 * consent, root.md §5) → done. No goal step (D-035). In the club's colors: the student has joined.
 */
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnections, useConsents, useGrantConsent, useUpdateMe } from "@/api/account";
import { ClubLogo } from "@/components/brand";
import { brToIso, isoToBr, maskDate } from "@/components/account/inputs";
import { StravaConnectPanel } from "@/components/connections/StravaConnect";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { clubColors, useClub } from "@/lib/club";
import { useSession } from "@/lib/session";
import { ThemeScope, useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Checkbox, Field, Input, ProgressBar, Screen, Skeleton, Text, toast } from "@/ui";
import { Activity, Check, ShieldCheck, Sparkles, type Icon } from "@/ui/icons";

const TOTAL = 3;
const home = () => router.replace("/today");

export default function WelcomeRoute() {
  const { signedIn } = useSession();
  const { ctx } = useClub();
  if (!signedIn) return <Redirect href={{ pathname: "/login", params: { redirect: "/welcome" } }} />;
  if (!ctx) return <Redirect href="/clubs" />;
  return <ThemeScope club={clubColors(ctx.branding)}><Welcome /></ThemeScope>;
}

function Welcome() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { me, club, ctx } = useClub();
  const [step, setStep] = useState(1);
  if (!me || !club || !ctx) return null;
  const header = (
    <View style={{ paddingTop: insets.top + theme.space[3], paddingHorizontal: theme.space[4], paddingBottom: theme.space[3], gap: theme.space[3], backgroundColor: theme.color.canvas }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <ClubLogo club={club} branding={ctx.branding} size={theme.space[10]} />
        <View style={styles.flex}>
          <Text variant="labelMd" numberOfLines={1}>{club.name}</Text>
          {step <= TOTAL && <Text variant="caption" tone="muted">{t("Passo {n} de {total}", { n: step, total: TOTAL })}</Text>}
        </View>
        {step > 1 && step <= TOTAL && <Button variant="ghost" size="sm" onPress={home}>{t("Pular")}</Button>}
      </View>
      {step <= TOTAL && <ProgressBar value={step} max={TOTAL} label={t("Progresso das boas-vindas")} />}
    </View>
  );
  return (
    <Screen header={header} insetBottom>
      {step === 1 && <StepConsent clubId={club.id} clubName={club.name} onDone={() => setStep(2)} />}
      {step === 2 && <StepProfile onDone={() => setStep(3)} />}
      {step === 3 && <StepStrava clubId={club.id} clubName={club.name} onDone={() => setStep(4)} />}
      {step === 4 && <StepDone first={me.user.name.split(" ")[0] ?? ""} professor={club.trainer_label === "professor"} />}
    </Screen>
  );
}

function Head({ icon: I, title, text }: { icon?: Icon; title: string; text: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const side = theme.space[10] + theme.space[1];
  return (
    <View style={{ gap: theme.space[2] }}>
      {I && (
        <View style={[styles.center, { width: side, height: side, borderRadius: theme.radius.full, backgroundColor: c.brand.subtle }]}>
          <I size={theme.size.iconLg} color={c.brand.subtleFg} aria-hidden />
        </View>
      )}
      <Text variant="displaySm" accessibilityRole="header">{title}</Text>
      <Text tone="muted">{text}</Text>
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space["1.5"] }}>
      {items.map((x) => (
        <View key={x} style={[styles.row, styles.top, { gap: theme.space[2] }]}>
          <Check size={theme.size.iconSm} color={theme.color.success.text} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{x}</Text>
        </View>
      ))}
    </View>
  );
}

function StepConsent({ clubId, clubName, onDone }: { clubId: string; clubName: string; onDone: () => void }) {
  const { theme } = useTheme();
  const [agree, setAgree] = useState(true);
  const consent = useGrantConsent();
  return (
    <>
      <Head icon={ShieldCheck} title={t("Seus dados, sob seu controle")} text={t("Para o {club} montar e acompanhar seus treinos, os treinadores precisam ver alguns dados seus.", { club: clubName })} />
      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Text variant="labelMd">{t("Os treinadores do clube vão ver:")}</Text>
        <Bullets items={[
          t("Seus treinos planejados, se você fez e como se sentiu"),
          t("Atividades sincronizadas: distância, tempo, ritmo e frequência cardíaca"),
          t("Seu objetivo, nível e zonas de treino"),
          t("Os comentários que você deixar nos treinos"),
        ]} />
        <Text variant="bodySm" tone="muted">{t("Dados de saúde são sensíveis pela LGPD. Você pode revogar este consentimento a qualquer momento em Minha conta.")}</Text>
      </Card>
      <Checkbox checked={agree} onCheckedChange={setAgree} label={t("Concordo em compartilhar meus dados de treino com os treinadores do {club}", { club: clubName })} />
      <Button size="lg" block disabled={!agree} loading={consent.isPending}
        onPress={() => consent.mutate({ kind: "share_training_data", club_id: clubId }, { onSuccess: onDone, onError: toast.error })}>
        {t("Continuar")}
      </Button>
    </>
  );
}

function StepProfile({ onDone }: { onDone: () => void }) {
  const { theme } = useTheme();
  const { me } = useClub();
  const update = useUpdateMe();
  const [name, setName] = useState(me?.user.name ?? "");
  const [birth, setBirth] = useState(isoToBr(me?.user.birth_date));
  const [phone, setPhone] = useState(me?.user.phone ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const err = update.error instanceof ApiError ? update.error : null;
  const birthIso = birth ? brToIso(birth) : "";
  const first = name.trim().split(" ")[0] || me?.user.name.split(" ")[0] || "";
  /** "Nome completo": first and last name, so the club knows who is who. */
  const save = () => {
    setTried(true);
    const full = name.trim().replace(/\s+/g, " ");
    if (full.split(" ").length < 2) { setNameError(t("Informe nome e sobrenome.")); return; }
    setNameError(null);
    if (birthIso === null) return;
    update.mutate({ name: full, birth_date: birthIso || null, phone: phone.trim() || null }, {
      onSuccess: onDone,
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  return (
    <>
      <Head title={t("Prazer, {name}!", { name: first })} text={t("Confirme seus dados. Seu treinador usa isso para calcular zonas e ritmos.")} />
      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Field label={t("Nome completo")} error={nameError ?? err?.fieldError("name")}>
          {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Nome e sobrenome")} autoCapitalize="words" autoComplete="name" textContentType="name" />}
        </Field>
        <Field label={t("Data de nascimento")} optional hint={t("dd/mm/aaaa")}
          error={tried && birthIso === null ? t("Use o formato dd/mm/aaaa, como 14/09/1988.") : err?.fieldError("birth_date")}>
          {(a) => <Input {...a} value={birth} onChangeText={(v) => setBirth(maskDate(v))} placeholder="14/09/1988" keyboardType="number-pad" maxLength={10} autoComplete="birthdate-full" />}
        </Field>
        <Field label={t("WhatsApp")} optional hint={t("Para o treinador falar com você.")} error={err?.fieldError("phone")}>
          {(a) => <Input {...a} value={phone} onChangeText={setPhone} placeholder="(11) 98765-4321" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />}
        </Field>
      </Card>
      <Button size="lg" block loading={update.isPending} onPress={save}>{t("Continuar")}</Button>
    </>
  );
}

/**
 * Connecting shares Strava with every club where the student is (the API does it, D-011). Already connected (from
 * another club): Strava is shared with this club too when they continue, unless they uncheck it.
 */
function StepStrava({ clubId, clubName, onDone }: { clubId: string; clubName: string; onDone: () => void }) {
  const { theme } = useTheme();
  const consent = useGrantConsent();
  const conns = useConnections();
  const consents = useConsents();
  const [share, setShare] = useState(true);
  const connected = !!conns.data?.find((c) => c.provider === "strava")?.connection;
  const sharesHere = !!consents.data?.some((c) => c.kind === "share_strava" && c.club_id === clubId && !c.revoked_at);
  const finish = () => {
    if (connected && !sharesHere && share) consent.mutate({ kind: "share_strava", club_id: clubId }, { onSuccess: onDone, onError: toast.error });
    else onDone();
  };
  return (
    <>
      <Head title={t("Conecte seu relógio")} text={t("Treinou, sincronizou: seu treinador vê o resultado sem você precisar fazer nada.")} />
      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <View style={[styles.row, { gap: theme.space[3] }]}>
          <Activity size={theme.size.iconLg} color={theme.color.fg} aria-hidden />
          <View style={styles.flex}>
            <Text variant="labelMd">Strava</Text>
            <Text variant="bodySm" tone="muted">{connected ? t("Strava conectado. Suas atividades recentes estão chegando.") : t("Funciona com Garmin, Coros, Apple Watch e outros relógios que enviam ao Strava.")}</Text>
          </View>
        </View>
        {connected ? (
          sharesHere ? null : (
            <Checkbox checked={share} onCheckedChange={setShare} label={t("Compartilhar as atividades do Strava com os treinadores do {club}", { club: clubName })}
              description={t("O Strava exige o seu consentimento explícito para isso.")} />
          )
        ) : conns.isPending ? <Skeleton style={{ height: theme.space[12] }} /> : <StravaConnectPanel />}
      </Card>
      <Button size="lg" block variant={connected ? "primary" : "secondary"} loading={consent.isPending} onPress={finish}>{connected ? t("Continuar") : t("Agora não")}</Button>
    </>
  );
}

function StepDone({ first, professor }: { first: string; professor: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const badge = theme.space[16];
  return (
    <View style={[styles.centered, { gap: theme.space[5], paddingVertical: theme.space[8] }]}>
      <View style={[styles.center, { width: badge, height: badge, borderRadius: theme.radius.full, backgroundColor: c.accent.solid }]}>
        <Sparkles size={theme.size.iconLg + theme.space[2]} color={c.accent.onSolid} aria-hidden />
      </View>
      <Text variant="displaySm" accessibilityRole="header" style={styles.textCenter}>{t("Tudo certo, {name}!", { name: first })}</Text>
      <Text tone="muted" style={styles.textCenter}>
        {professor ? t("Seu professor já foi avisado. Assim que ele montar sua semana, os treinos aparecem em Hoje.") : t("Seu treinador já foi avisado. Assim que ele montar sua semana, os treinos aparecem em Hoje.")}
      </Text>
      <Button size="lg" block onPress={home}>{t("Ver meus treinos")}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  center: { alignItems: "center", justifyContent: "center" },
  centered: { alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  textCenter: { textAlign: "center" },
});

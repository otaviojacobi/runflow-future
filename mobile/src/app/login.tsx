/**
 * A2 · Entrar: Google (the native SDK, lib/google.ts) or a 6-digit code by e-mail (start → code → verify), in
 * Runflow's brand (D-024). "Sou aluno" / "Sou treinador" (`?perfil=`, remembered on this device) only changes the words
 * and where a person without a club lands: the invite guidance (/clubs) or the club wizard (/clubs/new). From an invite
 * the address comes pre-filled and locked (only it can accept, D-023, F36) and there's no switch. After signing in:
 * back to `redirect`, else home.
 */
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useEmailStart, useEmailVerify, useGoogleSignIn, useMockAccounts, usePublicConfig, type MockAccount } from "@/api/auth";
import type { Me } from "@/api/types";
import { GoogleIcon } from "@/components/GoogleIcon";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { activeMembership, homeFor, inviteTokenFrom, safeRedirect, selectClub } from "@/lib/club";
import { googleAvailable, googleIdToken } from "@/lib/google";
import { session } from "@/lib/session";
import { storage } from "@/lib/storage";
import { textStyle } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, Dialog, Field, Input, Screen, Segmented, Text, toast } from "@/ui";
import { ArrowLeft, ClipboardList, Footprints, Mail, Ticket } from "@/ui/icons";

const COOLDOWN_S = 30;
type SignInRole = "aluno" | "treinador";
const ROLE_KEY = "rf.signin-role";
const ROLE: Record<string, string> = { owner: "gestor(a)", trainer: "treinador(a)", student: "aluno(a)" };

export default function SignInScreen() {
  const params = useLocalSearchParams<{ redirect?: string; email?: string; perfil?: string }>();
  // Opened while already signed in (a stale link): go on. Signing in here navigates by itself.
  const [wasSignedIn] = useState(session.isSignedIn);
  const redirect = safeRedirect(params.redirect);
  if (wasSignedIn) return <Redirect href={redirect ?? "/"} />;
  const perfil = params.perfil === "aluno" || params.perfil === "treinador" ? params.perfil : null;
  return <SignIn redirect={redirect} invited={typeof params.email === "string" ? params.email : ""} perfil={perfil} />;
}

function SignIn({ redirect, invited, perfil }: { redirect: ReturnType<typeof safeRedirect>; invited: string; perfil: SignInRole | null }) {
  const { theme } = useTheme();
  const [step, setStep] = useState<"start" | "code">("start");
  const [role, setRoleState] = useState<SignInRole>(() => perfil ?? (storage.get(ROLE_KEY) === "treinador" ? "treinador" : "aluno"));
  const [email, setEmail] = useState(invited);
  const [locked, setLocked] = useState(!!invited);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [chooser, setChooser] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const start = useEmailStart();
  const verify = useEmailVerify();
  const google = useGoogleSignIn();
  const config = usePublicConfig();
  const googleId = config.data?.google_client_id ?? null;
  // No client id: maybe the mock, whose stand-in chooser plays Google's part (like the web app's).
  const mock = useMockAccounts(config.isSuccess && !googleId);
  const nativeGoogle = !!googleId && googleAvailable();
  const mockGoogle = !googleId && mock.isSuccess;
  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);
  const showSwitch = !invited;

  useEffect(() => {
    if (!cooldown) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const setRole = (r: SignInRole) => { setRoleState(r); storage.set(ROLE_KEY, r); };
  const done = (r: { me: Me; is_new: boolean }) => {
    const m = activeMembership(r.me, session.clubId());
    selectClub(m);
    if (showSwitch) storage.set(ROLE_KEY, role);
    if (r.is_new) toast.success(t("Conta criada. Bem-vindo(a) ao Runflow!"));
    // Back to where the person came from (an invite), else their home; without a club yet, a coach goes straight to
    // creating one and an athlete to the invite guidance.
    if (redirect) router.dismissTo(redirect);
    else router.replace(m ? homeFor(m.membership.role) : role === "treinador" ? "/clubs/new" : "/clubs");
  };
  const sendCode = () => {
    if (start.isPending) return;
    start.mutate(email.trim(), {
      onSuccess: (r) => {
        setStep("code"); setCode(""); setCooldown(COOLDOWN_S); setDevCode(r.dev_code ?? null); verify.reset();
        setTimeout(() => codeRef.current?.focus(), 100);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.retryAfter) setCooldown(e.retryAfter);
        // On the code step the field isn't there: say it in a toast, as the API wrote it.
        if (step === "code") toast.error(e);
      },
    });
  };
  const submitCode = (value: string) => {
    if (verify.isPending) return;
    verify.mutate({ email: email.trim(), code: value }, { onSuccess: done, onError: () => setCode("") });
  };
  const withGoogle = async () => {
    if (mockGoogle) return setChooser(true);
    if (!googleId || googleBusy) return;
    setGoogleBusy(true);
    const r = await googleIdToken(googleId);
    setGoogleBusy(false);
    if (r.ok) return google.mutate(r.idToken, { onSuccess: done, onError: toast.error });
    if (r.reason === "cancelled") return;
    // Said like an API error (pt-BR title + detail), though it comes from the phone.
    const fail = (title: string, detail: string) => toast.error(new ApiError(0, `google.${r.reason}`, title, detail));
    if (r.reason === "unconfigured") fail(t("O login com Google ainda não está configurado neste app"), t("Entre com o código por e-mail por enquanto."));
    else if (r.reason === "no_play_services") fail(t("Google Play indisponível"), t("Este aparelho não tem o Google Play Services. Entre com o código por e-mail."));
    else fail(t("Não foi possível entrar com o Google"), t("Tente de novo ou entre com o código por e-mail."));
  };
  const openInvite = () => {
    const token = inviteTokenFrom(inviteLink);
    if (!token) return setInviteError(t("Cole o link do convite que chegou no seu e-mail, como runflow.club/invite/…"));
    router.push({ pathname: "/invite/[token]", params: { token } });
  };
  const startError = step === "start" && start.error instanceof ApiError ? start.error.fieldError("email") ?? start.error.detail : null;
  const verifyError = verify.error instanceof ApiError ? verify.error.detail : verify.error ? t("Tente novamente em instantes.") : null;
  const title = !showSwitch ? t("Entrar no Runflow") : role === "treinador" ? t("Entre ou crie o seu clube grátis") : t("Entre para ver seus treinos");
  const lead = !showSwitch
    ? nativeGoogle || mockGoogle ? t("Use sua conta Google ou receba um código por e-mail. Sem senha para lembrar.") : t("Receba um código por e-mail. Sem senha para lembrar.")
    : role === "treinador" ? t("Treinador convidado por um clube? Use o e-mail do convite.") : t("Use o e-mail em que você recebeu o convite do seu clube. Ainda não tem convite? Peça ao seu treinador.");

  return (
    <Screen insetTop insetBottom contentStyle={styles.page}>
      <RunflowWordmark />
      <View style={[styles.body, { gap: theme.space[8] }]}>
        {step === "start" ? (
          <>
            <View style={{ gap: theme.space[5] }}>
              {showSwitch && (
                <Segmented label={t("Como você usa o Runflow")} value={role} onChange={setRole} style={styles.stretch}
                  options={[{ value: "aluno", label: t("Sou aluno"), icon: Footprints }, { value: "treinador", label: t("Sou treinador"), icon: ClipboardList }]} />
              )}
              <View style={{ gap: theme.space[2] }}>
                <Text variant="displaySm" accessibilityRole="header">{title}</Text>
                <Text tone="muted">{lead}</Text>
              </View>
            </View>
            <View style={{ gap: theme.space[3] }}>
              {(nativeGoogle || mockGoogle) && (
                <>
                  <Button variant="secondary" size="lg" block icon={GoogleIcon} loading={googleBusy || google.isPending} onPress={withGoogle}>{t("Continuar com Google")}</Button>
                  <View style={[styles.or, { gap: theme.space[3] }]}>
                    <View style={[styles.rule, { backgroundColor: theme.color.line }]} />
                    <Text variant="bodySm" tone="subtle">{t("ou")}</Text>
                    <View style={[styles.rule, { backgroundColor: theme.color.line }]} />
                  </View>
                </>
              )}
              <Field label={t("E-mail")} error={startError} hint={locked ? t("O convite é para este e-mail.") : null}>
                {(a) => (
                  <Input {...a} value={email} onChangeText={setEmail} readOnly={locked} placeholder="nome@email.com"
                    keyboardType="email-address" inputMode="email" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    returnKeyType="send" onSubmitEditing={sendCode} submitBehavior="blurAndSubmit" />
                )}
              </Field>
              {locked && <Button variant="ghost" size="sm" style={styles.start} onPress={() => setLocked(false)}>{t("Usar outro e-mail")}</Button>}
              <Button size="lg" block icon={Mail} loading={start.isPending} disabled={!email.trim()} onPress={sendCode}>{t("Receber código por e-mail")}</Button>
              {showSwitch && role === "aluno" && (inviteOpen ? (
                <Card style={{ padding: theme.space[4], gap: theme.space[3], marginTop: theme.space[2] }}>
                  <Field label={t("Link do convite")} error={inviteError} hint={t("Cole o link que chegou no seu e-mail.")}>
                    {(a) => (
                      <Input {...a} value={inviteLink} placeholder="runflow.club/invite/…" autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="go"
                        onSubmitEditing={openInvite} onChangeText={(v) => { setInviteLink(v); setInviteError(null); }} />
                    )}
                  </Field>
                  <Button variant="secondary" icon={Ticket} onPress={openInvite}>{t("Abrir convite")}</Button>
                </Card>
              ) : (
                <Button variant="ghost" size="sm" icon={Ticket} style={styles.start} onPress={() => setInviteOpen(true)}>{t("Tenho um link de convite")}</Button>
              ))}
            </View>
            <Text variant="bodySm" tone="muted">{t("Ao continuar, você aceita os Termos de uso e a Política de privacidade do Runflow.")}</Text>
            {__DEV__ && <Button variant="ghost" size="sm" style={styles.start} onPress={() => router.push("/dev/components")}>{t("Desenvolvimento: ver os componentes")}</Button>}
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" icon={ArrowLeft} style={[styles.start, { marginLeft: -theme.space[3] }]} onPress={() => { setStep("start"); start.reset(); verify.reset(); }}>{t("Usar outro e-mail")}</Button>
            <View style={{ gap: theme.space[2] }}>
              <Text variant="displaySm" accessibilityRole="header">{t("Digite o código")}</Text>
              <Text tone="muted">{t("Enviamos um código de 6 dígitos para {email}. Ele vale por 10 minutos.", { email: email.trim() })}</Text>
            </View>
            <View style={{ gap: theme.space[3] }}>
              <Field label={t("Código")} error={verifyError}>
                {(a) => (
                  <Input {...a} ref={codeRef} value={code} maxLength={6} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode"
                    style={[textStyle("metricLg"), styles.code, { minHeight: theme.size.controlLg + theme.space[2], letterSpacing: theme.space[2] }]}
                    onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 6); setCode(d); if (d.length === 6) submitCode(d); }} />
                )}
              </Field>
              <Button size="lg" block loading={verify.isPending} disabled={code.length !== 6} onPress={() => submitCode(code)}>{t("Entrar")}</Button>
            </View>
            <View style={[styles.resend, { gap: theme.space[2] }]}>
              <Text tone="muted">{t("Não recebeu?")}</Text>
              <Button variant="ghost" size="sm" disabled={cooldown > 0} loading={start.isPending} onPress={sendCode}>
                {cooldown >= 60 ? t("Reenviar em {m} min", { m: Math.ceil(cooldown / 60) }) : cooldown > 0 ? t("Reenviar em {s} s", { s: cooldown }) : t("Reenviar código")}
              </Button>
            </View>
            {devCode && (
              <Card style={{ padding: theme.space[3], backgroundColor: theme.color.info.subtle, borderColor: theme.color.info.border }}>
                <Text variant="bodySm" color={theme.color.info.subtleFg}>{t("Ambiente de desenvolvimento: o código é {code}.", { code: devCode })}</Text>
              </Card>
            )}
          </>
        )}
      </View>
      {mockGoogle && (
        <Dialog open={chooser} onOpenChange={setChooser} title={t("Escolha uma conta")} description={t("Modo de demonstração: escolha um perfil para entrar. No app real, esta é a janela do Google.")}>
          <View style={{ gap: theme.space[1] }}>
            {(mock.data ?? []).map((a) => <MockAccountRow key={a.email} a={a} disabled={google.isPending}
              onPress={() => google.mutate(a.email, { onSuccess: (r) => { setChooser(false); done(r); }, onError: toast.error })} />)}
          </View>
        </Dialog>
      )}
    </Screen>
  );
}

function MockAccountRow({ a, disabled, onPress }: { a: MockAccount; disabled: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  const first = a.roles[0];
  const sub = first ? `${t(ROLE[first.role] ?? first.role)} · ${first.club}${a.roles.length > 1 ? " " + t("e mais {n}", { n: a.roles.length - 1 }) : ""}` : a.email;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${a.name}, ${sub}`} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.account, { gap: theme.space[3], padding: theme.space[2], minHeight: theme.size.touchMin, borderRadius: theme.radius.md }, pressed && { backgroundColor: theme.color.soft }]}>
      <Avatar name={a.name} size={theme.size.touchMin - theme.space[2]} />
      <View style={styles.flex}>
        <Text variant="labelMd" numberOfLines={1}>{a.name}</Text>
        <Text variant="bodySm" tone="muted" numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  body: { flex: 1, justifyContent: "center" },
  start: { alignSelf: "flex-start" },
  stretch: { alignSelf: "stretch" },
  code: { textAlign: "center" },
  resend: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  or: { flexDirection: "row", alignItems: "center" },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  account: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

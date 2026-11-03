/**
 * A2 · Entrar: a 6-digit code by e-mail (start → code → verify), in Runflow's brand (D-024). From an invite the
 * address comes pre-filled and locked (only it can accept, D-023, F36). After signing in: back to `redirect`, else home.
 * Google sign-in needs the native SDK, which Expo Go doesn't have: it comes with the development build (X10).
 */
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useEmailStart, useEmailVerify } from "@/api/auth";
import type { Me } from "@/api/types";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { activeMembership, homeFor, safeRedirect, selectClub } from "@/lib/club";
import { session } from "@/lib/session";
import { textStyle } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Field, Input, Screen, Text, toast } from "@/ui";
import { ArrowLeft, Mail } from "@/ui/icons";

const COOLDOWN_S = 30;

export default function SignInScreen() {
  const params = useLocalSearchParams<{ redirect?: string; email?: string }>();
  // Opened while already signed in (a stale link): go on. Signing in here navigates by itself.
  const [wasSignedIn] = useState(session.isSignedIn);
  const redirect = safeRedirect(params.redirect);
  if (wasSignedIn) return <Redirect href={redirect ?? "/"} />;
  return <SignIn redirect={redirect} invited={typeof params.email === "string" ? params.email : ""} />;
}

function SignIn({ redirect, invited }: { redirect: ReturnType<typeof safeRedirect>; invited: string }) {
  const { theme } = useTheme();
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState(invited);
  const [locked, setLocked] = useState(!!invited);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const start = useEmailStart();
  const verify = useEmailVerify();
  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (!cooldown) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const done = (r: { me: Me; is_new: boolean }) => {
    const m = activeMembership(r.me, session.clubId());
    selectClub(m);
    if (r.is_new) toast.success(t("Conta criada. Bem-vindo(a) ao Runflow!"));
    // Back to where the person came from (an invite), else their home.
    if (redirect) router.dismissTo(redirect);
    else router.replace(homeFor(m?.membership.role));
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
  const startError = step === "start" && start.error instanceof ApiError ? start.error.fieldError("email") ?? start.error.detail : null;
  const verifyError = verify.error instanceof ApiError ? verify.error.detail : verify.error ? t("Tente novamente em instantes.") : null;

  return (
    <Screen insetTop insetBottom contentStyle={styles.page}>
      <RunflowWordmark />
      <View style={[styles.body, { gap: theme.space[8] }]}>
        {step === "start" ? (
          <>
            <View style={{ gap: theme.space[2] }}>
              <Text variant="displaySm" accessibilityRole="header">{t("Entrar no Runflow")}</Text>
              <Text tone="muted">{t("Receba um código por e-mail. Sem senha para lembrar.")}</Text>
            </View>
            <View style={{ gap: theme.space[3] }}>
              <Field label={t("E-mail")} error={startError} hint={locked ? t("O convite é para este e-mail.") : null}>
                {(a) => (
                  <Input {...a} value={email} onChangeText={setEmail} readOnly={locked} placeholder="nome@email.com"
                    keyboardType="email-address" inputMode="email" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    returnKeyType="send" onSubmitEditing={sendCode} submitBehavior="blurAndSubmit" />
                )}
              </Field>
              {locked && <Button variant="ghost" size="sm" style={styles.start} onPress={() => setLocked(false)}>{t("Usar outro e-mail")}</Button>}
              <Button size="lg" block icon={Mail} loading={start.isPending} disabled={!email.trim()} onPress={sendCode}>{t("Receber código por e-mail")}</Button>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  body: { flex: 1, justifyContent: "center" },
  start: { alignSelf: "flex-start" },
  code: { textAlign: "center" },
  resend: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

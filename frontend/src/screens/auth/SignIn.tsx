/**
 * A2 · Entrar: Google (mock chooser in dev) or a 6-digit code by e-mail. Route: /login?perfil=aluno|treinador.
 * "Sou aluno" / "Sou treinador" only changes the words and where a person without a club lands (the invite guidance or
 * the club wizard); the choice is remembered on this device. From an invite (e-mail pre-filled) there's no switch.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, CalendarCheck, ClipboardList, Footprints, Mail, Ticket, Users, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IS_MOCK, useEmailStart, useEmailVerify, useGoogleSignIn, useMockAccounts, usePublicConfig } from "@/api/auth";
import { GoogleButton } from "./GoogleButton";
import type { Me } from "@/api/types";
import { RunflowHomeLink } from "@/components/brand";
import { IntensityProfile } from "@/components/workout";
import type { Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { activeMembership, homeFor, inviteTokenFrom, selectClub } from "@/lib/club";
import { storage } from "@/lib/storage";
import { Avatar, Button, Dialog, Field, Input, Segmented, toast } from "@/ui";
import { GoogleIcon } from "./GoogleIcon";

const HERO: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" } } ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };
const ROLE: Record<string, string> = { owner: "gestor(a)", trainer: "treinador(a)", student: "aluno(a)" };
export type SignInRole = "aluno" | "treinador";
const ROLE_KEY = "rf.signin-role";
const savedRole = (): SignInRole => (storage.get(ROLE_KEY) === "treinador" ? "treinador" : "aluno");

export function SignInScreen() {
  const { redirect, email: invited, perfil } = useSearch({ from: "/login" });
  const navigate = useNavigate();
  const [role, setRoleState] = useState<SignInRole>(() => perfil ?? savedRole());
  const setRole = (r: SignInRole) => { setRoleState(r); storage.set(ROLE_KEY, r); };
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [step, setStep] = useState<"start" | "code">("start");
  // From an invite: the invited address, locked (only it can accept, D-023) unless the person chooses another.
  const [email, setEmail] = useState(invited ?? "");
  const [locked, setLocked] = useState(!!invited);
  const [code, setCode] = useState("");
  const [chooser, setChooser] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const start = useEmailStart();
  const verify = useEmailVerify();
  const google = useGoogleSignIn();
  const accounts = useMockAccounts(chooser);
  const config = usePublicConfig();
  const googleId = IS_MOCK ? null : config.data?.google_client_id ?? null;
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cooldown) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const done = (r: { me: Me; is_new: boolean }) => {
    const m = activeMembership(r.me);
    selectClub(m);
    if (!invited) storage.set(ROLE_KEY, role);
    if (r.is_new) toast.success(t("Conta criada. Bem-vindo(a) ao Runflow!"));
    // Without a club yet: a coach goes straight to creating one, an athlete to the invite guidance.
    const home = m ? homeFor(m.membership.role) : role === "treinador" ? "/clubs/new" : "/clubs";
    navigate({ to: redirect && redirect.startsWith("/") ? redirect : home, replace: true });
  };
  const openInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const token = inviteTokenFrom(inviteLink);
    if (!token) return setInviteError(t("Cole o link do convite que chegou no seu e-mail, como runflow.club/invite/…"));
    navigate({ to: "/invite/$token", params: { token } });
  };
  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    start.mutate(email, {
      onSuccess: () => { setStep("code"); setCode(""); setCooldown(30); setTimeout(() => codeRef.current?.focus(), 50); },
    });
  };
  const submitCode = (value: string) => verify.mutate({ email, code: value }, { onSuccess: done, onError: () => setCode("") });
  const emailError = start.error instanceof ApiError ? start.error.fieldError("email") ?? start.error.detail : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside data-theme="dark" className="relative hidden flex-col justify-between overflow-hidden bg-canvas p-12 text-fg lg:flex">
        <RunflowHomeLink />
        <div className="grid max-w-md gap-8">
          <h1 className="rf-text-display-lg">{t("Treinos que fluem.")}</h1>
          <p className="rf-text-body-lg text-fg-muted">{t("Planilhas, a semana do aluno e o relógio no mesmo lugar, com a cara do seu clube.")}</p>
          <div className="grid gap-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between text-sm"><span className="font-semibold">Intervalado 6×1 km</span><span className="text-fg-muted">≈ 59 min</span></div>
            <IntensityProfile structure={HERO} sport="run" height={56} />
          </div>
          <ul className="grid gap-3 text-fg-muted">
            <li className="flex items-center gap-3"><Zap className="size-5 text-accent-text" />{t("Monte um treino em segundos, do jeito que você escreve.")}</li>
            <li className="flex items-center gap-3"><CalendarCheck className="size-5 text-accent-text" />{t("O aluno treina e o Strava sincroniza sozinho.")}</li>
            <li className="flex items-center gap-3"><Users className="size-5 text-accent-text" />{t("Grátis para até 10 alunos.")}</li>
          </ul>
        </div>
        <p className="text-sm text-fg-subtle">runflow.club</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden"><RunflowHomeLink /></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
          {step === "start" ? (
            <>
              {!invited && (
                <Segmented label={t("Como você usa o Runflow")} size="lg" className="w-full" value={role} onChange={setRole}
                  options={[{ value: "aluno", label: t("Sou aluno"), icon: <Footprints /> }, { value: "treinador", label: t("Sou treinador"), icon: <ClipboardList /> }]} />
              )}
              <div className="grid gap-2">
                <h2 className="rf-text-display-sm">{invited ? t("Entrar no Runflow") : role === "treinador" ? t("Entre ou crie o seu clube grátis") : t("Entre para ver seus treinos")}</h2>
                <p className="text-fg-muted">
                  {invited
                    ? googleId || IS_MOCK ? t("Use sua conta Google ou receba um código por e-mail. Sem senha para lembrar.") : t("Receba um código por e-mail. Sem senha para lembrar.")
                    : role === "treinador" ? t("Treinador convidado por um clube? Use o e-mail do convite.") : t("Use o e-mail em que você recebeu o convite do seu clube. Ainda não tem convite? Peça ao seu treinador.")}
                </p>
              </div>
              <div className="grid gap-4">
                {IS_MOCK ? (
                  <Button variant="secondary" size="lg" block icon={<GoogleIcon />} loading={google.isPending} onClick={() => setChooser(true)}>
                    {t("Continuar com Google")}
                  </Button>
                ) : googleId ? (
                  <GoogleButton clientId={googleId} onCredential={(idToken) => google.mutate(idToken, { onSuccess: done, onError: toast.error })} />
                ) : null}
                {(IS_MOCK || googleId) && <div className="flex items-center gap-3 text-sm text-fg-subtle"><span className="h-px flex-1 bg-line" />{t("ou")}<span className="h-px flex-1 bg-line" /></div>}
                <form onSubmit={sendCode} className="grid gap-3" noValidate>
                  <Field label={t("E-mail")} error={emailError} hint={locked ? t("O convite é para este e-mail.") : undefined}>
                    {(id, d) => <Input id={id} aria-describedby={d} type="email" inputMode="email" autoComplete="email" placeholder="nome@email.com" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!emailError} readOnly={locked} required />}
                  </Field>
                  {locked && <button type="button" className="w-fit text-sm font-semibold text-brand-text hover:underline" onClick={() => setLocked(false)}>{t("Usar outro e-mail")}</button>}
                  <Button type="submit" size="lg" block icon={<Mail />} loading={start.isPending}>{t("Receber código por e-mail")}</Button>
                </form>
              </div>
              {!invited && role === "aluno" && (inviteOpen ? (
                <form onSubmit={openInvite} className="grid gap-3 rounded-lg border border-line-subtle p-4" noValidate>
                  <Field label={t("Link do convite")} error={inviteError} hint={t("Cole o link que chegou no seu e-mail.")}>
                    {(id, d) => <Input id={id} aria-describedby={d} placeholder="runflow.club/invite/…" value={inviteLink} invalid={!!inviteError} autoFocus
                      onChange={(e) => { setInviteLink(e.target.value); setInviteError(null); }} />}
                  </Field>
                  <Button type="submit" variant="secondary" icon={<Ticket />}>{t("Abrir convite")}</Button>
                </form>
              ) : (
                <button type="button" onClick={() => setInviteOpen(true)} className="-mt-4 flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-brand-text hover:underline">
                  <Ticket className="size-4" />{t("Tenho um link de convite")}
                </button>
              ))}
              {IS_MOCK && <a href="/dev/status" className="w-fit rounded-md bg-info-soft px-3 py-2 text-sm font-semibold text-on-info-soft hover:underline">{t("Modo de demonstração: ver o status do desenvolvimento")}</a>}
              <p className="text-sm text-fg-muted">
                {t("Ao continuar, você aceita os")} <a href="#" className="font-semibold text-brand-text underline-offset-2 hover:underline">{t("Termos de uso")}</a> {t("e a")} <a href="#" className="font-semibold text-brand-text underline-offset-2 hover:underline">{t("Política de privacidade")}</a>.
              </p>
            </>
          ) : (
            <>
              <button onClick={() => setStep("start")} className="-ml-2 flex w-fit items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-fg-muted hover:bg-soft hover:text-fg"><ArrowLeft className="size-4" />{t("Usar outro e-mail")}</button>
              <div className="grid gap-2">
                <h2 className="rf-text-display-sm">{t("Digite o código")}</h2>
                <p className="text-fg-muted">{t("Enviamos um código de 6 dígitos para {email}. Ele vale por 10 minutos.", { email })}</p>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); submitCode(code); }} className="grid gap-3">
                <Field label={t("Código")} error={verify.error instanceof ApiError ? verify.error.detail : null}>
                  {(id, d) => (
                    <Input id={id} ref={codeRef} aria-describedby={d} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} invalid={verify.isError}
                      className="h-14 text-center font-display text-[28px] font-bold tracking-[0.4em] [font-stretch:110%]"
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) submitCode(v); }} />
                  )}
                </Field>
                <Button type="submit" size="lg" block loading={verify.isPending} disabled={code.length !== 6}>{t("Entrar")}</Button>
              </form>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-muted">{t("Não recebeu?")}</span>
                <Button variant="ghost" size="sm" disabled={cooldown > 0} loading={start.isPending} onClick={() => sendCode()}>
                  {cooldown > 0 ? t("Reenviar em {s} s", { s: cooldown }) : t("Reenviar código")}
                </Button>
              </div>
              {IS_MOCK && <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-on-info-soft">{t("Modo de demonstração: o código é 000000.")}</p>}
            </>
          )}
        </div>
      </main>

      <Dialog open={chooser} onOpenChange={setChooser} title={t("Escolha uma conta")} description={IS_MOCK ? t("Modo de demonstração: escolha um perfil para entrar. No app real, esta é a janela do Google.") : undefined} size="sm">
        <ul className="-mx-2 grid gap-1">
          {(accounts.data ?? []).map((a) => (
            <li key={a.email}>
              <button disabled={google.isPending} onClick={() => google.mutate(a.email, { onSuccess: (r) => { setChooser(false); done(r); } })}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-soft disabled:opacity-50">
                <Avatar name={a.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="block truncate text-sm text-fg-muted">{a.roles[0] ? `${t(ROLE[a.roles[0].role] ?? a.roles[0].role)} · ${a.roles[0].club}${a.roles.length > 1 ? " " + t("e mais {n}", { n: a.roles.length - 1 }) : ""}` : a.email}</span>
                </span>
              </button>
            </li>
          ))}
          {accounts.isPending && <li className="px-2 py-4 text-fg-muted">{t("Carregando contas…")}</li>}
        </ul>
        <form className="mt-4 flex gap-2 border-t border-line-subtle pt-4" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("email"); google.mutate(String(v), { onSuccess: (r) => { setChooser(false); done(r); } }); }}>
          <Input name="email" type="email" placeholder={t("Outra conta: nome@gmail.com")} aria-label={t("Outra conta")} />
          <Button type="submit" variant="secondary" loading={google.isPending}>{t("Entrar")}</Button>
        </form>
      </Dialog>
    </div>
  );
}

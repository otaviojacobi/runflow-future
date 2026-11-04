/** A4 · Boas-vindas do aluno: consentimento → nome completo e dados → relógio → pronto (D-035: no goal step). Route: /welcome */
import { useNavigate } from "@tanstack/react-router";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useConnections, useConsents, useGrantConsent, useUpdateMe } from "@/api/account";
import type { Goal, Level } from "@/api/types";
import { ProviderConnections } from "@/components/account/StravaConnect";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { today as todayFn, yearsAgo } from "@/lib/format";
import { Button, Card, Checkbox, DateInput, Field, Input, toast } from "@/ui";

export const GOALS: { value: Goal; label: string }[] = [
  { value: "5k", label: "5 km" }, { value: "10k", label: "10 km" }, { value: "21k", label: "Meia maratona" }, { value: "42k", label: "Maratona" },
  { value: "trail", label: "Trilha" }, { value: "triathlon", label: "Triatlo" }, { value: "swim", label: "Natação" }, { value: "strength", label: "Força" }, { value: "health", label: "Saúde e bem-estar" },
  { value: "other", label: "Outro" },
];
export const LEVELS: { value: Level; label: string }[] = [{ value: "beginner", label: "Iniciante" }, { value: "intermediate", label: "Intermediário" }, { value: "advanced", label: "Avançado" }];
/** "52:30" or "1:52:30" → seconds. */
export const parseTime = (s: string) => { const p = s.trim().split(":").map(Number); if (p.some((x) => isNaN(x)) || p.length < 2 || p.length > 3) return null; return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!; };

export function WelcomeScreen() {
  const { me, club, ctx } = useClub();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [agree, setAgree] = useState(true);
  const consent = useGrantConsent();
  const updateMe = useUpdateMe();
  const [name, setName] = useState(me?.user.name ?? "");
  const [birth, setBirth] = useState(me?.user.birth_date ?? "");
  const [phone, setPhone] = useState(me?.user.phone ?? "");
  // Already connected to Strava (from another club): sharing it with this club too, checked to start (D-011).
  const conns = useConnections();
  const consents = useConsents();
  const [shareStrava, setShareStrava] = useState(true);
  // Every hook above the early return: /me can arrive after the first render (Rules of Hooks).
  const [nameError, setNameError] = useState<string | null>(null);
  if (!me || !club) return null;
  const connected = !!conns.data?.find((c) => c.provider === "strava")?.connection;
  const sharesStrava = !!consents.data?.some((c) => c.kind === "share_strava" && c.club_id === club.id && !c.revoked_at);
  const finishStrava = () => {
    if (connected && !sharesStrava && shareStrava) consent.mutate({ kind: "share_strava", club_id: club.id }, { onSuccess: () => setStep(4), onError: toast.error });
    else setStep(4);
  };
  const first = name.split(" ")[0] || me.user.name.split(" ")[0];
  const err = updateMe.error instanceof ApiError ? updateMe.error : null;
  // The watch step only in clubs whose modalities sync activities (D-052): a funcional gym's student skips it.
  const strava = has(club, "strava");
  const total = strava ? 3 : 2;
  /** "Nome completo": first and last name, so the club knows who is who. */
  const saveName = () => {
    const full = name.trim().replace(/\s+/g, " ");
    if (full.split(" ").length < 2) return setNameError(t("Informe nome e sobrenome."));
    setNameError(null);
    updateMe.mutate({ name: full, birth_date: birth || null, phone: phone || null }, { onSuccess: () => setStep(strava ? 3 : 4), onError: toast.error });
  };
  const sees = [
    t("Seus treinos planejados, se você fez e como se sentiu"),
    ...(strava ? [t("Atividades sincronizadas: distância, tempo, ritmo e frequência cardíaca")] : []),
    has(club, "zones") ? t("Seu objetivo, nível e zonas de treino") : t("Seu objetivo e nível"),
    t("Os comentários que você deixar nos treinos"),
  ];

  const steps: Record<number, React.ReactNode> = {
    1: (
      <>
        <Head icon={<ShieldCheck />} title={t("Seus dados, sob seu controle")} text={t("Para o {club} montar e acompanhar seus treinos, os treinadores precisam ver alguns dados seus.", { club: club.name })} />
        <Card className="grid gap-3 p-5 text-sm">
          <p className="font-semibold">{t("Os treinadores do clube vão ver:")}</p>
          <ul className="grid gap-1.5 text-fg-muted">
            {sees.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" />{x}</li>)}
          </ul>
          <p className="text-fg-muted">{t("Dados de saúde são sensíveis pela LGPD. Você pode revogar este consentimento a qualquer momento em Minha conta.")}</p>
        </Card>
        <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label={t("Concordo em compartilhar meus dados de treino com os treinadores do {club}", { club: club.name })} />
        <Next disabled={!agree} loading={consent.isPending} onClick={() => consent.mutate({ kind: "share_training_data", club_id: club.id }, { onSuccess: () => setStep(2), onError: toast.error })} />
      </>
    ),
    2: (
      <>
        <Head title={t("Prazer, {name}!", { name: first! })} text={t("Confirme seus dados. Seu treinador usa isso para calcular zonas e ritmos.")} />
        <Card className="grid gap-4 p-5">
          <Field label={t("Nome completo")} error={nameError ?? err?.fieldError("name")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t("Nome e sobrenome")} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Data de nascimento")} optional>{(id) => <DateInput id={id} value={birth} onChange={setBirth} max={todayFn()} initialMonth={yearsAgo(30)} autoComplete="bday" />}</Field>
            <Field label={t("WhatsApp")} optional hint={t("Para o treinador falar com você.")}>{(id, dd) => <Input id={id} aria-describedby={dd} type="tel" inputMode="tel" placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}</Field>
          </div>
        </Card>
        <Next loading={updateMe.isPending} onClick={saveName} />
      </>
    ),
    3: (
      <>
        <Head title={t("Conecte seu relógio")} text={t("Treinou, sincronizou: seu treinador vê o resultado sem você precisar fazer nada.")} />
        <ProviderConnections />
        {connected && !sharesStrava && (
          <Checkbox checked={shareStrava} onChange={(e) => setShareStrava(e.target.checked)}
            label={t("Compartilhar as atividades do Strava com os treinadores do {club}", { club: club.name })}
            description={t("O Strava exige o seu consentimento explícito para isso.")} />
        )}
        <div className="flex justify-end"><Button size="lg" loading={consent.isPending} onClick={finishStrava}>{t("Continuar")}</Button></div>
      </>
    ),
    4: (
      <div className="grid justify-items-center gap-5 py-6 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-accent text-on-accent ring-1 ring-inset ring-accent-edge"><Sparkles className="size-8" /></span>
        <h1 className="rf-text-display-sm">{t("Tudo certo, {name}!", { name: first! })}</h1>
        <p className="max-w-sm text-fg-muted">{t("Seu treinador já foi avisado. Assim que ele montar sua semana, os treinos aparecem em Hoje.")}</p>
        <Button size="lg" onClick={() => navigate({ to: "/today" })}>{t("Ver meus treinos")}</Button>
      </div>
    ),
  };

  return (
    <div className="mx-auto grid min-h-dvh max-w-xl content-start gap-6 px-5 py-6">
      <header className="flex items-center gap-3">
        <ClubLogo club={club} branding={ctx?.branding} size={40} />
        <div className="min-w-0 flex-1"><div className="truncate font-bold">{club.name}</div>{step <= total && <div className="text-sm text-fg-muted">{t("Passo {n} de {total}", { n: step, total })}</div>}</div>
        {step > 1 && step <= total && <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/today" })}>{t("Pular")}</Button>}
      </header>
      {step <= total && <div className="h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(step / total) * 100}%` }} /></div>}
      {steps[step]}
    </div>
  );
}
function Head({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  return (
    <div className="grid gap-2">
      {icon && <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-on-brand-soft [&_svg]:size-6">{icon}</span>}
      <h1 className="rf-text-display-sm">{title}</h1>
      <p className="text-fg-muted">{text}</p>
    </div>
  );
}
function Next({ onClick, disabled, loading }: { onClick: () => void; disabled?: boolean; loading?: boolean }) {
  return <div className="flex justify-end"><Button size="lg" onClick={onClick} disabled={disabled} loading={loading}>{t("Continuar")}</Button></div>;
}

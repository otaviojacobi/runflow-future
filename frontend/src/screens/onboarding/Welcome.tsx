/** A4 · Boas-vindas do aluno: consentimento → perfil → objetivo → relógio → pronto. Route: /bem-vindo */
import { useNavigate } from "@tanstack/react-router";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useGrantConsent, useSaveMyProfile, useUpdateMe } from "@/api/account";
import type { Goal, Level } from "@/api/types";
import { ProviderConnections } from "@/components/account/StravaConnect";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { Button, Card, Checkbox, Field, Input, Segmented, Select, cn, toast } from "@/ui";

export const GOALS: { value: Goal; label: string }[] = [
  { value: "5k", label: "5 km" }, { value: "10k", label: "10 km" }, { value: "21k", label: "Meia maratona" }, { value: "42k", label: "Maratona" },
  { value: "trail", label: "Trilha" }, { value: "triathlon", label: "Triatlo" }, { value: "swim", label: "Natação" }, { value: "strength", label: "Força" }, { value: "health", label: "Saúde e bem-estar" },
];
export const LEVELS: { value: Level; label: string }[] = [{ value: "beginner", label: "Iniciante" }, { value: "intermediate", label: "Intermediário" }, { value: "advanced", label: "Avançado" }];
const RACES = [{ m: 5000, label: "5 km" }, { m: 10000, label: "10 km" }, { m: 21097, label: "21 km" }, { m: 42195, label: "42 km" }];
/** "52:30" or "1:52:30" → seconds. */
export const parseTime = (s: string) => { const p = s.trim().split(":").map(Number); if (p.some((x) => isNaN(x)) || p.length < 2 || p.length > 3) return null; return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!; };

export function WelcomeScreen() {
  const { me, club, ctx } = useClub();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [agree, setAgree] = useState(false);
  const consent = useGrantConsent();
  const updateMe = useUpdateMe();
  const saveProfile = useSaveMyProfile(club?.id ?? "");
  const [name, setName] = useState(me?.user.name ?? "");
  const [birth, setBirth] = useState(me?.user.birth_date ?? "");
  const [phone, setPhone] = useState(me?.user.phone ?? "");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [level, setLevel] = useState<Level>("beginner");
  const [weekly, setWeekly] = useState("3");
  const [race, setRace] = useState(10000);
  const [raceTime, setRaceTime] = useState("");
  const [shareStrava, setShareStrava] = useState(true);
  if (!me || !club) return null;
  const first = name.split(" ")[0] || me.user.name.split(" ")[0];
  const err = updateMe.error instanceof ApiError ? updateMe.error : null;
  const total = 4;

  const steps: Record<number, React.ReactNode> = {
    1: (
      <>
        <Head icon={<ShieldCheck />} title={t("Seus dados, sob seu controle")} text={t("Para o {club} montar e acompanhar seus treinos, os treinadores precisam ver alguns dados seus.", { club: club.name })} />
        <Card className="grid gap-3 p-5 text-sm">
          <p className="font-semibold">{t("Os treinadores do clube vão ver:")}</p>
          <ul className="grid gap-1.5 text-fg-muted">
            {[t("Seus treinos planejados, se você fez e como se sentiu"), t("Atividades sincronizadas: distância, tempo, ritmo e frequência cardíaca"), t("Seu objetivo, nível e zonas de treino"), t("Os comentários que você deixar nos treinos")].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" />{x}</li>)}
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
          <Field label={t("Nome")} error={err?.fieldError("name")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Data de nascimento")} optional>{(id) => <Input id={id} type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />}</Field>
            <Field label={t("WhatsApp")} optional hint={t("Para o treinador falar com você.")}>{(id, dd) => <Input id={id} aria-describedby={dd} type="tel" inputMode="tel" placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}</Field>
          </div>
        </Card>
        <Next loading={updateMe.isPending} onClick={() => updateMe.mutate({ name, birth_date: birth || null, phone: phone || null }, { onSuccess: () => setStep(3), onError: toast.error })} />
      </>
    ),
    3: (
      <>
        <Head title={t("Qual é o seu objetivo?")} text={t("Ajuda o treinador a montar a sua planilha.")} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {GOALS.map((g) => (
            <button key={g.value} type="button" aria-pressed={goal === g.value} onClick={() => setGoal(g.value)}
              className={cn("flex h-14 items-center justify-between rounded-lg border px-4 text-left font-semibold transition-colors", goal === g.value ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface hover:bg-soft")}>
              {t(g.label)}{goal === g.value && <Check className="size-5" />}
            </button>
          ))}
        </div>
        <Card className="grid gap-4 p-5">
          <div className="grid gap-2"><span className="rf-text-label-sm">{t("Nível")}</span><Segmented label={t("Nível")} value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l.value, label: t(l.label) }))} className="w-full" /></div>
          <Field label={t("Quantos treinos por semana você consegue fazer?")}>{(id) => <Select id={id} value={weekly} onChange={(e) => setWeekly(e.target.value)}>{[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{t("{n} treinos", { n })}</option>)}</Select>}</Field>
          {goal !== "swim" && goal !== "strength" && (
            <div className="grid gap-2">
              <span className="rf-text-label-sm">{t("Uma prova recente")} <span className="font-normal text-fg-muted">({t("opcional")})</span></span>
              <div className="flex gap-2">
                <Select aria-label={t("Distância")} value={race} onChange={(e) => setRace(Number(e.target.value))} className="w-32">{RACES.map((r) => <option key={r.m} value={r.m}>{r.label}</option>)}</Select>
                <Input aria-label={t("Tempo")} placeholder={t("Tempo, ex.: 52:30")} value={raceTime} onChange={(e) => setRaceTime(e.target.value)} inputMode="numeric" />
              </div>
              <p className="rf-text-caption text-fg-muted">{t("Com ela, já calculamos seus ritmos de treino.")}</p>
            </div>
          )}
        </Card>
        <Next disabled={!goal} loading={saveProfile.isPending} onClick={() => {
          const time = parseTime(raceTime);
          saveProfile.mutate({ goal, level, weekly_sessions: Number(weekly), recent_race: time ? { distance_m: race, time_s: time } : null }, { onSuccess: () => setStep(4), onError: toast.error });
        }} />
      </>
    ),
    4: (
      <>
        <Head title={t("Conecte seu relógio")} text={t("Treinou, sincronizou: seu treinador vê o resultado sem você precisar fazer nada.")} />
        <ProviderConnections onConnected={() => shareStrava && consent.mutate({ kind: "share_strava", club_id: club.id })} />
        <Checkbox checked={shareStrava} onChange={(e) => setShareStrava(e.target.checked)} label={t("Compartilhar as atividades do Strava com os treinadores do {club}", { club: club.name })} description={t("O Strava exige o seu consentimento explícito para isso.")} />
        <div className="flex justify-end"><Button size="lg" onClick={() => setStep(5)}>{t("Continuar")}</Button></div>
      </>
    ),
    5: (
      <div className="grid justify-items-center gap-5 py-6 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-accent text-on-accent ring-1 ring-inset ring-accent-edge"><Sparkles className="size-8" /></span>
        <h1 className="rf-text-display-sm">{t("Tudo certo, {name}!", { name: first! })}</h1>
        <p className="max-w-sm text-fg-muted">{t("Seu treinador já foi avisado. Assim que ele montar sua semana, os treinos aparecem em Hoje.")}</p>
        <Button size="lg" onClick={() => navigate({ to: "/hoje" })}>{t("Ver meus treinos")}</Button>
      </div>
    ),
  };

  return (
    <div className="mx-auto grid min-h-dvh max-w-xl content-start gap-6 px-5 py-6">
      <header className="flex items-center gap-3">
        <ClubLogo club={club} branding={ctx?.branding} size={40} />
        <div className="min-w-0 flex-1"><div className="truncate font-bold">{club.name}</div>{step <= total && <div className="text-sm text-fg-muted">{t("Passo {n} de {total}", { n: step, total })}</div>}</div>
        {step > 1 && step <= total && <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/hoje" })}>{t("Pular")}</Button>}
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

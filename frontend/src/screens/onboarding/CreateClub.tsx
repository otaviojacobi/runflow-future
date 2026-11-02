/** A5 · Criar clube: dados → cores e logo → convite → biblioteca → pronto. Route: /clubs/new */
import Color from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { useNavigate } from "@tanstack/react-router";
import { Check, CircleCheck, ImageUp, Library, Mail, Palette, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { readLogo, useCreateClub, useSaveBranding, useUploadAsset } from "@/api/clubs";
import { useTemplates } from "@/api/library";
import { fetchMe, meKey } from "@/api/me";
import type { Club, Sport } from "@/api/types";
import { RunflowWordmark } from "@/components/brand";
import { ColorPicker, PRIMARY_PRESETS, SECONDARY_PRESETS } from "@/components/club/ColorPicker";
import { InviteForm } from "@/components/club/InviteDialog";
import { ThemePreview } from "@/components/club/ThemePreview";
import { SPORTS, SPORT_ICON, SPORT_LABEL, SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub } from "@/lib/club";
import { duration } from "@/lib/format";
import { themeVars } from "@/lib/theme";
import { queryClient } from "@/queryClient";
import { Button, ButtonLink, Card, Field, Input, Select, cn, toast } from "@/ui";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const DEFAULTS = { brand: tokens.seeds.brand, accent: tokens.seeds.accent };
type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = [
  { n: 1, label: "Clube" }, { n: 2, label: "Cores" }, { n: 3, label: "Convite" }, { n: 4, label: "Biblioteca" },
] as const;

function Progress({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label={t("Progresso")}>
      {STEPS.map((s, i) => (
        <li key={s.n} className="flex flex-1 items-center gap-2" aria-current={step === s.n ? "step" : undefined}>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", step > s.n ? "bg-brand text-on-brand" : step === s.n ? "bg-brand-soft text-on-brand-soft ring-2 ring-brand-ring" : "bg-soft text-fg-muted")}>
            {step > s.n ? <Check className="size-4" /> : s.n}
          </span>
          <span className={cn("hidden text-sm font-semibold sm:inline", step >= s.n ? "text-fg" : "text-fg-muted")}>{t(s.label)}</span>
          {i < STEPS.length - 1 && <span className={cn("h-0.5 flex-1 rounded-full", step > s.n ? "bg-brand" : "bg-line")} />}
        </li>
      ))}
    </ol>
  );
}

export function CreateClubScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [club, setClub] = useState<Club | null>(null);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3">
          <RunflowWordmark />
          <div className="ml-auto"><Button variant="ghost" size="sm" icon={<X />} onClick={() => navigate({ to: club ? "/dashboard" : "/clubs" })}>{club ? t("Terminar depois") : t("Cancelar")}</Button></div>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-8 px-5 py-8">
        {step < 5 && <Progress step={step} />}
        {step === 1 && <StepClub onDone={(c) => { setClub(c); setStep(2); }} />}
        {step === 2 && club && <StepColors club={club} onDone={() => setStep(3)} />}
        {step === 3 && club && <StepInvite club={club} onDone={() => setStep(4)} />}
        {step === 4 && club && <StepLibrary club={club} onDone={() => setStep(5)} />}
        {step === 5 && club && <StepDone club={club} />}
      </main>
    </div>
  );
}

function StepClub({ onDone }: { onDone: (c: Club) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [mods, setMods] = useState<Sport[]>(["run"]);
  const create = useCreateClub();
  const err = create.error instanceof ApiError ? create.error : null;
  const toggle = (s: Sport) => setMods((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ name, city, state, modalities: mods }, {
      onSuccess: async (r) => {
        const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
        selectClub(me.memberships.find((m) => m.club.id === r.club.id) ?? null);
        onDone(r.club);
      },
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <div><h1 className="rf-text-display-sm">{t("Vamos criar o seu clube")}</h1><p className="mt-1 text-fg-muted">{t("Leva menos de 5 minutos. Dá para mudar tudo depois.")}</p></div>
      <Card className="grid gap-5 p-5 sm:p-6">
        <Field label={t("Nome do clube")} error={err?.fieldError("name")} hint={t("Como seus alunos conhecem o clube.")}>
          {(id, d) => <Input id={id} aria-describedby={d} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Pace Forte Assessoria")} invalid={!!err?.fieldError("name")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label={t("Cidade")} optional>{(id) => <Input id={id} value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" autoComplete="address-level2" />}</Field>
          <Field label={t("Estado")}>{(id) => <Select id={id} value={state} onChange={(e) => setState(e.target.value)}>{UF.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 rf-text-label-sm">{t("Modalidades")}</legend>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((s) => {
              const I = SPORT_ICON[s], on = mods.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => toggle(s)}
                  className={cn("inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
                  <I className="size-[18px]" />{t(SPORT_LABEL[s])}{on && <Check className="size-4" />}
                </button>
              );
            })}
          </div>
          {err?.fieldError("modalities") && <p className="rf-text-caption text-danger-text">{err.fieldError("modalities")}</p>}
          <p className="rf-text-caption text-fg-muted">{t("Usamos isso para montar sua biblioteca inicial e os termos do app (treinador ou professor).")}</p>
        </fieldset>
      </Card>
      <div className="flex justify-end"><Button type="submit" size="lg" loading={create.isPending}>{t("Criar clube")}</Button></div>
    </form>
  );
}

function StepColors({ club, onDone }: { club: Club; onDone: () => void }) {
  const [primary, setPrimary] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<string | null>(null);
  const [logo, setLogo] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const upload = useUploadAsset(club.id);
  const save = useSaveBranding(club.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const res = useMemo(() => Color.resolveClubColors({ primary, secondary }, DEFAULTS), [primary, secondary]);
  // Previews are scoped: the wizard itself stays in Runflow's brand (public/setup pages, founder 2026-11-02).
  const vars = useMemo(() => ({ light: themeVars({ primary, secondary }, "light"), dark: themeVars({ primary, secondary }, "dark") }), [primary, secondary]);
  const whiteVariant = primary ? Color.whiteTextVariant(primary) : null;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await readLogo(f);
      setLogo(r);
      const s = Color.suggestFromPixels(r.pixels, 3);
      setSuggestions(s);
      if (s[0]) { setPrimary(s[0]); setSecondary(s[1] ?? null); }
    } catch (e) {
      toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), (e as Error).message === "size" ? t("O limite é 5 MB.") : t("Envie uma imagem PNG, JPG, WebP ou SVG.")));
    }
  };
  const submit = async () => {
    try {
      let logoId: string | undefined;
      if (logo) logoId = (await upload.mutateAsync({ data_url: logo.dataUrl, width: logo.width, height: logo.height })).id;
      await save.mutateAsync({ primary_color: primary, secondary_color: secondary, ...(logoId ? { logo_asset_id: logoId } : {}) });
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
      selectClub(me.memberships.find((m) => m.club.id === club.id) ?? null);
      onDone();
    } catch (e) { toast.error(e); }
  };
  const sourceText = { default: t("Sem cores: o app usa o padrão do Runflow."), derived: t("Uma cor: a secundária é criada automaticamente a partir dela."), club: t("Duas cores: primária para ações, secundária para destaques.") }[res.source];

  return (
    <div className="grid gap-6">
      <div><h1 className="rf-text-display-sm">{t("As cores do {club}", { club: club.name })}</h1><p className="mt-1 text-fg-muted">{t("Seus alunos verão o app com o logo e as cores do clube. Escolha uma, duas ou nenhuma.")}</p></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Card className="grid content-start gap-6 p-5 sm:p-6">
          <div className="grid gap-3">
            <span className="rf-text-label-sm">{t("Logo")} <span className="font-normal text-fg-muted">({t("opcional")})</span></span>
            <div className="flex items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-sunken ring-1 ring-line">{logo ? <img src={logo.dataUrl} alt="" className="size-full object-contain p-1" /> : <ImageUp className="size-6 text-fg-subtle" />}</span>
              <div className="grid gap-1.5">
                <Button variant="secondary" size="sm" icon={<ImageUp />} onClick={() => fileRef.current?.click()}>{logo ? t("Trocar logo") : t("Enviar logo")}</Button>
                <span className="rf-text-caption text-fg-muted">{t("PNG, JPG ou SVG até 5 MB. Sugerimos as cores a partir dele.")}</span>
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm"><Sparkles className="size-4 text-accent-text" /><span className="text-fg-muted">{t("Do seu logo:")}</span>
                {suggestions.map((c) => <button key={c} onClick={() => setPrimary(c)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 font-mono text-xs hover:bg-soft"><span className="size-6 rounded-full ring-1 ring-inset ring-line-strong" style={{ background: c }} />{c}</button>)}
              </div>
            )}
          </div>
          <ColorPicker label={t("Cor primária: botões e destaques de ação")} value={primary} onChange={(v) => { setPrimary(v); if (!v) setSecondary(null); }} presets={PRIMARY_PRESETS} noneLabel={t("Padrão Runflow")} />
          <ColorPicker label={t("Cor secundária: recordes e conquistas")} value={secondary} onChange={setSecondary} presets={SECONDARY_PRESETS} noneLabel={t("Automática")} disabled={!primary} />
          <div className="grid gap-1 rounded-md bg-sunken p-3 text-sm">
            <span className="flex items-center gap-2 font-semibold"><Palette className="size-4" />{sourceText}</span>
            {whiteVariant && <span className="text-fg-muted">{t("Para manter a leitura, os botões usam texto escuro nesta cor.")} <button className="font-semibold text-brand-text underline-offset-2 hover:underline" onClick={() => setPrimary(whiteVariant)}>{t("Preferir texto branco ({c})", { c: whiteVariant })}</button></span>}
          </div>
        </Card>
        <div className="flex items-start justify-center gap-4">
          <ThemePreview name={club.name} logoUrl={logo?.dataUrl} mode="light" vars={vars.light} />
          <ThemePreview name={club.name} logoUrl={logo?.dataUrl} mode="dark" vars={vars.dark} className="hidden xl:block" />
        </div>
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={() => { setPrimary(null); setSecondary(null); setLogo(null); onDone(); }}>{t("Pular por enquanto")}</Button>
        <Button size="lg" loading={upload.isPending || save.isPending} onClick={submit}>{t("Salvar e continuar")}</Button>
      </div>
    </div>
  );
}

function StepInvite({ club, onDone }: { club: Club; onDone: () => void }) {
  const [sent, setSent] = useState(0);
  return (
    <div className="grid gap-6">
      <div><h1 className="rf-text-display-sm">{t("Convide seus alunos")}</h1><p className="mt-1 text-fg-muted">{t("Cada aluno recebe um convite pessoal por e-mail e entra com a conta Google ou um código, em segundos. Só entra no clube quem você convidar.")}</p></div>
      <Card className="grid gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-2"><Mail className="size-5 text-brand-text" /><h2 className="rf-text-title-md">{t("Convites por e-mail")}</h2></div>
        <InviteForm club={club} onSent={() => setSent((x) => x + 1)} />
        <p className="rf-text-caption text-fg-muted">{t("No plano Free, até 10 alunos. Treinadores não contam. Tem uma planilha? Importe depois em Membros e convites.")}</p>
      </Card>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onDone}>{sent ? t("Convidar mais depois") : t("Pular por enquanto")}</Button>
        <Button size="lg" onClick={onDone}>{t("Continuar")}</Button>
      </div>
    </div>
  );
}

function StepLibrary({ club, onDone }: { club: Club; onDone: () => void }) {
  const tpl = useTemplates(club.id);
  const items = tpl.data ?? [];
  return (
    <div className="grid gap-6">
      <div><h1 className="rf-text-display-sm">{t("Sua biblioteca já começa pronta")}</h1><p className="mt-1 text-fg-muted">{tn(items.length, "Separamos {n} treino para as modalidades do clube. Edite à vontade ou crie os seus.", "Separamos {n} treinos para as modalidades do clube. Edite à vontade ou crie os seus.")}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tpl.isPending && Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-soft" />)}
        {items.map((w) => (
          <Card key={w.id} className="grid gap-2.5 p-4">
            <div className="flex items-center justify-between gap-2"><SportChip sport={w.sport} size="sm" /><span className="text-xs text-fg-muted">{w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : ""}</span></div>
            <div className="font-semibold">{w.name}</div>
            <IntensityProfile structure={w.structure} sport={w.sport} height={32} />
          </Card>
        ))}
      </div>
      <div className="flex justify-end"><Button size="lg" icon={<Library />} onClick={onDone}>{t("Concluir")}</Button></div>
    </div>
  );
}

function StepDone({ club }: { club: Club }) {
  const items = [t("Clube criado"), t("Cores e logo"), t("Convites por e-mail"), t("Biblioteca inicial")];
  return (
    <div className="mx-auto grid max-w-lg justify-items-center gap-6 py-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-accent text-on-accent ring-1 ring-inset ring-accent-edge"><CircleCheck className="size-8" /></span>
      <div><h1 className="rf-text-display-sm">{t("Tudo pronto, {club}!", { club: club.name })}</h1><p className="mt-2 text-fg-muted">{t("Agora é com você: monte a primeira semana dos alunos assim que eles entrarem.")}</p></div>
      <ul className="grid w-full gap-2 text-left">
        {items.map((i) => <li key={i} className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 font-medium"><Check className="size-5 text-success-text" />{i}</li>)}
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink to="/planning" variant="secondary" size="lg">{t("Montar a semana")}</ButtonLink>
        <ButtonLink to="/dashboard" size="lg">{t("Ir para o painel")}</ButtonLink>
      </div>
    </div>
  );
}

/** A1 · Landing (runflow.club). Public. Every visual is a live product component. Route: / */
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight, BadgeCheck, CalendarCheck, CalendarClock, Check, ChevronDown, ClipboardList, Gauge, Library, MessageSquare,
  Smartphone, Sparkles, Users, Wallet, Wand2, Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IS_MOCK, useGoogleSignIn } from "@/api/auth";
import { usePlans } from "@/api/billing";
import type { Plan, Sport } from "@/api/types";
import { extraText, featuresOf, price, seatsText } from "@/components/billing/plans";
import flagBr from "@/assets/flag-br.svg";
import { RunflowHomeLink } from "@/components/brand";
import { ThemePreview } from "@/components/club/ThemePreview";
import { SPORT_ICON, SPORT_LABEL, SportChip } from "@/components/sport";
import { IntensityProfile, zoneBg } from "@/components/workout";
import { parseQuickText } from "@/domain/quicktext";
import { estimate, segments, stepText, type Step } from "@/domain/workout";
import { t } from "@/i18n";
import { activeMembership, homeFor, selectClub } from "@/lib/club";
import { distance, duration } from "@/lib/format";
import { session } from "@/lib/session";
import { themeVars } from "@/lib/theme";
import { ButtonLink, Skeleton, cn, toast } from "@/ui";

const HERO_EXAMPLES = ["10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq", "15' Z2 + 3x(2km Z4 + 3' Z1) + 10' Z1", "20' Z2 + 8x400m @1:35 c/ 90\" parado + 10' Z1"];

/** Types the examples one character at a time, forever. */
function useTypewriter(lines: string[], speed = 45, hold = 1800) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    const line = lines[i % lines.length]!;
    const id = setTimeout(() => {
      if (n < line.length) setN(n + 1);
      else { setI(i + 1); setN(0); }
    }, n < line.length ? speed : hold);
    return () => clearTimeout(id);
  }, [i, n, lines, speed, hold]);
  return lines[i % lines.length]!.slice(0, n);
}

function DemoLogin() {
  const google = useGoogleSignIn();
  const navigate = useNavigate();
  const go = (email: string) =>
    google.mutate(email, {
      onSuccess: (r) => { const m = activeMembership(r.me); selectClub(m); navigate({ to: homeFor(m?.membership.role) }); },
      onError: toast.error,
    });
  const people = [
    { email: "marcos@paceforte.com.br", label: t("Gestor") },
    { email: "julia@paceforte.com.br", label: t("Treinadora") },
    { email: "ana.souza@email.com", label: t("Aluna") },
  ];
  return (
    <div className="border-b border-line bg-info-soft text-on-info-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2 text-sm">
        <Sparkles className="size-4" /><span className="font-semibold">{t("Modo demonstração:")}</span>
        {people.map((p) => <button key={p.email} disabled={google.isPending} onClick={() => go(p.email)} className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-fg shadow-sm hover:bg-soft disabled:opacity-50">{t("Entrar como {x}", { x: p.label })}</button>)}
        <a href="/dev/status" className="ml-auto text-xs font-semibold underline-offset-2 hover:underline">{t("Status do desenvolvimento")}</a>
      </div>
    </div>
  );
}

function Header() {
  const signed = session.isSignedIn();
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <RunflowHomeLink />
        <nav className="hidden gap-6 text-sm font-semibold text-fg-muted md:flex" aria-label={t("Seções")}>
          <a href="#treinos" className="hover:text-fg">{t("Treinos")}</a><a href="#recursos" className="hover:text-fg">{t("Recursos")}</a>
          <a href="#clube" className="hover:text-fg">{t("Seu clube")}</a><a href="#precos" className="hover:text-fg">{t("Preços")}</a><a href="#faq" className="hover:text-fg">{t("Dúvidas")}</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signed ? <ButtonLink to="/app" iconRight={<ArrowRight />}>{t("Abrir o app")}</ButtonLink> : (
            <><ButtonLink to="/login" variant="ghost" className="hidden sm:inline-flex">{t("Entrar")}</ButtonLink><ButtonLink to="/login">{t("Criar clube grátis")}</ButtonLink></>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const text = useTypewriter(HERO_EXAMPLES);
  const parsed = useMemo(() => parseQuickText(text, "run").structure, [text]);
  const est = estimate(parsed, "run");
  return (
    <section data-theme="dark" className="relative overflow-hidden bg-canvas text-fg">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[640px] rounded-full bg-brand opacity-25 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-56 left-1/4 size-[520px] rounded-full bg-accent opacity-10 blur-[120px]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.1fr_1fr] lg:pb-28 lg:pt-20">
        <div className="grid gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs font-semibold text-fg-muted"><Zap className="size-3.5 text-accent-text" />{t("Para assessorias, academias e equipes de natação")}</span>
          <h1 className="rf-text-display-lg text-balance sm:text-[56px] sm:leading-[1.02]">{t("O treino do seu clube,")} <span className="text-accent-text">{t("no ritmo certo.")}</span></h1>
          <p className="max-w-xl text-lg text-fg-muted">{t("Monte treinos em segundos, acompanhe cada aluno e deixe o app com a cara do seu clube. Corrida, natação, academia e tudo junto.")}</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to="/login" size="lg" iconRight={<ArrowRight />}>{t("Criar meu clube grátis")}</ButtonLink>
            <a href="#treinos" className="inline-flex h-12 items-center rounded-md border border-line px-5 font-semibold text-fg hover:bg-soft">{t("Ver como funciona")}</a>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
            {[t("Grátis até 10 alunos"), t("Sem cartão de crédito"), t("Dados no Brasil (LGPD)")].map((x) => <li key={x} className="flex items-center gap-1.5"><Check className="size-4 text-success-text" />{x}</li>)}
          </ul>
        </div>
        <div className="relative mx-auto flex w-full max-w-md items-start justify-center">
          <div className="absolute -left-2 top-24 z-10 hidden w-[300px] rounded-xl border border-line bg-raised p-4 shadow-lg sm:block lg:-left-16">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted"><Wand2 className="size-4 text-accent-text" />{t("Escrita rápida")}</div>
            <div className="min-h-12 rounded-md bg-sunken px-3 py-2 font-mono text-[13px] leading-relaxed">{text}<span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-fg" /></div>
            <IntensityProfile structure={parsed} sport="run" height={44} className="mt-3" />
            <div className="mt-2 flex justify-between text-xs text-fg-muted"><span>{est.duration_s ? `≈ ${duration(est.duration_s)}` : "…"}</span><span>{est.distance_m ? distance(est.distance_m) : ""}</span></div>
          </div>
          <div className="rotate-[3deg] lg:translate-x-12">
            <ThemePreview name="Pace Forte Assessoria" mode="dark" vars={themeVars({ primary: "#D62828", secondary: "#FFB703" }, "dark")} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Modalities() {
  const items: { s: Sport; text: string }[] = [
    { s: "run", text: "Planilhas, tiros, longões e zonas de pace por aluno." },
    { s: "swim", text: "Séries com saída, estilos, educativos e material." },
    { s: "bike", text: "Treinos por zona, potência ou frequência cardíaca." },
    { s: "mobility", text: "Circuitos, core e mobilidade, com séries, tempos e descanso." },
  ];
  return (
    <section className="border-b border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-4 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ s, text }) => { const I = SPORT_ICON[s]; return (
          <div key={s} className="flex gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", { run: "bg-run text-on-run", swim: "bg-swim text-on-swim", bike: "bg-bike text-on-bike", mobility: "bg-mobility text-on-mobility" }[s as "run"])}><I className="size-5" /></span>
            <div><div className="font-bold">{t(SPORT_LABEL[s])}</div><p className="text-sm text-fg-muted">{t(text)}</p></div></div>
        ); })}
      </div>
    </section>
  );
}

function BuilderDemo() {
  const [text, setText] = useState("10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq");
  const { structure, warnings } = useMemo(() => parseQuickText(text, "run"), [text]);
  const est = estimate(structure, "run");
  const flat: Step[] = structure.blocks.flatMap((b) => (b.kind === "repeat" ? b.steps.map((s, i) => (i === 0 ? { ...s, note: `${b.count}×` } : s)) : b.kind === "step" ? [b] : []));
  const zones = segments(structure, "run");
  // The box grows with the text, so workouts written over several lines (R2) stay readable.
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);
  return (
    <section id="treinos" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-5 py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div className="grid gap-5">
        <span className="rf-text-overline text-brand-text">{t("Escrita rápida")}</span>
        <h2 className="rf-text-display-md text-balance">{t("Escreva o treino como você manda no WhatsApp.")}</h2>
        <p className="text-lg text-fg-muted">{t("O Runflow entende o jeito brasileiro de prescrever: aquecimento, tiros, trote, zonas, pace. Vira um treino estruturado na hora, pronto para o aluno e para o relógio.")}</p>
        <ul className="grid gap-2 text-fg-muted">
          {[t("Corrida, natação e musculação"), t("Biblioteca para reaproveitar"), t("Atribua para um grupo inteiro de uma vez")].map((x) => <li key={x} className="flex items-center gap-2"><BadgeCheck className="size-5 text-brand-text" />{x}</li>)}
        </ul>
      </div>
      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-5 shadow-lg">
        <label htmlFor="demo-qt" className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="size-4 text-accent-text" />{t("Experimente: edite o texto")}</label>
        <textarea ref={box} id="demo-qt" rows={2} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="w-full resize-none overflow-hidden rounded-md border border-line-strong bg-sunken px-3 py-2.5 font-mono text-[15px] focus:border-brand-ring focus:bg-surface focus:outline-none focus:ring-3 focus:ring-brand-ring/25" />
        {warnings.length > 0 && <p className="text-sm text-warning-text">{t("Não entendi: {x}", { x: warnings.join(", ") })}</p>}
        <IntensityProfile structure={structure} sport="run" height={64} />
        <div className="flex gap-6"><div><div className="text-xs text-fg-muted">{t("Duração")}</div><div className="font-display text-2xl font-bold tabular-nums [font-stretch:110%]">{est.duration_s ? duration(est.duration_s) : "–"}</div></div><div><div className="text-xs text-fg-muted">{t("Distância")}</div><div className="font-display text-2xl font-bold tabular-nums [font-stretch:110%]">{est.distance_m ? distance(est.distance_m) : "–"}</div></div><div className="ml-auto self-end text-xs text-fg-muted">{zones.length} {t("etapas")}</div></div>
        <ol className="grid gap-1.5">
          {flat.map((s, i) => <li key={i} className="flex items-center gap-2.5 text-sm"><i className={cn("size-2.5 shrink-0 rounded-[3px]", zoneBg[zones.find((z) => z.intent === s.intent)?.zone ?? 2])} /><span className="font-mono text-xs text-fg-muted">{s.note?.endsWith("×") ? s.note : ""}</span>{stepText({ ...s, note: undefined }, "run")}</li>)}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  const f = [
    { I: CalendarCheck, title: "Planejamento em grade", text: "Alunos × dias da semana. Arraste para mudar de dia, copie a semana inteira em um clique." },
    { I: Library, title: "Biblioteca e planilhas", text: "Modelos prontos e planilhas de várias semanas para aplicar em quem você quiser." },
    { I: Gauge, title: "Strava sincroniza sozinho", text: "O aluno treina, a atividade chega e o Runflow cruza com o planejado." },
    { I: MessageSquare, title: "Feedback de cada treino", text: "Como o aluno se sentiu, esforço percebido e conversa direto no treino." },
    { I: CalendarClock, title: "Aulas e reservas", text: "Horários, vagas, lista de espera e check-in por QR code para academias e natação." },
    { I: Smartphone, title: "App do aluno rápido", text: "Abre em menos de 2 segundos e mostra o treino do dia mesmo sem internet." },
    { I: Users, title: "Grupos e convites", text: "Convites pessoais por e-mail, turmas organizadas e a aderência de cada aluno." },
    { I: ClipboardList, title: "Zonas por aluno", text: "Pace e frequência cardíaca calculados a partir de uma prova ou teste." },
    { I: Wallet, title: "Preço justo", text: "Grátis até 10 alunos. R$ 19,90 por mês até 30. Sem taxa de ativação." },
  ];
  return (
    <section id="recursos" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20">
        <div className="grid max-w-2xl gap-3"><span className="rf-text-overline text-brand-text">{t("Recursos")}</span><h2 className="rf-text-display-md text-balance">{t("Tudo o que o treinador precisa. Nada que atrapalhe.")}</h2></div>
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {f.map(({ I, title, text }) => <div key={title} className="grid content-start gap-2"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-on-brand-soft"><I className="size-5" /></span><h3 className="rf-text-title-md">{t(title)}</h3><p className="text-fg-muted">{t(text)}</p></div>)}
        </div>
      </div>
    </section>
  );
}

const STUDIO = [
  { name: "Pace Forte", primary: "#D62828", secondary: "#FFB703" },
  { name: "Equipe Maré", primary: "#0096C7", secondary: null },
  { name: "Academia Solar", primary: "#FFC300", secondary: "#111111" },
  { name: "Trilha Verde", primary: "#2D6A4F", secondary: null },
  { name: "Noturnos", primary: "#111111", secondary: "#7CFFCB" },
  { name: "Rosa Run", primary: "#E91E63", secondary: "#FFD166" },
];
function Studio() {
  const [i, setI] = useState(0);
  const c = STUDIO[i]!;
  return (
    <section id="clube" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-5 py-20 lg:grid-cols-[1fr_auto]">
      <div className="grid gap-5">
        <span className="rf-text-overline text-brand-text">{t("Club Studio")}</span>
        <h2 className="rf-text-display-md text-balance">{t("O app com a cara do seu clube. Até no plano grátis.")}</h2>
        <p className="text-lg text-fg-muted">{t("Envie o logo, escolha uma ou duas cores e pronto: seus alunos abrem o Runflow e veem o seu clube. O contraste é calculado sozinho, no claro e no escuro.")}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Clubes de exemplo")}>
          {STUDIO.map((s, k) => (
            <button key={s.name} role="radio" aria-checked={i === k} onClick={() => setI(k)} className={cn("flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-3 text-sm font-semibold transition-colors", i === k ? "border-fg bg-surface" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
              <span className="flex"><span className="size-7 rounded-full ring-2 ring-surface" style={{ background: s.primary }} />{s.secondary && <span className="-ml-2 size-7 rounded-full ring-2 ring-surface" style={{ background: s.secondary }} />}</span>{s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-4">
        <ThemePreview name={c.name} mode="light" vars={themeVars({ primary: c.primary, secondary: c.secondary })} />
        <ThemePreview name={c.name} mode="dark" vars={themeVars({ primary: c.primary, secondary: c.secondary }, "dark")} className="hidden xl:block" />
      </div>
    </section>
  );
}

function Pricing() {
  const catalog = usePlans();
  const copy: Record<Plan, { desc: string; cta: string; hl: boolean }> = {
    free: { desc: t("Para começar ou para turmas pequenas."), cta: t("Criar clube grátis"), hl: false },
    pro: { desc: t("Para assessorias e academias em crescimento."), cta: t("Começar com o Pro"), hl: true },
    max: { desc: t("Para clubes grandes: cresça pagando só as vagas extras."), cta: t("Começar com o Max"), hl: false },
  };
  const plans = (catalog.data?.plans ?? []).map((p) => ({
    name: p.name, price: price(p.price_cents), per: p.price_cents === 0 ? t("para sempre") : t("por mês"), ...copy[p.id],
    items: [seatsText(p), ...(extraText(p) ? [extraText(p)!] : []), ...featuresOf(p.id)],
  }));
  return (
    <section id="precos" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20">
        <div className="mx-auto grid max-w-2xl gap-3 text-center"><span className="rf-text-overline text-brand-text">{t("Preços")}</span><h2 className="rf-text-display-md text-balance">{t("Simples e muito mais barato.")}</h2><p className="text-fg-muted">{t("Sem taxa de ativação, sem fidelidade. Alunos não pagam nada para usar.")}</p></div>
        <div className="grid gap-4 lg:grid-cols-3">
          {!catalog.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-2xl" />)}
          {plans.map((p) => (
            <div key={p.name} className={cn("relative grid content-start gap-5 rounded-2xl border p-6", p.hl ? "border-brand-edge bg-canvas shadow-lg ring-2 ring-brand" : "border-line bg-canvas")}>
              {p.hl && <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-bold text-on-brand">{t("Mais escolhido")}</span>}
              <div><div className="rf-text-title-lg">{p.name}</div><p className="text-sm text-fg-muted">{p.desc}</p></div>
              <div className="flex items-baseline gap-2"><span className="font-display text-[40px] font-extrabold leading-none tracking-tight [font-stretch:110%]">{p.price}</span><span className="text-fg-muted">{p.per}</span></div>
              <ul className="grid gap-2">{p.items.map((x) => <li key={x} className="flex items-start gap-2"><Check className="mt-1 size-4 shrink-0 text-success-text" />{x}</li>)}</ul>
              <ButtonLink to="/login" variant={p.hl ? "primary" : "secondary"} block>{p.cta}</ButtonLink>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-fg-muted">{t("Durante o beta, o Pro é gratuito para os primeiros clubes.")}</p>
      </div>
    </section>
  );
}

function Why() {
  const rows = [
    { k: t("Velocidade"), a: t("Abre em menos de 2 segundos, funciona offline"), b: t("Telas lentas, quedas frequentes") },
    { k: t("Criar treinos"), a: t("Escrita rápida + biblioteca + arrastar e soltar"), b: t("Formulários longos, um aluno por vez") },
    { k: t("Preço para 20 alunos"), a: t("R$ 19,90 por mês"), b: t("A partir de R$ 99 por mês + taxa de ativação") },
    { k: t("Modalidades"), a: t("Corrida, natação, academia e híbridos"), b: t("Geralmente só corrida") },
    { k: t("Marca do clube"), a: t("Logo e cores em todos os planos"), b: t("Raramente disponível") },
  ];
  return (
    <section className="mx-auto grid max-w-4xl gap-8 px-5 py-20">
      <div className="grid gap-3 text-center"><span className="rf-text-overline text-brand-text">{t("Por que o Runflow")}</span><h2 className="rf-text-display-md text-balance">{t("Feito para quem cansou de sistema lento.")}</h2></div>
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[1fr_1.3fr_1.3fr] bg-sunken text-xs font-bold uppercase tracking-[0.06em] text-fg-muted"><span className="p-3" /><span className="p-3 text-brand-text">Runflow</span><span className="p-3">{t("Sistemas tradicionais")}</span></div>
        {rows.map((r) => <div key={r.k} className="grid grid-cols-[1fr_1.3fr_1.3fr] border-t border-line-subtle text-sm"><span className="p-3 font-semibold">{r.k}</span><span className="flex gap-2 p-3"><Check className="size-4 shrink-0 text-success-text" />{r.a}</span><span className="p-3 text-fg-muted">{r.b}</span></div>)}
      </div>
    </section>
  );
}

function Faq() {
  const qa = [
    [t("Preciso de cartão de crédito para começar?"), t("Não. O plano Free é grátis para sempre, até 10 alunos, com todos os recursos.")],
    [t("Meus alunos pagam alguma coisa?"), t("Não. O aluno usa o Runflow de graça, no celular ou no computador.")],
    [t("Funciona com Garmin e Strava?"), t("O Strava já sincroniza as atividades automaticamente. A integração com Garmin, com envio do treino direto para o relógio, chega em breve.")],
    [t("Serve para academia e natação?"), t("Sim. Além das planilhas, o Runflow tem aulas com horários, vagas, lista de espera e check-in. Dá para usar as duas coisas no mesmo clube.")],
    [t("Onde ficam os dados?"), t("No Brasil, seguindo a LGPD. O aluno decide o que compartilha com o clube e pode revogar quando quiser.")],
    [t("Consigo trazer meus treinos atuais?"), t("Sim: cole os treinos na escrita rápida e eles viram treinos estruturados na hora.")],
  ];
  return (
    <section id="faq" className="mx-auto grid max-w-3xl scroll-mt-20 gap-6 px-5 pb-20">
      <h2 className="rf-text-display-sm text-center">{t("Dúvidas frequentes")}</h2>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">
        {qa.map(([q, a]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<ChevronDown className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" /></summary>
            <p className="mt-2 text-fg-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LandingScreen() {
  return (
    <div className="min-h-dvh bg-canvas">
      {IS_MOCK && <DemoLogin />}
      <Header />
      <main>
        <Hero />
        <Modalities />
        <BuilderDemo />
        <Features />
        <Studio />
        <Pricing />
        <Why />
        <Faq />
        <section data-theme="dark" className="bg-canvas text-fg">
          <div className="mx-auto grid max-w-4xl justify-items-center gap-6 px-5 py-20 text-center">
            <h2 className="rf-text-display-md text-balance">{t("Seu clube no Runflow em 5 minutos.")}</h2>
            <p className="max-w-xl text-lg text-fg-muted">{t("Crie o clube, coloque o logo, convide os alunos por e-mail. Pronto.")}</p>
            <div className="flex flex-wrap justify-center gap-3"><ButtonLink to="/login" size="lg" iconRight={<ArrowRight />}>{t("Criar meu clube grátis")}</ButtonLink><ButtonLink to="/login" size="lg" variant="secondary">{t("Já tenho conta")}</ButtonLink></div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">{(["run", "swim", "bike", "mobility"] as Sport[]).map((s) => <SportChip key={s} sport={s} size="sm" />)}</div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-sm text-fg-muted">
          <RunflowHomeLink />
          <span className="inline-flex items-center gap-1.5">© 2026 Runflow · {t("Feito no Brasil")}<img src={flagBr} alt="" aria-hidden width={20} height={14} className="h-3.5 w-5" /></span>
          <span className="ml-auto flex gap-5"><a href="#" className="hover:text-fg">{t("Termos de uso")}</a><a href="#" className="hover:text-fg">{t("Privacidade")}</a><a href="mailto:contato@runflow.club" className="hover:text-fg">contato@runflow.club</a></span>
        </div>
      </footer>
    </div>
  );
}

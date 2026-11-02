/** /dev/logo: logo concepts for the founder to choose from (B1). Dev only: the chosen mark moves to `design/` and
 * replaces RunflowMark everywhere (app, favicon, PWA icons, e-mails, mobile). */
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { tokens } from "@runflow/design/tokens";
import { RunflowMark, RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { Card, cn } from "@/ui";

/** Marks are drawn on a 48 × 48 grid. `ink` paints the main shape, `pop` the Volt highlight; one-color use passes currentColor to both. */
interface Paint { ink: string; pop: string }
type Mark = (p: Paint) => ReactNode;
const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A track loop drawn left to right, with the runner (Volt) out in front. */
const Pista: Mark = ({ ink, pop }) => (
  <>
    <path d="M36.88 22.61A8 8 0 0 1 29 32H19a8 8 0 1 1 0-16h4" stroke={ink} strokeWidth={4.5} {...line} />
    <circle cx={31} cy={16} r={3.3} fill={pop} />
  </>
);
/** A workout's intensity profile, like the builder's chart: easy, hard, recovery, hardest (Volt). */
const Ritmo: Mark = ({ ink, pop }) => (
  <>
    {([[8, 26], [16.8, 16], [25.6, 22], [34.4, 12]] as const).map(([x, y], i) => (
      <rect key={x} x={x} y={y} width={5.6} height={36 - y} rx={2.8} fill={i === 3 ? pop : ink} />
    ))}
  </>
);
/** A lowercase r whose arm (Volt) runs ahead: the name, in motion. */
const Passada: Mark = ({ ink, pop }) => (
  <>
    <path d="M17 22c0-5 3.5-8 9-8h5" stroke={pop} strokeWidth={6.5} {...line} />
    <path d="M17 34V14" stroke={ink} strokeWidth={6.5} {...line} />
  </>
);
/** Two strides forward; the second one (Volt) is the club's progress. */
const Avante: Mark = ({ ink, pop }) => (
  <>
    <path d="M13 14l9 10-9 10" stroke={ink} strokeWidth={5.5} {...line} />
    <path d="M25 14l9 10-9 10" stroke={pop} strokeWidth={5.5} {...line} />
  </>
);

function Tile({ mark, size }: { mark: Mark; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <rect width={48} height={48} rx={13} fill={tokens.seeds.brand} />
      {mark({ ink: tokens.palette.neutral["0"], pop: tokens.seeds.accent })}
    </svg>
  );
}
function OneColor({ mark, size }: { mark: Mark; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">{mark({ ink: "currentColor", pop: "currentColor" })}</svg>;
}

function Concept({ name, idea, why, mark }: { name: string; idea: string; why: string; mark: Mark }) {
  return (
    <Card className="grid gap-5 p-5">
      <div className="grid gap-1">
        <h2 className="rf-text-title-lg">{name}</h2>
        <p>{idea}</p>
        <p className="text-sm text-fg-muted">{why}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["light", "dark"] as const).map((mode) => (
          <div key={mode} data-theme={mode} className="grid gap-5 rounded-lg bg-canvas p-5 text-fg ring-1 ring-line">
            <span className="text-xs font-bold uppercase tracking-wide text-fg-muted">{mode === "light" ? t("Modo claro") : t("Modo escuro")}</span>
            <div className="flex flex-wrap items-end gap-4">
              {[96, 48, 32, 16].map((s) => (
                <div key={s} className="grid justify-items-center gap-1"><Tile mark={mark} size={s} /><span className="text-xs tabular-nums text-fg-subtle">{s}px</span></div>
              ))}
            </div>
            {/* App header and browser tab, the two places people see it most. */}
            <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3 ring-1 ring-line-subtle">
              <RunflowWordmark mark={<Tile mark={mark} size={28} />} />
              <span className="size-8 rounded-full bg-soft" />
            </div>
            <div className="flex w-56 max-w-full items-center gap-2 rounded-t-md bg-surface px-3 py-2 text-sm ring-1 ring-line-subtle">
              <Tile mark={mark} size={16} /><span className="min-w-0 flex-1 truncate">{t("Hoje · Runflow")}</span><X className="size-3.5 text-fg-subtle" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid justify-items-center gap-1.5"><Tile mark={mark} size={60} /><span className="text-xs">{t("Runflow")}</span></div>
              <OneColor mark={mark} size={40} />
              <span className="grid place-items-center rounded-md bg-brand p-2 text-on-brand"><OneColor mark={mark} size={32} /></span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function LogoScreen() {
  const concepts = [
    { name: t("Pista"), mark: Pista, idea: t("Uma volta na pista, desenhada da esquerda para a direita, com o atleta (em Volt) à frente."), why: t("Fala de corrida e de ciclo: semana após semana de treino. Lê bem em 16 px como uma pílula com um ponto. Mais ligado à corrida do que a academia e natação.") },
    { name: t("Ritmo"), mark: Ritmo, idea: t("O perfil de intensidade de um treino, igual ao gráfico do construtor: leve, forte, recuperação, mais forte (em Volt)."), why: t("É o produto: treino estruturado, para qualquer modalidade (corrida, natação, academia). Risco: lembrar um gráfico de barras genérico.") },
    { name: t("Passada"), mark: Passada, idea: t("Um r minúsculo cujo braço (em Volt) corre à frente: o nome, em movimento."), why: t("O mais próprio e fácil de registrar como marca. Depende da letra: funciona melhor ao lado da palavra runflow.") },
    { name: t("Avante"), mark: Avante, idea: t("Dois passos para a frente; o segundo (em Volt) é o progresso do clube."), why: t("O mais simples e legível em qualquer tamanho. Risco: parecer o ícone de avançar de um player.") },
  ];
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-8">
      <header className="grid gap-2">
        <h1 className="rf-text-display-sm">{t("Logo: conceitos")}</h1>
        <p className="text-fg-muted">{t("Quatro direções para o novo símbolo, cada uma no ícone do app, na aba do navegador, no cabeçalho e em uma cor só. A palavra runflow segue em Archivo expandido; dá para ajustar depois. Escolha uma (ou o que misturar) e eu refino a escolhida para todos os tamanhos, e-mails e o app.")}</p>
      </header>
      <Card className="grid gap-4 p-5">
        <h2 className="rf-text-title-md">{t("Lado a lado, no tamanho real")}</h2>
        <div className="flex flex-wrap gap-6">
          {[...concepts, null].map((c) => (
            <div key={c?.name ?? "atual"} className={cn("grid justify-items-center gap-2", !c && "opacity-70")}>
              <div className="flex items-end gap-2">
                {c ? <><Tile mark={c.mark} size={32} /><Tile mark={c.mark} size={16} /></> : <><RunflowMark size={32} /><RunflowMark size={16} /></>}
              </div>
              <span className="text-sm font-semibold">{c?.name ?? t("Atual")}</span>
            </div>
          ))}
        </div>
      </Card>
      {concepts.map((c) => <Concept key={c.name} {...c} />)}
    </div>
  );
}

/** /dev/logo: Runflow's mark, Ritmo (B1, chosen by the founder on 2026-11-03), in every size and context, with the files
 * to download. The mark itself lives in @runflow/design/logo; icons come from `npm run icons`. */
import { Download, X } from "lucide-react";
import { RunflowMark, RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { Card } from "@/ui";

const FILES = [
  { href: "/brand/runflow-mark.svg", label: "Símbolo (SVG)" },
  { href: "/brand/runflow-mark-mono.svg", label: "Símbolo em uma cor (SVG)" },
  { href: "/icons/icon-512.png", label: "Ícone 512 px (PNG)" },
  { href: "/icons/maskable-512.png", label: "Ícone de app, fundo inteiro (PNG)" },
];

export function LogoScreen() {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-8">
      <header className="grid gap-2">
        <RunflowWordmark />
        <h1 className="rf-text-display-sm">{t("Logo: Ritmo")}</h1>
        <p className="text-fg-muted">{t("O perfil de intensidade de um treino, como no construtor: leve, forte, recuperação e o mais forte em Volt. Sempre nas cores do Runflow, nunca nas do clube.")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {(["light", "dark"] as const).map((mode) => (
          <div key={mode} data-theme={mode} className="grid gap-5 rounded-lg bg-canvas p-5 text-fg ring-1 ring-line">
            <span className="text-xs font-bold uppercase tracking-wide text-fg-muted">{mode === "light" ? t("Modo claro") : t("Modo escuro")}</span>
            <div className="flex flex-wrap items-end gap-4">
              {[96, 48, 32, 16].map((s) => (
                <div key={s} className="grid justify-items-center gap-1"><RunflowMark size={s} /><span className="text-xs tabular-nums text-fg-subtle">{s}px</span></div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3 ring-1 ring-line-subtle">
              <RunflowWordmark />
              <span className="size-8 rounded-full bg-soft" />
            </div>
            <div className="flex w-56 max-w-full items-center gap-2 rounded-t-md bg-surface px-3 py-2 text-sm ring-1 ring-line-subtle">
              <RunflowMark size={16} /><span className="min-w-0 flex-1 truncate">{t("Hoje · Runflow")}</span><X className="size-3.5 text-fg-subtle" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid justify-items-center gap-1.5"><RunflowMark size={60} /><span className="text-xs">{t("Runflow")}</span></div>
              <RunflowMark size={40} mono />
              <span className="grid place-items-center rounded-md bg-brand p-2 text-on-brand"><RunflowMark size={32} mono /></span>
            </div>
          </div>
        ))}
      </div>
      <Card className="grid gap-3 p-5">
        <h2 className="rf-text-title-md">{t("Arquivos")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FILES.map((f) => (
            <li key={f.href}>
              <a href={f.href} download className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-soft">
                <Download className="size-4 text-fg-muted" aria-hidden />{t(f.label)}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

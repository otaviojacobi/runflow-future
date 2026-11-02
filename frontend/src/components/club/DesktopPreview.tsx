import { CalendarDays, ClipboardList, LayoutDashboard, MessageSquare, Plus, Trophy, Users } from "lucide-react";
import type { Branding } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { cn } from "@/ui";

/** A miniature of the trainer's web app under a theme. `vars` (lib/theme themeVars) scope the colors to this preview. */
export function DesktopPreview({ name, logoUrl, mode, vars, className }: { name: string; logoUrl?: string | null; mode: "light" | "dark"; vars?: Record<string, string>; className?: string }) {
  const branding = logoUrl && !logoUrl.startsWith("data:") ? ({ logo_url: logoUrl } as Pick<Branding, "logo_url">) : null;
  const nav = [[LayoutDashboard, "Painel", true], [Users, "Alunos"], [CalendarDays, "Planejamento"], [MessageSquare, "Feedbacks"], [ClipboardList, "Planilhas"]] as const;
  const bars = [62, 74, 70, 81, 77, 88, 84, 92];
  return (
    <div data-theme={mode} style={vars} className={cn("overflow-hidden rounded-xl border border-line bg-canvas text-fg shadow-lg", className)} aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3 py-2">
        {[0, 1, 2].map((i) => <i key={i} className="size-2.5 rounded-full bg-line-strong" />)}
        <span className="ml-3 h-5 flex-1 rounded-full bg-surface px-3 text-[10px] leading-5 text-fg-muted">runflow.club/dashboard</span>
      </div>
      <div className="grid grid-cols-[150px_1fr]">
        <aside className="grid min-w-0 content-start gap-1 overflow-hidden border-r border-line bg-surface p-2.5">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {logoUrl?.startsWith("data:") ? <img src={logoUrl} alt="" className="size-7 rounded-[8px] bg-surface object-contain p-0.5 ring-1 ring-line" /> : <ClubLogo club={{ name: name || "Clube" }} branding={branding} size={28} />}
            <span className="min-w-0 truncate text-[11px] font-bold">{name || t("Seu clube")}</span>
          </div>
          {nav.map(([I, label, active]) => (
            <span key={label} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold", active ? "bg-brand-soft text-on-brand-soft" : "text-fg-muted")}><I className="size-3.5" />{t(label)}</span>
          ))}
        </aside>
        <main className="grid min-w-0 content-start gap-3 p-4">
          <div className="flex items-end justify-between gap-2">
            <div><div className="text-[10px] text-fg-muted">{t("terça-feira, 3 de novembro")}</div><div className="font-display text-lg font-bold leading-tight">{t("Bom dia, Júlia")}</div></div>
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-brand-edge bg-brand px-2.5 text-[11px] font-semibold text-on-brand"><Plus className="size-3.5" />{t("Novo treino")}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Treinos hoje", "14/18"], ["Aderência", "86%"], ["Feedbacks", "5"]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface p-2"><div className="text-[9px] text-fg-muted">{t(k!)}</div><div className="font-display text-base font-bold tabular-nums">{v}</div></div>
            ))}
          </div>
          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <div className="mb-2 text-[10px] font-semibold">{t("Aderência por semana")}</div>
              <div className="flex h-16 items-end gap-[3px]">{bars.map((h, i) => <i key={i} className="flex-1 rounded-t-[3px] bg-brand-text" style={{ height: `${h}%`, opacity: i === bars.length - 1 ? 1 : 0.55 }} />)}</div>
            </div>
            <div className="grid content-start gap-1.5 rounded-lg border border-line bg-surface p-2.5">
              <div className="text-[10px] font-semibold">{t("Destaques")}</div>
              <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-[9px] font-bold text-on-accent ring-1 ring-inset ring-accent-edge"><Trophy className="size-3" />{t("Recorde")}</span>
              <span className="text-[10px] text-fg-muted">{t("Ana · 10 km em 48:12")}</span>
              <span className="text-[10px] font-semibold text-brand-text">{t("Ver todos")}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

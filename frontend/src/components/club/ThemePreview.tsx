import { Bell, Calendar, ChevronRight, Flame, Footprints, Sun, Trophy, User } from "lucide-react";
import type { Branding } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import type { Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { cn } from "@/ui";

const SAMPLE: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" } } ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };

/** A small phone showing the active theme (brand + accent) on real UI. `mode` forces light/dark. */
export function ThemePreview({ name, logoUrl, mode, className }: { name: string; logoUrl?: string | null; mode?: "light" | "dark"; className?: string }) {
  const branding = logoUrl ? ({ logo_url: logoUrl } as Pick<Branding, "logo_url">) : null;
  return (
    <div data-theme={mode} className={cn("w-[260px] shrink-0 rounded-[38px] bg-[var(--rf-neutral-1000)] p-2 shadow-lg", className)}>
      <div className="flex h-[500px] flex-col overflow-hidden rounded-[30px] bg-canvas text-fg">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-6">
          {logoUrl?.startsWith("data:") ? <img src={logoUrl} alt="" className="size-9 rounded-[10px] bg-surface object-contain p-0.5 ring-1 ring-line" /> : <ClubLogo club={{ name: name || "Clube" }} branding={branding} size={36} />}
          <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-fg-muted">{name || t("Seu clube")}</div><div className="text-[17px] font-bold leading-tight">{t("Bom dia, Ana")}</div></div>
          <span className="grid size-8 place-items-center rounded-full ring-1 ring-line"><Bell className="size-4" /></span>
        </div>
        <div className="flex flex-1 flex-col gap-3 px-3">
          <div className="flex items-center justify-between px-1"><span className="rf-text-overline text-fg-muted">{t("Hoje")}</span><span className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-on-accent-soft ring-1 ring-inset ring-accent-line"><Flame className="size-3.5" />{t("12 semanas")}</span></div>
          <div className="grid gap-2.5 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between"><SportChip sport="run" size="sm" /><span className="text-[11px] text-fg-muted">≈ 59 min</span></div>
            <div className="text-[15px] font-semibold">Intervalado 6×1 km</div>
            <IntensityProfile structure={SAMPLE} sport="run" height={36} />
            <span className="flex h-10 items-center justify-center gap-1 rounded-md border border-brand-edge bg-brand text-sm font-semibold text-on-brand">{t("Ver treino")}<ChevronRight className="size-4" /></span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-3">
            <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-accent px-2 text-[11px] font-bold text-on-accent ring-1 ring-inset ring-accent-edge"><Trophy className="size-3.5" />{t("Recorde")}</span>
            <span className="text-xs text-fg-muted">5 km · 21:32</span>
            <span className="ml-auto text-xs font-semibold text-brand-text">{t("Ver")}</span>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-line bg-surface px-1 pb-4 pt-2">
          {[[Sun, "Hoje", true], [Calendar, "Agenda"], [Footprints, "Atividades"], [User, "Perfil"]].map(([I, l, a], i) => {
            const Icon = I as typeof Sun;
            return <span key={i} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-semibold", a ? "text-fg" : "text-fg-muted")}><span className={cn("grid h-6 w-10 place-items-center rounded-full", a && "bg-brand-soft text-on-brand-soft")}><Icon className="size-4" /></span>{t(l as string)}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

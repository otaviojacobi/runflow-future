import { assetUrl } from "@/lib/api";
import { Tabs as RTabs } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";
const SOFT: Record<Tone, string> = {
  neutral: "bg-soft text-fg-muted", brand: "bg-brand-soft text-on-brand-soft", accent: "bg-accent-soft text-on-accent-soft",
  success: "bg-success-soft text-on-success-soft", warning: "bg-warning-soft text-on-warning-soft", danger: "bg-danger-soft text-on-danger-soft", info: "bg-info-soft text-on-info-soft",
};
const SOLID: Record<Tone, string> = {
  neutral: "bg-inverse text-fg-inverse", brand: "bg-brand text-on-brand", accent: "bg-accent text-on-accent",
  success: "bg-success text-on-success", warning: "bg-warning text-on-warning", danger: "bg-danger text-on-danger", info: "bg-info text-on-info",
};
export function Badge({ tone = "neutral", solid, icon, children, className }: { tone?: Tone; solid?: boolean; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-sm px-2 text-xs font-bold [&_svg]:size-3.5", solid ? SOLID[tone] : SOFT[tone], className)}>{icon}{children}</span>;
}
const CARD_TONE = { brand: "border-brand-line bg-brand-soft text-on-brand-soft", accent: "border-accent-line bg-accent-soft text-on-accent-soft", danger: "border-danger-line bg-danger-soft text-on-danger-soft", warning: "border-warning-line bg-warning-soft text-on-warning-soft", info: "border-info-line bg-info-soft text-on-info-soft" } as const;
const CARD_EDGE = { brand: "border-brand-line", danger: "border-danger-line", warning: "border-warning-line" } as const;
/** `tone` tints the whole card; `edge` only colors the border (cn does not merge conflicting utilities, so use these props). */
export function Card({ className, tone, edge, ...p }: ComponentProps<"div"> & { tone?: keyof typeof CARD_TONE; edge?: keyof typeof CARD_EDGE }) {
  return <div className={cn("rounded-lg border shadow-sm", tone ? CARD_TONE[tone] : cn("bg-surface", edge ? CARD_EDGE[edge] : "border-line"), className)} {...p} />;
}
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return src ? (
    <img src={assetUrl(src) ?? undefined} alt="" style={style} className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span aria-hidden style={style} className={cn("inline-grid shrink-0 place-items-center rounded-full bg-soft font-bold text-fg-muted", className)}>{ini}</span>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-soft", className)} />;
}
export function ProgressBar({ value, max = 100, tone = "brand", label, className }: { value: number; max?: number; tone?: Tone; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { neutral: "bg-fg-subtle", brand: "bg-brand", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" }[tone];
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className={cn("h-1.5 overflow-hidden rounded-full bg-soft", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-standard", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {icon && <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-on-brand-soft [&_svg]:size-6">{icon}</span>}
      <h3 className="rf-text-title-md">{title}</h3>
      {children && <p className="max-w-sm text-fg-muted">{children}</p>}
      {action}
    </div>
  );
}
export function PageHeader({ title, subtitle, eyebrow, actions, className }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="rf-text-overline mb-1 text-fg-muted">{eyebrow}</div>}
        <h1 className="rf-text-display-sm text-balance">{title}</h1>
        {subtitle && <p className="mt-1 text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
export const Tabs = {
  Root: RTabs.Root,
  List: ({ className, ...p }: ComponentProps<typeof RTabs.List>) => <RTabs.List className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} {...p} />,
  Trigger: ({ className, ...p }: ComponentProps<typeof RTabs.Trigger>) => (
    <RTabs.Trigger className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-fg-muted transition-colors hover:text-fg data-[state=active]:border-brand data-[state=active]:text-fg", className)} {...p} />
  ),
  Content: ({ className, ...p }: ComponentProps<typeof RTabs.Content>) => <RTabs.Content className={cn("pt-5 focus-visible:outline-none", className)} {...p} />,
};

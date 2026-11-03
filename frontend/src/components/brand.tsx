import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import Color from "@runflow/design/color";
import Logo from "@runflow/design/logo";
import { tokens } from "@runflow/design/tokens";
import type { Branding, Club } from "@/api/types";
import { initials } from "@/lib/format";
import { cn } from "@/ui";

/** Runflow's mark, Ritmo (B1, @runflow/design/logo): always Runflow colors, never club-themed (D-018). `mono` draws the
 * bars alone in the current text color (on brand or dark surfaces, print). */
export function RunflowMark({ size = 32, className, mono }: { size?: number; className?: string; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${Logo.GRID} ${Logo.GRID}`} aria-hidden className={className}>
      {!mono && <rect width={Logo.GRID} height={Logo.GRID} rx={Logo.TILE_RADIUS} fill={tokens.seeds.brand} />}
      {Logo.BARS.map((b) => (
        <rect key={b.x} x={b.x} y={b.top} width={Logo.BAR.width} height={Logo.BAR.baseline - b.top} rx={Logo.BAR.radius}
          fill={mono ? "currentColor" : b.accent ? tokens.seeds.accent : tokens.palette.neutral["0"]} />
      ))}
    </svg>
  );
}
/** The wordmark as a link to the landing page (`/`): top left on public pages (sign-in, invite, clubs, club creation). */
export function RunflowHomeLink({ className }: { className?: string }) {
  return (
    <Link to="/" aria-label="Runflow" className={cn("inline-flex rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-ring", className)}>
      <RunflowWordmark />
    </Link>
  );
}

export function RunflowWordmark({ className, mark }: { className?: string; mark?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark ?? <RunflowMark size={28} />}
      <span className="font-display text-[22px] font-extrabold leading-none tracking-[-0.035em] [font-stretch:115%]">runflow</span>
    </span>
  );
}
/** Club logo: uploaded image, or initials on the club's primary color. */
export function ClubLogo({ club, branding, size = 36, className }: { club: Pick<Club, "name">; branding?: Pick<Branding, "logo_url"> | Branding | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (branding?.logo_url) return <img src={`/api${branding.logo_url}`} alt="" style={style} className={cn("shrink-0 rounded-[10px] bg-surface object-contain p-0.5 ring-1 ring-line", className)} />;
  // Each club in its own primary color (the switcher lists several clubs at once); falls back to the active theme.
  const primary = branding && "theme" in branding ? (branding as Branding).theme?.primary : undefined;
  const own = primary ? { background: primary, color: Color.contrast(primary, tokens.palette.neutral["0"]) >= 4.5 ? tokens.palette.neutral["0"] : tokens.palette.neutral["950"] } : undefined;
  return (
    <span aria-hidden style={{ ...style, ...own, fontSize: Math.round(size * 0.36) }}
      className={cn("inline-grid shrink-0 place-items-center rounded-[10px] bg-brand font-display font-extrabold tracking-[-0.02em] text-on-brand ring-1 ring-inset ring-line [font-stretch:112%]", className)}>
      {initials(club.name)}
    </span>
  );
}

import { tokens } from "@runflow/design/tokens";
import type { Branding, Club } from "@/api/types";
import { initials } from "@/lib/format";
import { cn } from "@/ui";

/** Runflow's own mark: always Runflow colors, never club-themed (D-018). Placeholder until the final logo. */
export function RunflowMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" fill={tokens.seeds.brand} />
      <path d="M6.5 21c3.2 0 4.4-8.5 8.7-8.5S20 21 25.5 21" fill="none" stroke={tokens.seeds.accent} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="24.4" cy="9.8" r="2.5" fill={tokens.seeds.accent} />
    </svg>
  );
}
export function RunflowWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <RunflowMark size={28} />
      <span className="font-display text-[22px] font-extrabold leading-none tracking-[-0.035em] [font-stretch:115%]">runflow</span>
    </span>
  );
}
/** Club logo: uploaded image, or initials on the club's primary color. */
export function ClubLogo({ club, branding, size = 36, className }: { club: Pick<Club, "name">; branding?: Pick<Branding, "logo_url"> | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (branding?.logo_url) return <img src={`/api${branding.logo_url}`} alt="" style={style} className={cn("shrink-0 rounded-[10px] bg-surface object-contain p-0.5 ring-1 ring-line", className)} />;
  return (
    <span aria-hidden style={{ ...style, fontSize: Math.round(size * 0.36) }}
      className={cn("inline-grid shrink-0 place-items-center rounded-[10px] bg-brand font-display font-extrabold tracking-[-0.02em] text-on-brand ring-1 ring-inset ring-brand-edge [font-stretch:112%]", className)}>
      {initials(club.name)}
    </span>
  );
}

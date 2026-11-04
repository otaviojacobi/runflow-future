/**
 * Strava's brand, as its guidelines require (docs/strava-brand.md): the official "Connect with Strava" button, the
 * "Powered by Strava" logo where Strava data shows, and "View on Strava" links back to the activity. The artwork in
 * assets/strava is Strava's, unmodified; only its size and the space around it are ours.
 */
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import connectButton from "@/assets/strava/btn_strava_connect_with_orange.svg";
import poweredBlack from "@/assets/strava/api_logo_pwrdBy_strava_horiz_black.svg";
import poweredWhite from "@/assets/strava/api_logo_pwrdBy_strava_horiz_white.svg";
import { t } from "@/i18n";
import { cn } from "@/ui";

/** Strava's page for one of its activities. */
export const stravaActivityUrl = (externalId: string) => `https://www.strava.com/activities/${encodeURIComponent(externalId)}`;

/**
 * The official orange "Connect with Strava" button (48 px high). The focus ring and the busy state sit around the
 * image, never on it. The name reads in pt-BR and still contains the image's own words.
 */
export function StravaConnectButton({ loading, className, ...rest }: { loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <button type="button" {...rest} disabled={loading || rest.disabled} aria-busy={loading || undefined}
        className="relative shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-brand-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed aria-busy:cursor-wait">
        <span className="sr-only">{t("Conectar com Strava")}</span>
        <img src={connectButton} alt="Connect with Strava" lang="en" width={237} height={48} className="block h-12 w-auto" draggable={false} />
      </button>
      {loading && <LoaderCircle className="size-5 animate-spin text-fg-muted" aria-hidden />}
    </span>
  );
}

/** "Powered by Strava", small and quiet: black artwork on light, white on dark (the nearest data-theme decides; the
 * hidden one is display:none, so screen readers hear it once). */
export function PoweredByStrava({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex", className)}>
      <img src={poweredBlack} alt="Powered by Strava" lang="en" width={365} height={37} className="rf-art-light h-4 w-auto" draggable={false} />
      <img src={poweredWhite} alt="Powered by Strava" lang="en" width={365} height={37} className="rf-art-dark h-4 w-auto" draggable={false} />
    </span>
  );
}

/** "View on Strava" (Strava's wording, never translated): bold and underlined, opens Strava in a new tab. */
export function ViewOnStrava({ externalId, className }: { externalId: string; className?: string }) {
  return (
    <a href={stravaActivityUrl(externalId)} target="_blank" rel="noopener noreferrer" lang="en"
      className={cn("text-sm font-bold text-fg underline underline-offset-2 hover:text-fg-muted focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-ring", className)}>
      View on Strava
    </a>
  );
}

/** The footer line under Strava data: the logo and, for one activity, the link back to it. */
export function StravaAttribution({ externalId, className }: { externalId?: string | null; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <PoweredByStrava />
      {externalId && <ViewOnStrava externalId={externalId} />}
    </div>
  );
}

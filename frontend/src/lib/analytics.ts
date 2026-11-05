/** Product analytics with self-hosted Umami (D-054): cookieless page views and named events, so we learn where clubs come
 * from (referrers, UTM campaigns) and how far they get. Loaded after the first render and only when the API hands out
 * a website id in `/public/config`, so the mock and local dev never load it. Nothing personal is sent: page paths with
 * token-like segments masked, no query string except the campaign (`utm_*`, `ref`) and sign-in `perfil` parameters, a fixed title, and
 * same-site referrers masked like the path. Browsers that ask not to be tracked (Do Not Track) aren't. */
import { maskUrl } from "./sentry";

export interface AnalyticsConfig { website_id: string; script_url: string }

interface UmamiPayload { url?: string; referrer?: string; title?: string; [k: string]: unknown }
interface Umami { track: (arg?: string | ((p: UmamiPayload) => UmamiPayload), data?: Record<string, string | number | boolean>) => void }
declare global { interface Window { umami?: Umami } }

// Campaigns (`utm_*`, `ref`) and the sign-in's `perfil` (the landing's "Criar meu clube grátis" sends
// `perfil=treinador`, so that step of the funnel is its own page).
const KEPT_PARAMS = /^(utm_(source|medium|campaign|term|content)|ref|perfil)$/;

/** The path Umami records: token-like segments masked, only campaign parameters kept. */
export function analyticsUrl(href: string): string {
  try {
    const u = new URL(href, globalThis.location?.origin ?? "http://localhost");
    const kept = [...u.searchParams].filter(([k]) => KEPT_PARAMS.test(k));
    const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
    return maskUrl(u.pathname) + query;
  } catch {
    return "/";
  }
}

/** Where the visit came from: other sites as they are (that's the point), our own pages masked like the path. */
export function analyticsReferrer(referrer: string, origin: string): string {
  if (!referrer) return "";
  try {
    const r = new URL(referrer);
    return r.origin === origin ? origin + maskUrl(r.pathname) : r.origin + r.pathname;
  } catch {
    return "";
  }
}

let started = false;
let lastUrl = "";

function sanitize(p: UmamiPayload): UmamiPayload {
  const origin = globalThis.location?.origin ?? "";
  return { ...p, url: analyticsUrl(globalThis.location?.href ?? "/"), referrer: analyticsReferrer(p.referrer ?? "", origin), title: "Runflow" };
}

/** A page view for the current URL (called on every route change; repeats of the same URL are skipped). */
export function trackPageView() {
  const url = analyticsUrl(globalThis.location?.href ?? "/");
  if (!window.umami || url === lastUrl) return;
  lastUrl = url;
  window.umami.track(sanitize);
}

/** A named step people take (e.g. `cta_criar_clube`). Data: small, never personal. */
export function trackEvent(name: string, data?: Record<string, string | number | boolean>) {
  window.umami?.track(name, data);
}

export function startAnalytics(c: AnalyticsConfig, onReady: () => void) {
  if (started || typeof document === "undefined") return;
  started = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = c.script_url;
  s.dataset.websiteId = c.website_id;
  // Page views are sent by trackPageView (masked URLs), never automatically with the raw URL.
  s.dataset.autoTrack = "false";
  s.dataset.doNotTrack = "true";
  s.addEventListener("load", onReady);
  document.head.appendChild(s);
}

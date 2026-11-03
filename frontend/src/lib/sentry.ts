/** Errors to Sentry (S12, D-033). The SDK loads lazily (outside the initial-JS budget) and only when the API hands
 * out a DSN in `/public/config`, so the mock and local dev never load it. Events carry the user id only: no
 * headers, cookies or query strings, and token-like path segments (invites, for example) are masked. */
import type { ErrorEvent, Breadcrumb } from "@sentry/react";

type Sdk = typeof import("@sentry/react");
export interface SentryConfig { dsn: string; environment: string; release: string }

let sdk: Sdk | null = null;
let user: string | null = null;

const TOKENISH = /^[A-Za-z0-9_-]{20,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The URL without its query or fragment, token-like segments masked. */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw, globalThis.location?.origin ?? "http://localhost");
    const path = u.pathname.split("/").map((s) => (TOKENISH.test(s.split(".")[0]) && !UUID.test(s) ? "[token]" : s)).join("/");
    return (raw.startsWith("/") ? "" : u.origin) + path;
  } catch {
    return "[url]";
  }
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) event.request = { url: event.request.url ? maskUrl(event.request.url) : undefined, method: event.request.method };
  event.user = event.user?.id ? { id: event.user.id } : undefined;
  return event;
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  const d = b.data;
  if (d) for (const k of ["url", "from", "to"]) if (typeof d[k] === "string") d[k] = maskUrl(d[k]);
  return b;
}

export async function startSentry(c: SentryConfig) {
  if (sdk) return;
  const S = await import("@sentry/react");
  S.init({
    dsn: c.dsn, environment: c.environment, release: c.release,
    // Collect nothing personal; the scrubbers below are the second line of defense.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: scrubEvent, beforeBreadcrumb: scrubBreadcrumb,
  });
  sdk = S;
  S.setUser(user ? { id: user } : null);
}

/** Who is signed in (the id only); null on sign-out. Works before the SDK loads. */
export function setErrorUser(id: string | null) {
  user = id;
  sdk?.setUser(id ? { id } : null);
}

/** Errors the app catches itself (the route error screen). */
export function reportError(error: unknown) {
  sdk?.captureException(error);
}

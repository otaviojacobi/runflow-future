/**
 * Connecting Strava from the phone (api/endpoints.md § Providers; root.md §5).
 *
 * `start` with `client: app` gives Strava's mobile authorize page (it opens the Strava app when installed) and the
 * `redirect_uri` `runflow://<web host>/connect/strava`. The page opens in an auth session; Strava comes back either
 * into that session (iOS, or Android's custom tab) or as a deep link into the app (when the Strava app handled it),
 * which +native-intent sends to the /connect/strava route. Both end in `finish`, which runs once per code.
 *
 * The mock answers a relative `authorize_url` (no real Strava): the apps show their own consent sheet and finish with
 * `mock-code`, like the web app.
 */
import * as WebBrowser from "expo-web-browser";
import { accountKeys } from "@/api/account";
import { invalidateTraining } from "@/api/activities";
import { t } from "@/i18n";
import { queryClient } from "@/queryClient";
import { toast } from "@/ui";
import { ApiError, api } from "./api";

export interface StravaReturn { code: string; state?: string; scope?: string }
type Started = { authorize_url: string; state: string; redirect_uri: string };

let back: string | null = null;
/** Where to return after Strava (the screen that started it), for the deep-link route; null → Minha conta. */
export const stravaBack = () => back;

const finishing = new Map<string, Promise<void>>();
/** Hands Strava's answer to the API once per code (the auth session and the deep link may both deliver it). */
export function finishStrava(r: StravaReturn): Promise<void> {
  let p = finishing.get(r.code);
  if (!p) {
    p = api.post("/me/connections/strava/callback", r).then(
      () => {
        void queryClient.invalidateQueries({ queryKey: accountKeys.connections });
        void queryClient.invalidateQueries({ queryKey: accountKeys.consents });
        invalidateTraining();
        toast.success(t("Strava conectado"), t("Suas atividades recentes estão chegando."));
      },
      (err: unknown) => { toast.error(err); throw err; },
    );
    finishing.set(r.code, p);
  }
  return p;
}

/** Strava's `?code&state&scope` (or `?error=access_denied`) from the URL it sent the person back to. */
export function stravaParams(url: string): StravaReturn | { error: string } {
  const q = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
  const code = q.get("code");
  if (!code) return { error: q.get("error") ?? "missing_code" };
  return { code, state: q.get("state") ?? undefined, scope: q.get("scope") ?? undefined };
}

/** pt-BR reason for a failed connection, from Strava's `error` or the API's problem. */
export const stravaFailure = (err: unknown) =>
  err === "access_denied" ? t("Você não autorizou o acesso. Pode tentar de novo quando quiser.")
    : err instanceof ApiError ? err.detail : t("O Strava não devolveu a autorização. Tente conectar de novo.");

/**
 * Starts the connection from `from` (a route path). Resolves "connected", "cancelled" (closed or denied), or "mock"
 * (the caller shows the stand-in consent and calls `finishStrava({ code: "mock-code", state })`). Throws the API's
 * errors (e.g. `503 strava.unavailable`).
 */
export async function connectStrava(from: string): Promise<{ result: "connected" | "cancelled" } | { result: "mock"; state: string }> {
  const s = await api.post<Started>("/me/connections/strava/start", { client: "app" });
  if (s.authorize_url.startsWith("/")) return { result: "mock", state: s.state };
  back = from;
  const r = await WebBrowser.openAuthSessionAsync(s.authorize_url, s.redirect_uri);
  // Closed without an answer: the Strava app may still deliver it as a deep link (the /connect/strava route).
  if (r.type !== "success") return { result: "cancelled" };
  const p = stravaParams(r.url);
  if ("error" in p) {
    if (p.error !== "access_denied") toast.info(t("Não conectamos o Strava"), stravaFailure(p.error));
    return { result: "cancelled" };
  }
  await finishStrava(p);
  return { result: "connected" };
}

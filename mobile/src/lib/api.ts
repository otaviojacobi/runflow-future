/**
 * API client (the contract is api/endpoints.md). Errors are problem+json with pt-BR title/detail: show them as they are.
 * Base URL: EXPO_PUBLIC_API_URL, else the mock on this machine (Android emulator reaches the host as 10.0.2.2).
 * On a physical phone set EXPO_PUBLIC_API_URL=http://<your-computer-ip>:8787/v1.
 */
import { Platform } from "react-native";
import { t } from "@/i18n";
import { session } from "./session";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:8787/v1" : "http://localhost:8787/v1");

export class ApiError extends Error {
  /** Seconds from `Retry-After` (429 cooldowns), when the API sent one. */
  public retryAfter: number | null = null;
  constructor(public status: number, public code: string, public title: string, public detail: string, public errors: { field: string; message: string }[] = []) { super(title); }
  fieldError(field: string) { return this.errors.find((e) => e.field === field)?.message; }
}

/**
 * The web app, for what lives only there for now (creating a club, desktop tools): EXPO_PUBLIC_WEB_URL, else derived
 * from the API (same-origin deployments serve the API at <web>/api/v1; the local mock pairs :8787 with :8080).
 */
export const WEB_URL: string | null = process.env.EXPO_PUBLIC_WEB_URL
  ?? (API_URL.endsWith("/api/v1") ? API_URL.slice(0, -"/api/v1".length) : /:8787\/v1$/.test(API_URL) ? API_URL.replace(/:8787\/v1$/, ":8080") : null);

/** API asset paths (`/v1/assets/…`) as absolute URLs on the API's host. */
export const assetUrl = (u: string | null | undefined) => (u ? (u.startsWith("/v1/") ? API_URL.replace(/\/v1$/, "") + u : u) : null);

let onUnauthorized: (() => void) | null = null;
/** Called when a signed-in request answers 401 (the session expired or was revoked). */
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.token();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { Accept: "application/json", "X-Client": "mobile", ...(body !== undefined && { "Content-Type": "application/json" }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network.offline", t("Sem conexão"), t("Confira sua internet e tente de novo."));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && token === session.token()) onUnauthorized?.();
    const err = new ApiError(res.status, data?.code ?? "unknown", data?.title ?? t("Algo deu errado"), data?.detail ?? t("Tente novamente em instantes."), data?.errors ?? []);
    const retry = Number(res.headers.get("Retry-After"));
    if (retry > 0) err.retryAfter = retry;
    throw err;
  }
  return data as T;
}
export { qs, queryOf } from "./query";

export const api = {
  get: <T,>(p: string) => request<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T,>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T,>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T = void,>(p: string, b?: unknown) => request<T>("DELETE", p, b),
};

import { t } from "@/i18n";
import { session } from "./session";

/** problem+json from the API (titles/details are pt-BR, code is stable English). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public title: string,
    public detail: string,
    public errors: { field: string; message: string }[] = [],
  ) {
    super(title);
  }
  fieldError(field: string) {
    return this.errors.find((e) => e.field === field)?.message;
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.token();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", t("Sem conexão"), t("Verifique sua internet e tente de novo."));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) {
      session.clear();
      onUnauthorized?.();
    }
    throw new ApiError(
      res.status,
      data?.code ?? "unknown",
      data?.title ?? t("Algo deu errado"),
      data?.detail ?? t("Tente novamente em instantes."),
      data?.errors ?? [],
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

/** Query string from an object, skipping empty values. */
export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

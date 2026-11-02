/**
 * API client (the contract is api/endpoints.md). Errors are problem+json with pt-BR title/detail: show them as they are.
 * Base URL: EXPO_PUBLIC_API_URL, else the mock on this machine (Android emulator reaches the host as 10.0.2.2).
 * On a physical phone set EXPO_PUBLIC_API_URL=http://<your-computer-ip>:8787/v1.
 */
import { Platform } from "react-native";
import { secure } from "./secure";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:8787/v1" : "http://localhost:8787/v1");

export class ApiError extends Error {
  constructor(public status: number, public code: string, public title: string, public detail: string, public errors: { field: string; message: string }[] = []) { super(title); }
  fieldError(field: string) { return this.errors.find((e) => e.field === field)?.message; }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const session = {
  async load() { token = await secure.getToken(); return token; },
  async set(t: string | null) { token = t; await secure.setToken(t); },
  isSignedIn: () => !!token,
  onUnauthorized: (fn: () => void) => { onUnauthorized = fn; },
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { Accept: "application/json", "X-Client": "mobile", ...(body !== undefined && { "Content-Type": "application/json" }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network.offline", "Sem conexão", "Confira sua internet e tente de novo.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, data?.code ?? "unknown", data?.title ?? "Algo deu errado", data?.detail ?? "Tente novamente em instantes.", data?.errors ?? []);
  }
  return data as T;
}
export const api = {
  get: <T,>(p: string) => request<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T,>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T,>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T = void,>(p: string) => request<T>("DELETE", p),
};

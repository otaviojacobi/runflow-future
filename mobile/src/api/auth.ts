/**
 * Sign-in (A2): an e-mail code, or Google. Google's native SDK (lib/google.ts) gives an ID token for the web OAuth
 * client named in `/public/config`; it goes to the same POST /auth/google as the web's. On the mock (no client id),
 * `/mock/accounts` answers and the app shows the web's stand-in chooser instead.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offline } from "@/lib/offline";
import { forgetPushDevice } from "@/lib/push";
import { session } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { fetchMe, meKey } from "./me";
import type { AuthResult } from "./types";

async function finishSignIn(r: AuthResult) {
  await session.start(r.token);
  queryClient.removeQueries();
  return { ...r, me: await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe }) };
}
export const useEmailStart = () => useMutation({ mutationFn: (email: string) => api.post<{ sent: boolean; expires_in_s: number; dev_code?: string }>("/auth/email/start", { email }) });
export const useEmailVerify = () => useMutation({ mutationFn: (v: { email: string; code: string }) => api.post<AuthResult>("/auth/email/verify", v).then(finishSignIn) });
/** A Google ID token (the mock takes an e-mail instead). */
export const useGoogleSignIn = () => useMutation({ mutationFn: (id_token: string) => api.post<AuthResult>("/auth/google", { id_token }).then(finishSignIn) });

/** What the apps need before sign-in (api/endpoints.md § Operations). */
export interface PublicConfig { google_client_id: string | null; strava: boolean }
export const usePublicConfig = () => useQuery({ queryKey: ["public-config"], staleTime: 5 * 60_000, queryFn: () => api.get<PublicConfig>("/public/config") });
/** The mock's demo accounts (mock-only route): answers only on the mock, which is how the app knows it's there. */
export type MockAccount = { email: string; name: string; roles: { club: string; role: string }[] };
export const useMockAccounts = (enabled: boolean) =>
  useQuery({ queryKey: ["mock-accounts"], enabled, retry: false, staleTime: Infinity, queryFn: () => api.get<MockAccount[]>("/mock/accounts") });

/** Drop the session and everything cached about the person on this device (incl. the offline week). */
export async function endSession() {
  offline.clear();
  await session.clear();
  queryClient.clear();
}
export async function signOut() {
  // This phone stops getting the person's pushes before the session (needed to say so) ends.
  await forgetPushDevice();
  await api.post("/auth/logout").catch(() => undefined);
  await endSession();
}

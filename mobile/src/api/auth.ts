/**
 * Sign-in (A2): e-mail code now. Google needs the native SDK, which Expo Go doesn't ship: it arrives with the first
 * development build (docs/build-plan.md X10): the native ID token goes to the same POST /auth/google.
 */
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offline } from "@/lib/offline";
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

/** Drop the session and everything cached about the person on this device (incl. the offline week). */
export async function endSession() {
  offline.clear();
  await session.clear();
  queryClient.clear();
}
export async function signOut() {
  await api.post("/auth/logout").catch(() => undefined);
  await endSession();
}

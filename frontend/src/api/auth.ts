import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { session } from "@/lib/session";
import { clearOfflineData } from "@/lib/pwa";
import { applyClubTheme } from "@/lib/theme";
import { queryClient } from "@/queryClient";
import { fetchMe, meKey } from "./me";
import type { AuthResult } from "./types";

/** True while the app talks to api/mock (fake Google chooser, fixed e-mail code). */
export const IS_MOCK = import.meta.env.VITE_MOCK !== "false";

async function finishSignIn(r: AuthResult) {
  session.set(r.token);
  queryClient.removeQueries();
  return { ...r, me: await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe }) };
}
export const useEmailStart = () => useMutation({ mutationFn: (email: string) => api.post<{ sent: boolean; dev_code?: string }>("/auth/email/start", { email }) });
export const useEmailVerify = () => useMutation({ mutationFn: (v: { email: string; code: string }) => api.post<AuthResult>("/auth/email/verify", v).then(finishSignIn) });
export const useGoogleSignIn = () => useMutation({ mutationFn: (id_token: string) => api.post<AuthResult>("/auth/google", { id_token }).then(finishSignIn) });
export const useMockAccounts = (enabled: boolean) =>
  useQuery({ queryKey: ["mock-accounts"], enabled, queryFn: () => api.get<{ email: string; name: string; roles: { club: string; role: string }[] }[]>("/mock/accounts") });

export async function signOut() {
  await api.post("/auth/logout").catch(() => undefined);
  session.clear();
  clearOfflineData();
  session.setClubId(null);
  applyClubTheme(null);
  queryClient.clear();
}

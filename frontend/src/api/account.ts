import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { AthleteProfile, Consent, ConsentKind, Me, ProviderStatus, User } from "./types";

export const accountKeys = { connections: ["me", "connections"] as const, consents: ["me", "consents"] as const, myProfile: (clubId: string) => ["clubs", clubId, "my-profile"] as const };

export const useUpdateMe = () =>
  useMutation({ mutationFn: (v: Partial<Pick<User, "name" | "phone" | "birth_date" | "sex" | "avatar_url">>) => api.patch<Me>("/me", v), onSuccess: (me) => queryClient.setQueryData(meKey, me) });

export const useConsents = () => useQuery({ queryKey: accountKeys.consents, queryFn: () => api.get<{ items: Consent[] }>("/me/consents").then((r) => r.items) });
export const useGrantConsent = () =>
  useMutation({ mutationFn: (v: { kind: ConsentKind; club_id?: string | null }) => api.post<Consent>("/me/consents", { text_version: "2026-10", ...v }), onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.consents }) });
export const useRevokeConsent = () =>
  useMutation({ mutationFn: (id: string) => api.del(`/me/consents/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.consents }) });

export const useConnections = () => useQuery({ queryKey: accountKeys.connections, queryFn: () => api.get<{ items: ProviderStatus[] }>("/me/connections").then((r) => r.items) });
export const useStravaStart = () => useMutation({ mutationFn: () => api.post<{ authorize_url: string; state: string }>("/me/connections/strava/start") });
export const useStravaCallback = () =>
  useMutation({ mutationFn: (code: string) => api.post("/me/connections/strava/callback", { code }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: accountKeys.connections }); queryClient.invalidateQueries({ queryKey: ["me", "activities"] }); } });
export const useDisconnect = () =>
  useMutation({ mutationFn: (provider: string) => api.del(`/me/connections/${provider}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: accountKeys.connections }); queryClient.invalidateQueries({ queryKey: accountKeys.consents }); } });

export const useMyProfile = (clubId: string | undefined) =>
  useQuery({ queryKey: accountKeys.myProfile(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<AthleteProfile>(`/clubs/${clubId}/my/profile`) });
export const useSaveMyProfile = (clubId: string) =>
  useMutation({ mutationFn: (v: Partial<AthleteProfile>) => api.put<AthleteProfile>(`/clubs/${clubId}/my/profile`, v), onSuccess: (p) => queryClient.setQueryData(accountKeys.myProfile(clubId), p) });

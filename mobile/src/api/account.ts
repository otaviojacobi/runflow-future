/**
 * C1 · Minha conta and M7 · Perfil de atleta (api/endpoints.md § Auth and account, § Athletes): profile and photo,
 * the student's training profile and zones, consents, signed-in devices, data export, leaving a club, deleting the
 * account; the provider connections (Strava). Same hooks and query keys as the web's src/api/account.ts.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { session } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { invalidateTraining } from "./activities";
import { meKey } from "./me";
import type { AthleteProfile, Assessment, Consent, ConsentKind, Me, ProviderStatus, User, UserSession } from "./types";

export const accountKeys = {
  consents: ["me", "consents"] as const,
  sessions: ["me", "sessions"] as const,
  connections: ["me", "connections"] as const,
  myProfile: (clubId: string) => ["clubs", clubId, "my-profile"] as const,
  myAssessments: (clubId: string) => ["clubs", clubId, "assessments", "mine"] as const,
};

/** A fresh `/me` from a mutation: on screen now and on the device for the next cold start. */
export function putMe(me: Me) {
  queryClient.setQueryData(meKey, me);
  session.setMe(me);
}

// ---------- profile and photo
export type ProfilePatch = Partial<Pick<User, "name" | "phone" | "birth_date" | "sex">>;
export const useUpdateMe = () => useMutation({ mutationFn: (v: ProfilePatch) => api.patch<Me>("/me", v), onSuccess: putMe });
/** POST /me/avatar: PNG/JPG/WebP as a data URL (≤ 5 MB; the app sends ≤ 512 px). */
export const useUploadAvatar = () => useMutation({ mutationFn: (v: { data_url: string; width: number; height: number }) => api.post<Me>("/me/avatar", v), onSuccess: putMe });
export const useRemoveAvatar = () => useMutation({ mutationFn: () => api.del<Me>("/me/avatar"), onSuccess: putMe });

// ---------- M7: the student's own training profile (zones read-only)
export const useMyProfile = (clubId: string | undefined) =>
  useQuery({ queryKey: accountKeys.myProfile(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<AthleteProfile>(`/clubs/${clubId}/my/profile`) });
export type MyProfilePatch = Partial<Pick<AthleteProfile, "goal" | "goal_note" | "goal_date" | "level" | "weekly_sessions" | "recent_race" | "max_hr" | "resting_hr">>;
export const useSaveMyProfile = (clubId: string) =>
  useMutation({ mutationFn: (v: MyProfilePatch) => api.put<AthleteProfile>(`/clubs/${clubId}/my/profile`, v), onSuccess: (p) => queryClient.setQueryData(accountKeys.myProfile(clubId), p) });
export const useMyAssessments = (clubId: string | undefined) =>
  useQuery({ queryKey: accountKeys.myAssessments(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Assessment[] }>(`/clubs/${clubId}/my/assessments`).then((r) => r.items) });

// ---------- privacy: consents, export
export const useConsents = () => useQuery({ queryKey: accountKeys.consents, queryFn: () => api.get<{ items: Consent[] }>("/me/consents").then((r) => r.items) });
/** The consent texts' version (the web's, A4 and C1). */
export const CONSENT_TEXT_VERSION = "2026-10";
export const useGrantConsent = () =>
  useMutation({ mutationFn: (v: { kind: ConsentKind; club_id?: string | null }) => api.post<Consent>("/me/consents", { text_version: CONSENT_TEXT_VERSION, ...v }), onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.consents }) });
/** Sharing ending can disconnect Strava (D-011, § Strava sharing): the connection and the training data are read again. */
const afterSharingEnds = () => {
  void queryClient.invalidateQueries({ queryKey: accountKeys.consents });
  void queryClient.invalidateQueries({ queryKey: accountKeys.connections });
  invalidateTraining();
};
export const useRevokeConsent = () =>
  useMutation({ mutationFn: (id: string) => api.del(`/me/consents/${id}`), onSuccess: afterSharingEnds });
/** GET /me/export: everything about the person (LGPD portability). */
export const exportMyData = () => api.get<unknown>("/me/export");

// ---------- devices (sessions)
export const useSessions = () => useQuery({ queryKey: accountKeys.sessions, queryFn: () => api.get<{ items: UserSession[] }>("/me/sessions").then((r) => r.items) });
export const useRevokeSession = () => useMutation({ mutationFn: (id: string) => api.del(`/me/sessions/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }) });
export const useRevokeOtherSessions = () => useMutation({ mutationFn: () => api.post<{ revoked: number }>("/me/sessions/revoke-others"), onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }) });

// ---------- connections (Strava; Garmin later). Connecting: lib/strava.ts.
export const useConnections = () => useQuery({ queryKey: accountKeys.connections, queryFn: () => api.get<{ items: ProviderStatus[] }>("/me/connections").then((r) => r.items) });
/** Disconnecting deletes what came from the provider and the sharing consent (root.md §5). */
export const useDisconnect = () =>
  useMutation({
    mutationFn: (provider: string) => api.del(`/me/connections/${provider}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: accountKeys.connections }); void queryClient.invalidateQueries({ queryKey: accountKeys.consents }); invalidateTraining(); },
  });

// ---------- clubs and the account itself
export const useLeaveClub = () => useMutation({ mutationFn: (clubId: string) => api.post(`/clubs/${clubId}/leave`), onSuccess: afterSharingEnds });
export const useDeleteAccount = () => useMutation({ mutationFn: () => api.del("/me") });

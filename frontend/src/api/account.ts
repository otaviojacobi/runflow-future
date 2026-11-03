import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { AppNotification, AthleteProfile, Consent, ConsentKind, Me, NotificationPrefs, PrefsPatch, ProviderStatus, User, UserSession } from "./types";

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
  useMutation({ mutationFn: (v: { code: string; state?: string; scope?: string }) => api.post("/me/connections/strava/callback", v), onSuccess: () => { queryClient.invalidateQueries({ queryKey: accountKeys.connections }); queryClient.invalidateQueries({ queryKey: ["me", "activities"] }); } });
export const useDisconnect = () =>
  useMutation({ mutationFn: (provider: string) => api.del(`/me/connections/${provider}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: accountKeys.connections }); queryClient.invalidateQueries({ queryKey: accountKeys.consents }); } });

export const useMyProfile = (clubId: string | undefined) =>
  useQuery({ queryKey: accountKeys.myProfile(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<AthleteProfile>(`/clubs/${clubId}/my/profile`) });
export const useSaveMyProfile = (clubId: string) =>
  useMutation({ mutationFn: (v: Partial<AthleteProfile>) => api.put<AthleteProfile>(`/clubs/${clubId}/my/profile`, v), onSuccess: (p) => queryClient.setQueryData(accountKeys.myProfile(clubId), p) });

// ---- notifications (W11)
export const notificationKeys = { all: ["me", "notifications"] as const };
export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: notificationKeys.all, initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<{ items: AppNotification[]; next_cursor: string | null }>(`/me/notifications${pageParam ? `?cursor=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
export const useMarkNotificationsRead = () =>
  useMutation({ mutationFn: (ids?: string[]) => api.post("/me/notifications/read", ids ? { ids } : {}), onSuccess: () => { queryClient.invalidateQueries({ queryKey: notificationKeys.all }); queryClient.invalidateQueries({ queryKey: meKey }); } });

// ---- account (C1)
const prefsKey = ["me", "prefs"] as const;
export const usePrefs = () => useQuery({ queryKey: prefsKey, queryFn: () => api.get<NotificationPrefs>("/me/prefs") });
/** Switches flip right away (optimistic) and go back if the save fails. */
export const useUpdatePrefs = () => useMutation({
  mutationFn: (v: PrefsPatch) => api.patch<NotificationPrefs>("/me/prefs", v),
  onMutate: async (v) => {
    await queryClient.cancelQueries({ queryKey: prefsKey });
    const prev = queryClient.getQueryData<NotificationPrefs>(prefsKey);
    if (prev) queryClient.setQueryData<NotificationPrefs>(prefsKey, { kinds: { ...prev.kinds, ...v.kinds } as NotificationPrefs["kinds"], paused: v.paused ?? prev.paused });
    return { prev };
  },
  onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(prefsKey, ctx.prev); },
  onSuccess: (p) => queryClient.setQueryData(prefsKey, p),
});
export const useSessions = () => useQuery({ queryKey: ["me", "sessions"], queryFn: () => api.get<{ items: UserSession[] }>("/me/sessions").then((r) => r.items) });
export const useRevokeSession = () => useMutation({ mutationFn: (id: string) => api.del(`/me/sessions/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }) });
export const useRevokeOtherSessions = () => useMutation({ mutationFn: () => api.post<{ revoked: number }>("/me/sessions/revoke-others"), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }) });
export const useUploadAvatar = () => useMutation({ mutationFn: (v: { data_url: string; width: number; height: number }) => api.post<Me>("/me/avatar", v), onSuccess: (me) => queryClient.setQueryData(meKey, me) });
export const useRemoveAvatar = () => useMutation({ mutationFn: () => api.del<Me>("/me/avatar"), onSuccess: (me) => queryClient.setQueryData(meKey, me) });
export const useLeaveClub = () => useMutation({ mutationFn: (clubId: string) => api.post(`/clubs/${clubId}/leave`), onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }) });
export const useDeleteAccount = () => useMutation({ mutationFn: () => api.del("/me") });
export const exportMyData = () => api.get<unknown>("/me/export");

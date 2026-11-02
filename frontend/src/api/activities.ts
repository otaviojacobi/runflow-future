import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { ActivityItem, AthleteDetail, AthleteProfile, Sport, Zone } from "./types";

export const actKey = ["me", "activities"] as const;
export const useMyActivities = (from?: string) => useQuery({ queryKey: [...actKey, from], queryFn: () => api.get<{ items: ActivityItem[] }>(`/me/activities${qs({ from, limit: 200 })}`).then((r) => r.items) });
export const useMyActivity = (id: string) => useQuery({ queryKey: [...actKey, "one", id], queryFn: () => api.get<ActivityItem>(`/me/activities/${id}`) });
export const useLogActivity = () =>
  useMutation({ mutationFn: (v: { sport: Sport; name: string; started_at: string; duration_s: number; distance_m: number | null; avg_hr: number | null }) => api.post<ActivityItem>("/me/activities", v), onSuccess: () => queryClient.invalidateQueries({ queryKey: actKey }) });
export const useDeleteActivity = () => useMutation({ mutationFn: (id: string) => api.del(`/me/activities/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: actKey }) });

const athleteKey = (clubId: string, id: string) => ["clubs", clubId, "athlete", id] as const;
export const useAthlete = (clubId: string | undefined, id: string) => useQuery({ queryKey: athleteKey(clubId ?? "", id), enabled: !!clubId, queryFn: () => api.get<AthleteDetail>(`/clubs/${clubId}/athletes/${id}`) });
export const useSaveAthleteProfile = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: Partial<AthleteProfile>) => api.put<AthleteProfile>(`/clubs/${clubId}/athletes/${id}/profile`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: athleteKey(clubId, id) }) });
export const useSetZones = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: { kind: "pace"; threshold_pace_s_per_km?: number; race?: { distance_m: number; time_s: number } } | { kind: "hr"; max_hr: number }) => api.put<Zone>(`/clubs/${clubId}/athletes/${id}/zones`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: athleteKey(clubId, id) }) });

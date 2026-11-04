import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { ActivityItem, AthleteDetail, AthleteProfile, Sport, Zone } from "./types";

export const actKey = ["me", "activities"] as const;
/**
 * Activities and the student's workouts move together (D-049): a log, a delete or a choice can complete a workout
 * (in any of the student's clubs) or open one again, so both are refetched.
 */
export const refreshMatches = () => {
  queryClient.invalidateQueries({ queryKey: actKey });
  queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "clubs" && q.queryKey[2] === "my" });
};
export const useMyActivities = (from?: string) => useQuery({ queryKey: [...actKey, from], queryFn: () => api.get<{ items: ActivityItem[] }>(`/me/activities${qs({ from, limit: 200 })}`).then((r) => r.items) });
export const useMyActivity = (id: string) => useQuery({ queryKey: [...actKey, "one", id], queryFn: () => api.get<ActivityItem>(`/me/activities/${id}`) });
/** Activities waiting for the student to say which workout they were (the last 7 days; Hoje shows them). */
export const usePendingMatches = (enabled = true) =>
  useQuery({ queryKey: [...actKey, "pending"], enabled, queryFn: () => api.get<{ items: ActivityItem[] }>(`/me/activities${qs({ match: "pending" })}`).then((r) => r.items) });
/** The student says which workout an activity was; `null` = none of them (an extra session). */
export const useMatchActivity = () =>
  useMutation({ mutationFn: ({ id, planned_workout_id }: { id: string; planned_workout_id: string | null }) => api.put<ActivityItem>(`/me/activities/${id}/match`, { planned_workout_id }), onSuccess: refreshMatches });
export const useLogActivity = () =>
  useMutation({ mutationFn: (v: { sport: Sport; name: string; started_at: string; duration_s: number; distance_m: number | null; avg_hr: number | null }) => api.post<ActivityItem>("/me/activities", v), onSuccess: refreshMatches });
export const useDeleteActivity = () => useMutation({ mutationFn: (id: string) => api.del(`/me/activities/${id}`), onSuccess: refreshMatches });

const athleteKey = (clubId: string, id: string) => ["clubs", clubId, "athlete", id] as const;
export const useAthlete = (clubId: string | undefined, id: string) => useQuery({ queryKey: athleteKey(clubId ?? "", id), enabled: !!clubId, queryFn: () => api.get<AthleteDetail>(`/clubs/${clubId}/athletes/${id}`) });
export const useSaveAthleteProfile = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: Partial<AthleteProfile>) => api.put<AthleteProfile>(`/clubs/${clubId}/athletes/${id}/profile`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: athleteKey(clubId, id) }) });
export const useSetZones = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: { kind: "pace"; threshold_pace_s_per_km?: number; race?: { distance_m: number; time_s: number } } | { kind: "hr"; max_hr: number }) => api.put<Zone>(`/clubs/${clubId}/athletes/${id}/zones`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: athleteKey(clubId, id) }) });

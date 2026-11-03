/**
 * The person's own activities (M4), like the web's src/api/activities.ts. Connections are in api/account.ts and
 * connecting Strava in lib/strava.ts.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { ActivityItem, Sport } from "./types";

export const actKey = ["me", "activities"] as const;

export const useMyActivities = () =>
  useQuery({ queryKey: actKey, queryFn: () => api.get<{ items: ActivityItem[] }>("/me/activities?limit=200").then((r) => r.items) });
export const useMyActivity = (id: string) =>
  useQuery({
    queryKey: [...actKey, "one", id], enabled: !!id, queryFn: () => api.get<ActivityItem>(`/me/activities/${id}`),
    // The list row while the detail (laps) loads.
    placeholderData: () => queryClient.getQueryData<ActivityItem[]>(actKey)?.find((a) => a.id === id),
  });

export interface ActivityInput { sport: Sport; name: string; started_at: string; duration_s: number; distance_m: number | null; avg_hr: number | null }
/** A manual activity (no watch, outside Strava); it's matched to that day's workout like a synced one. */
export const useLogActivity = () =>
  useMutation({
    mutationFn: (v: ActivityInput) => api.post<ActivityItem>("/me/activities", v),
    onSuccess: () => invalidateTraining(),
  });
/** Only manual ones: synced activities are removed at the source. */
export const useDeleteActivity = () =>
  useMutation({ mutationFn: (id: string) => api.del(`/me/activities/${id}`), onSuccess: (_, id) => invalidateTraining(id) });

/** Activities feed Hoje (last activity, matched workouts): refresh them too. `gone`: a deleted one, not refetched. */
export function invalidateTraining(gone?: string) {
  void queryClient.invalidateQueries({ queryKey: actKey, predicate: (q) => !(gone && q.queryKey[2] === "one" && q.queryKey[3] === gone) });
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "clubs" && q.queryKey[2] === "my" });
}

/** Races and events (M9, W12), like the web's src/api/races.ts. A goal race drives the student's profile goal and date;
 * a finished run becomes the profile's recent race (api/endpoints.md § Races). */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { accountKeys } from "./account";
import type { Race, RaceEntry, RaceSport } from "./types";

const k = (clubId: string) => ["clubs", clubId, "races"] as const;
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: k(clubId) });
  void queryClient.invalidateQueries({ queryKey: accountKeys.myProfile(clubId) });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "athletes"] });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "athlete"] });
};

export interface RaceInput { name: string; date: string; distances_m: number[]; sport?: RaceSport; start_time?: string | null; city?: string | null; state?: string | null; url?: string | null; notes?: string | null }
export const useRaces = (clubId: string | undefined) =>
  useQuery({ queryKey: k(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Race[] }>(`/clubs/${clubId}/races`).then((r) => r.items) });
export const useSaveRace = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: RaceInput & { id?: string }) => (id ? api.patch<Race>(`/clubs/${clubId}/races/${id}`, v) : api.post<Race>(`/clubs/${clubId}/races`, v)),
  onSuccess: () => refresh(clubId),
});
export const useRemoveRace = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/races/${id}`), onSuccess: () => refresh(clubId) });
/** Sign up (a student signs up themselves; staff pass `membership_id`). Upsert. */
export const useJoinRace = (clubId: string) => useMutation({
  mutationFn: ({ race_id, ...v }: { race_id: string; distance_m: number; goal_time_s?: number | null; is_goal?: boolean; membership_id?: string }) => api.post<RaceEntry>(`/clubs/${clubId}/races/${race_id}/entries`, v),
  onSuccess: () => refresh(clubId),
});
export const useUpdateEntry = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: { id: string } & Partial<Pick<RaceEntry, "distance_m" | "goal_time_s" | "is_goal" | "status" | "result_time_s" | "result_position">>) => api.patch<RaceEntry>(`/clubs/${clubId}/race-entries/${id}`, v),
  onSuccess: () => refresh(clubId),
});
export const useLeaveRace = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/race-entries/${id}`), onSuccess: () => refresh(clubId) });

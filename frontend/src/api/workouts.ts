import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { memberKeys } from "./members";
import type { PlannedWorkout, PlannedWorkoutDetail, Sport, WeekState } from "./types";
import type { Structure } from "@/domain/workout";

export const plannedKey = (clubId: string) => ["clubs", clubId, "planned"] as const;
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: plannedKey(clubId) }); queryClient.invalidateQueries({ queryKey: memberKeys.athletes(clubId) }); };

export const usePlanned = (clubId: string | undefined, f: { from: string; to: string; athlete_id?: string; group_id?: string }) =>
  useQuery({ queryKey: [...plannedKey(clubId ?? ""), f], enabled: !!clubId, placeholderData: (prev) => prev, queryFn: () => api.get<{ items: PlannedWorkout[] }>(`/clubs/${clubId}/planned-workouts${qs(f)}`).then((r) => r.items) });
export const usePlannedDetail = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: [...plannedKey(clubId ?? ""), "detail", id], enabled: !!clubId && !!id, queryFn: () => api.get<PlannedWorkoutDetail>(`/clubs/${clubId}/planned-workouts/${id}`) });

export type AssignInput = { athlete_ids: string[]; group_id?: string; dates: string[]; notes?: string | null } & (
  | { template_id: string }
  | { sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null }
);
export const useAssign = (clubId: string) =>
  useMutation({ mutationFn: (v: AssignInput) => api.post<{ items: PlannedWorkout[] }>(`/clubs/${clubId}/planned-workouts`, v), onSuccess: () => refresh(clubId) });
export const useUpdatePlanned = (clubId: string) =>
  useMutation({ mutationFn: ({ id, ...v }: { id: string } & Partial<Pick<PlannedWorkout, "date" | "title" | "sport" | "structure" | "notes" | "est_duration_s" | "est_distance_m">>) => api.patch<PlannedWorkout>(`/clubs/${clubId}/planned-workouts/${id}`, v), onSuccess: () => refresh(clubId) });
export const useDeletePlanned = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/planned-workouts/${id}`), onSuccess: () => refresh(clubId) });
/** Week release (D-031): state of the week starting `monday`, release it (everyone or some students), undo. */
export const useWeek = (clubId: string | undefined, monday: string, enabled = true) =>
  useQuery({ queryKey: [...plannedKey(clubId ?? ""), "week", monday], enabled: !!clubId && enabled, queryFn: () => api.get<WeekState>(`/clubs/${clubId}/weeks/${monday}`) });
export const useReleaseWeek = (clubId: string) =>
  useMutation({ mutationFn: ({ monday, ...v }: { monday: string; athlete_ids?: string[]; group_id?: string; notify?: boolean }) => api.post<WeekState>(`/clubs/${clubId}/weeks/${monday}/release`, v), onSuccess: () => refresh(clubId) });
export const useUndoRelease = (clubId: string) =>
  useMutation({ mutationFn: (monday: string) => api.del<WeekState>(`/clubs/${clubId}/weeks/${monday}/release`), onSuccess: () => refresh(clubId) });
export const useCopyWeek = (clubId: string) =>
  useMutation({ mutationFn: (v: { from_monday: string; to_monday: string; athlete_ids?: string[] }) => api.post<{ copied: number }>(`/clubs/${clubId}/planned-workouts/copy-week`, v), onSuccess: () => refresh(clubId) });

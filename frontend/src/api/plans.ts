import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { PlanItem, TrainingPlan, TrainingPlanDetail } from "./types";

const key = (clubId: string) => ["clubs", clubId, "plans"] as const;
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: key(clubId) }); queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "planned"] }); };
export const usePlans = (clubId: string | undefined) => useQuery({ queryKey: key(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: TrainingPlan[] }>(`/clubs/${clubId}/plans`).then((r) => r.items) });
export const usePlan = (clubId: string | undefined, id: string) => useQuery({ queryKey: [...key(clubId ?? ""), id], enabled: !!clubId, queryFn: () => api.get<TrainingPlanDetail>(`/clubs/${clubId}/plans/${id}`) });
export const useCreatePlan = (clubId: string) => useMutation({ mutationFn: (v: { name: string; weeks: number; description?: string }) => api.post<TrainingPlan>(`/clubs/${clubId}/plans`, v), onSuccess: () => refresh(clubId) });
export const useUpdatePlan = (clubId: string, id: string) => useMutation({ mutationFn: (v: Partial<Pick<TrainingPlan, "name" | "description" | "weeks">>) => api.patch<TrainingPlan>(`/clubs/${clubId}/plans/${id}`, v), onSuccess: () => refresh(clubId) });
export const useArchivePlan = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/plans/${id}`), onSuccess: () => refresh(clubId) });
export const useSavePlanItems = (clubId: string, id: string) => useMutation({ mutationFn: (items: PlanItem[]) => api.put<TrainingPlanDetail>(`/clubs/${clubId}/plans/${id}/items`, { items }), onSuccess: () => refresh(clubId) });
export const useAssignPlan = (clubId: string, id: string) => useMutation({ mutationFn: (v: { athlete_ids: string[]; start_date: string }) => api.post<{ assignments: number; workouts: number }>(`/clubs/${clubId}/plans/${id}/assign`, v), onSuccess: () => refresh(clubId) });
export const useUnassignPlan = (clubId: string, id: string) => useMutation({ mutationFn: (aid: string) => api.del<{ removed_workouts: number }>(`/clubs/${clubId}/plans/${id}/assignments/${aid}`), onSuccess: () => refresh(clubId) });

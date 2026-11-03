/**
 * Planilhas (W7), like the web's src/api/plans.ts: multi-week training plans, their weeks × days grid and the
 * assignments that turn them into planned workouts. Any change also refreshes the staff screens (Planejamento,
 * Painel, Alunos), since applying or unassigning adds or removes workouts.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { PlanItem, TrainingPlan, TrainingPlanDetail } from "./types";

export const plansKey = (clubId: string) => ["clubs", clubId, "plans"] as const;
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: plansKey(clubId) });
  for (const k of ["planned", "dashboard", "athletes", "athlete"]) void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, k] });
};

export const usePlans = (clubId: string | undefined) =>
  useQuery({ queryKey: plansKey(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: TrainingPlan[] }>(`/clubs/${clubId}/plans`).then((r) => r.items) });
export const usePlan = (clubId: string | undefined, id: string) =>
  useQuery({
    queryKey: [...plansKey(clubId ?? ""), id], enabled: !!clubId && !!id, queryFn: () => api.get<TrainingPlanDetail>(`/clubs/${clubId}/plans/${id}`),
    // The list row (name, weeks) while the grid loads.
    placeholderData: () => {
      const p = queryClient.getQueryData<TrainingPlan[]>(plansKey(clubId ?? ""))?.find((x) => x.id === id);
      return p ? { ...p, items: [], assignments: [] } : undefined;
    },
  });
export const useCreatePlan = (clubId: string) =>
  useMutation({ mutationFn: (v: { name: string; weeks: number; description?: string }) => api.post<TrainingPlan>(`/clubs/${clubId}/plans`, v), onSuccess: () => refresh(clubId) });
export const useUpdatePlan = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: Partial<Pick<TrainingPlan, "name" | "description" | "weeks">>) => api.patch<TrainingPlan>(`/clubs/${clubId}/plans/${id}`, v), onSuccess: () => refresh(clubId) });
/** Archiving hides it; workouts already applied stay in the students' calendars. */
export const useArchivePlan = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/plans/${id}`), onSuccess: () => refresh(clubId) });
/** Replaces the whole grid (ids starting with "new" are created). */
export const useSavePlanItems = (clubId: string, id: string) =>
  useMutation({ mutationFn: (items: PlanItem[]) => api.put<TrainingPlanDetail>(`/clubs/${clubId}/plans/${id}/items`, { items }), onSuccess: () => refresh(clubId) });
/** A copy with the same weeks and workouts (no assignments): create, then fill its grid. */
export const useDuplicatePlan = (clubId: string) =>
  useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const src = await api.get<TrainingPlanDetail>(`/clubs/${clubId}/plans/${id}`);
      const copy = await api.post<TrainingPlan>(`/clubs/${clubId}/plans`, { name, weeks: src.weeks, description: src.description ?? undefined });
      if (src.items.length) await api.put(`/clubs/${clubId}/plans/${copy.id}/items`, { items: src.items.map((i, n) => ({ ...i, id: `new-${n}`, plan_id: undefined })) });
      return copy;
    },
    onSuccess: () => refresh(clubId),
  });
/** Applies it from a Monday: one assignment per student, the workouts land in their calendars. */
export const useAssignPlan = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: { athlete_ids: string[]; start_date: string }) => api.post<{ assignments: number; workouts: number }>(`/clubs/${clubId}/plans/${id}/assign`, v), onSuccess: () => refresh(clubId) });
/** Takes the future, not-done workouts of one assignment off the student's calendar. */
export const useUnassignPlan = (clubId: string, id: string) =>
  useMutation({ mutationFn: (aid: string) => api.del<{ removed_workouts: number }>(`/clubs/${clubId}/plans/${id}/assignments/${aid}`), onSuccess: () => refresh(clubId) });

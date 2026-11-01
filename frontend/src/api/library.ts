import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Sport, WorkoutTemplate } from "./types";

export const libraryKey = (clubId: string) => ["clubs", clubId, "templates"] as const;
export const useTemplates = (clubId: string | undefined, f: { sport?: Sport | ""; q?: string } = {}) =>
  useQuery({
    queryKey: [...libraryKey(clubId ?? ""), f],
    enabled: !!clubId,
    queryFn: () => api.get<{ items: WorkoutTemplate[] }>(`/clubs/${clubId}/templates${qs({ sport: f.sport, q: f.q, limit: 200 })}`).then((r) => r.items),
  });
export const useTemplate = (clubId: string | undefined, id: string | undefined) =>
  useQuery({ queryKey: [...libraryKey(clubId ?? ""), "one", id], enabled: !!clubId && !!id, queryFn: () => api.get<WorkoutTemplate>(`/clubs/${clubId}/templates/${id}`) });
type TemplateInput = Pick<WorkoutTemplate, "sport" | "name" | "description" | "structure" | "est_duration_s" | "est_distance_m" | "tags">;
export const useSaveTemplate = (clubId: string) =>
  useMutation({
    mutationFn: (v: { id?: string; data: Partial<TemplateInput> }) =>
      v.id ? api.patch<WorkoutTemplate>(`/clubs/${clubId}/templates/${v.id}`, v.data) : api.post<WorkoutTemplate>(`/clubs/${clubId}/templates`, v.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(clubId) }),
  });
export const useArchiveTemplate = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/templates/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(clubId) }) });

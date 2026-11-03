/** The club's workout templates (W6) and the exercise library the builder suggests names from (W18), like the web's
 * src/api/{library,exercises}.ts. The key is the staff screens' (api/staff.ts), so every list refreshes together. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Sport, WorkoutTemplate } from "./types";

const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
};
export const libraryKey = (clubId: string) => ["clubs", clubId, "templates"] as const;
export const useTemplates = (clubId: string | undefined, f: { sport?: Sport | ""; q?: string } = {}) =>
  useQuery({
    queryKey: [...libraryKey(clubId ?? ""), f], enabled: !!clubId, placeholderData: (p) => p,
    queryFn: () => api.get<{ items: WorkoutTemplate[] }>(`/clubs/${clubId}/templates${qs({ sport: f.sport, q: f.q, limit: 200 })}`).then((r) => r.items),
  });
export const useTemplate = (clubId: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: [...libraryKey(clubId ?? ""), "one", id], enabled: !!clubId && !!id,
    queryFn: () => api.get<WorkoutTemplate>(`/clubs/${clubId}/templates/${id}`),
    // The library card while the full template loads.
    placeholderData: () => queryClient.getQueriesData<WorkoutTemplate[]>({ queryKey: libraryKey(clubId ?? "") }).flatMap(([, l]) => (Array.isArray(l) ? l : [])).find((w) => w.id === id),
  });
export type TemplateInput = Pick<WorkoutTemplate, "sport" | "name" | "description" | "structure" | "est_duration_s" | "est_distance_m" | "tags">;
export const useSaveTemplate = (clubId: string) =>
  useMutation({
    mutationFn: (v: { id?: string; data: Partial<TemplateInput> }) =>
      v.id ? api.patch<WorkoutTemplate>(`/clubs/${clubId}/templates/${v.id}`, v.data) : api.post<WorkoutTemplate>(`/clubs/${clubId}/templates`, v.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(clubId) }),
  });
/** Archiving takes it out of the library; workouts already assigned don't change. */
export const useArchiveTemplate = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/templates/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(clubId) }) });

/** Global catalog + the club's own exercises (names for the strength builder; picking one links its video): W18's hook. */
export { useExercises } from "./exercises";

/** Exercise library (F28). */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { LibraryExercise } from "./types";

const k = (clubId: string) => ["clubs", clubId, "exercises"] as const;
export const useExercises = (clubId: string | undefined, f: { q?: string; category?: string } = {}) =>
  useQuery({ queryKey: [...k(clubId ?? ""), f], enabled: !!clubId, staleTime: 5 * 60_000, queryFn: () => api.get<{ items: LibraryExercise[] }>(`/clubs/${clubId}/exercises${qs(f)}`).then((r) => r.items) });
export const useSaveExercise = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: Partial<LibraryExercise> & { name: string; category: LibraryExercise["category"] }) => (id ? api.patch<LibraryExercise>(`/clubs/${clubId}/exercises/${id}`, v) : api.post<LibraryExercise>(`/clubs/${clubId}/exercises`, v)),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: k(clubId) }),
});
export const useArchiveExercise = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/exercises/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: k(clubId) }) });

/** Find a block's library exercise by id, or by name (case-insensitive) for blocks written as text. */
export function useExerciseLookup(clubId: string | undefined) {
  const all = useExercises(clubId);
  return useMemo(() => {
    const byId = new Map((all.data ?? []).map((e) => [e.id, e]));
    const byName = new Map((all.data ?? []).map((e) => [e.name.trim().toLowerCase(), e]));
    return (b: { name: string; exercise_id?: string }) => (b.exercise_id && byId.get(b.exercise_id)) || byName.get(b.name.trim().toLowerCase()) || null;
  }, [all.data]);
}

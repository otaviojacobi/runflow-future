/** Exercise library (W18), like the web's src/api/exercises.ts: Runflow's catalog + the club's own exercises. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { LibraryExercise } from "./types";

const k = (clubId: string) => ["clubs", clubId, "exercises"] as const;
export const useExercises = (clubId: string | undefined, f: { q?: string; category?: string } = {}) =>
  useQuery({
    queryKey: [...k(clubId ?? ""), f], enabled: !!clubId, staleTime: 5 * 60_000, placeholderData: (prev) => prev,
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
      return api.get<{ items: LibraryExercise[] }>(`/clubs/${clubId}/exercises${q ? `?${q}` : ""}`).then((r) => r.items);
    },
  });
/** Creates a club exercise, or edits one (`id`); a club version of a catalog exercise replaces it for the club. */
export const useSaveExercise = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: Partial<LibraryExercise> & { name: string; category: LibraryExercise["category"] }) =>
    (id ? api.patch<LibraryExercise>(`/clubs/${clubId}/exercises/${id}`, v) : api.post<LibraryExercise>(`/clubs/${clubId}/exercises`, v)),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: k(clubId) }),
});
export const useArchiveExercise = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/exercises/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: k(clubId) }) });

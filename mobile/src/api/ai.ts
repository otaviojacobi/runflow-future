/** Assistant (W17): a rules engine in the mock and the backend (`source: "rules"`); an LLM may come later (root.md §11). */
import { useMutation } from "@tanstack/react-query";
import type { Structure } from "@/domain/workout";
import { api } from "@/lib/api";
import type { Sport } from "./types";

/** `warnings`: the pieces of the text that weren't understood (as typed; the rest was applied). `tags`: its #hashtags. */
export interface AiWorkout { name: string; sport: Sport; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; notes: string | null; warnings: string[]; tags: string[]; source: string }
export const useAiWorkout = (clubId: string) => useMutation({ mutationFn: (v: { text: string; sport: Sport }) => api.post<AiWorkout>(`/clubs/${clubId}/ai/workout`, v) });

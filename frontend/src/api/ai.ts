/** Assistant (F27): a rules engine in the mock and the backend (`source: "rules"`); an LLM may come later. */
import { useMutation } from "@tanstack/react-query";
import type { Structure } from "@/domain/workout";
import { api } from "@/lib/api";
import type { Sport } from "./types";

/** `warnings`: the pieces of the text that weren't understood (as typed; the rest was applied). `tags`: its #hashtags. */
export interface AiWorkout { name: string; sport: Sport; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; notes: string | null; warnings: string[]; tags: string[]; source: string }
export interface AiWeekItem { date: string; sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; reason: string }
export interface AiWeekPlan { membership_id: string; week_start: string; rationale: string[]; items: AiWeekItem[]; source: string }
export interface AiFeedbackSummary { from: string; to: string; summary: string[]; highlights: { membership_id: string; planned_workout_id: string | null; kind: "pain" | "fatigue" | "life" | "sick" | "rpe" | "missed"; severity: "danger" | "warning" | "info"; text: string }[]; source: string }

export const useAiWorkout = (clubId: string) => useMutation({ mutationFn: (v: { text: string; sport: Sport }) => api.post<AiWorkout>(`/clubs/${clubId}/ai/workout`, v) });
export const useAiWeekPlan = (clubId: string) => useMutation({ mutationFn: (v: { membership_id: string; week_start: string }) => api.post<AiWeekPlan>(`/clubs/${clubId}/ai/week-plan`, v) });
export const useAiFeedbackSummary = (clubId: string) => useMutation({ mutationFn: (v: { from?: string; to?: string; group_id?: string }) => api.post<AiFeedbackSummary>(`/clubs/${clubId}/ai/feedback-summary`, v) });

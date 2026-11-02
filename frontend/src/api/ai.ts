/** Assistant (F27). The mock answers with a rules engine (`source: "rules"`); the backend will use an LLM. */
import { useMutation } from "@tanstack/react-query";
import type { Structure } from "@/domain/workout";
import { api } from "@/lib/api";
import type { Sport } from "./types";

export interface AiWorkout { name: string; sport: Sport; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; notes: string | null; source: string }
export interface AiWeekItem { date: string; sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; reason: string }
export interface AiWeekPlan { membership_id: string; week_start: string; rationale: string[]; items: AiWeekItem[]; source: string }
export interface AiFeedbackSummary { from: string; to: string; summary: string[]; highlights: { membership_id: string; planned_workout_id: string | null; kind: "pain" | "fatigue" | "life" | "sick" | "rpe" | "missed"; severity: "danger" | "warning" | "info"; text: string }[]; source: string }

export const useAiWorkout = (clubId: string) => useMutation({ mutationFn: (v: { text: string; sport: Sport }) => api.post<AiWorkout>(`/clubs/${clubId}/ai/workout`, v) });
export const useAiWeekPlan = (clubId: string) => useMutation({ mutationFn: (v: { membership_id: string; week_start: string }) => api.post<AiWeekPlan>(`/clubs/${clubId}/ai/week-plan`, v) });
export const useAiFeedbackSummary = (clubId: string) => useMutation({ mutationFn: (v: { from?: string; to?: string; group_id?: string }) => api.post<AiFeedbackSummary>(`/clubs/${clubId}/ai/feedback-summary`, v) });

/** Challenges, monthly rankings and badges (F24). */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Badge, Challenge, ChallengeMetric, Ranking, Sport } from "./types";

const k = (clubId: string) => ["clubs", clubId, "challenges"] as const;
const refresh = (clubId: string) => queryClient.invalidateQueries({ queryKey: k(clubId) });
export interface ChallengeInput { name: string; metric: ChallengeMetric; starts_on: string; ends_on: string; description?: string | null; sport?: Sport | null; goal?: number | null; group_ids?: string[] }

export const useChallenges = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "list"], enabled: !!clubId, queryFn: () => api.get<{ items: Challenge[] }>(`/clubs/${clubId}/challenges`).then((r) => r.items) });
export const useChallenge = (clubId: string | undefined, id: string | null) => useQuery({ queryKey: [...k(clubId ?? ""), "one", id], enabled: !!clubId && !!id, queryFn: () => api.get<Challenge>(`/clubs/${clubId}/challenges/${id}`) });
export const useSaveChallenge = (clubId: string) => useMutation({ mutationFn: ({ id, ...v }: ChallengeInput & { id?: string }) => (id ? api.patch<Challenge>(`/clubs/${clubId}/challenges/${id}`, v) : api.post<Challenge>(`/clubs/${clubId}/challenges`, v)), onSuccess: () => refresh(clubId) });
export const useArchiveChallenge = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/challenges/${id}`), onSuccess: () => refresh(clubId) });
export const useJoinChallenge = (clubId: string) => useMutation({ mutationFn: (v: { id: string; join: boolean }) => (v.join ? api.post(`/clubs/${clubId}/challenges/${v.id}/join`) : api.del(`/clubs/${clubId}/challenges/${v.id}/join`)), onSuccess: () => refresh(clubId) });
export const useRanking = (clubId: string | undefined, month: string, sport: Sport = "run") => useQuery({ queryKey: [...k(clubId ?? ""), "ranking", month, sport], enabled: !!clubId, queryFn: () => api.get<Ranking>(`/clubs/${clubId}/rankings${qs({ month, sport })}`) });
export const useSetRankingOptIn = (clubId: string) => useMutation({ mutationFn: (opted_in: boolean) => api.put<{ opted_in: boolean }>(`/clubs/${clubId}/my/ranking`, { opted_in }), onSuccess: () => refresh(clubId) });
export const useMyBadges = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "badges"], enabled: !!clubId, queryFn: () => api.get<{ items: Badge[]; streak_weeks: number }>(`/clubs/${clubId}/my/badges`) });

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Comment, CompletionStatus, Feeling, MySummary, MyWorkoutDetail, PlannedWorkout } from "./types";

export const myKey = (clubId: string) => ["clubs", clubId, "my"] as const;
export const threadKey = (clubId: string, id: string) => ["clubs", clubId, "thread", id] as const;

export const useMyWorkouts = (clubId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: [...myKey(clubId ?? ""), "workouts", from, to], enabled: !!clubId, placeholderData: (p) => p, queryFn: () => api.get<{ items: PlannedWorkout[] }>(`/clubs/${clubId}/my/workouts${qs({ from, to })}`).then((r) => r.items) });
export const useMyWorkout = (clubId: string | undefined, id: string) =>
  useQuery({ queryKey: [...myKey(clubId ?? ""), "workout", id], enabled: !!clubId, queryFn: () => api.get<MyWorkoutDetail>(`/clubs/${clubId}/my/workouts/${id}`) });
export const useMySummary = (clubId: string | undefined) =>
  useQuery({ queryKey: [...myKey(clubId ?? ""), "summary"], enabled: !!clubId, queryFn: () => api.get<MySummary>(`/clubs/${clubId}/my/summary`) });
export const useSaveCompletion = (clubId: string) =>
  useMutation({
    mutationFn: ({ id, ...v }: { id: string; status: CompletionStatus; rpe: number | null; feeling: Feeling | null; comment: string; activity_id?: string | null }) => api.put<PlannedWorkout>(`/clubs/${clubId}/my/workouts/${id}/completion`, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myKey(clubId) }),
  });

export const useComments = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: threadKey(clubId ?? "", id ?? ""), enabled: !!clubId && !!id, queryFn: () => api.get<{ items: Comment[] }>(`/clubs/${clubId}/planned-workouts/${id}/comments`).then((r) => r.items) });
export const usePostComment = (clubId: string, id: string) =>
  useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/clubs/${clubId}/planned-workouts/${id}/comments`, { body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: threadKey(clubId, id) }); queryClient.invalidateQueries({ queryKey: ["clubs", clubId] }); },
  });

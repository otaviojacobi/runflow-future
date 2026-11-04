import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { liveQuery } from "@/lib/live";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Comment, CompletionStatus, Feeling, MySummary, MyWorkoutDetail, PlannedWorkout, UnreleasedWeek } from "./types";

export const myKey = (clubId: string) => ["clubs", clubId, "my"] as const;
export const threadKey = (clubId: string, id: string) => ["clubs", clubId, "thread", id] as const;

type MyCalendar = { items: PlannedWorkout[]; unreleased_weeks: UnreleasedWeek[] };
const myCalendar = (clubId: string | undefined, from: string, to: string) => ({
  queryKey: [...myKey(clubId ?? ""), "workouts", from, to], enabled: !!clubId, placeholderData: (p: MyCalendar | undefined) => p,
  queryFn: () => api.get<MyCalendar>(`/clubs/${clubId}/my/workouts${qs({ from, to })}`),
});
export const useMyWorkouts = (clubId: string | undefined, from: string, to: string) =>
  useQuery({ ...myCalendar(clubId, from, to), select: (r: MyCalendar) => r.items });
/** Weeks in the range the trainer is still preparing (D-031), from the same request. */
export const useMyUnreleasedWeeks = (clubId: string | undefined, from: string, to: string) =>
  useQuery({ ...myCalendar(clubId, from, to), select: (r: MyCalendar) => r.unreleased_weeks ?? [] });
export const useMyWorkout = (clubId: string | undefined, id: string) =>
  useQuery({ queryKey: [...myKey(clubId ?? ""), "workout", id], enabled: !!clubId, queryFn: () => api.get<MyWorkoutDetail>(`/clubs/${clubId}/my/workouts/${id}`) });
export const useMySummary = (clubId: string | undefined) =>
  useQuery({ queryKey: [...myKey(clubId ?? ""), "summary"], enabled: !!clubId, queryFn: () => api.get<MySummary>(`/clubs/${clubId}/my/summary`) });
export const useSaveCompletion = (clubId: string) =>
  useMutation({
    mutationFn: ({ id, ...v }: { id: string; status: CompletionStatus; rpe: number | null; feeling: Feeling | null; comment: string; activity_id?: string | null }) => api.put<PlannedWorkout>(`/clubs/${clubId}/my/workouts/${id}/completion`, v),
    // The completion can move an activity between workouts (D-049): the activities' matches change too.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: myKey(clubId) }); queryClient.invalidateQueries({ queryKey: ["me", "activities"] }); },
  });

/**
 * A workout's conversation (student ⇄ staff). It stays current while on screen (lib/live: polled every 10 s, again on
 * focus); the GET marks it read, so when something new arrives the bell, the Feedbacks count, the inbox and the
 * student's cards ("mensagem nova") are refreshed too.
 */
export const useComments = (clubId: string | undefined, id: string | null) =>
  useQuery({
    queryKey: threadKey(clubId ?? "", id ?? ""), enabled: !!clubId && !!id, ...liveQuery(),
    queryFn: async () => {
      const items = (await api.get<{ items: Comment[] }>(`/clubs/${clubId}/planned-workouts/${id}/comments`)).items;
      const before = queryClient.getQueryData<Comment[]>(threadKey(clubId!, id!));
      if (before && items.length > before.length) {
        void queryClient.invalidateQueries({ queryKey: meKey });
        void queryClient.invalidateQueries({ queryKey: myKey(clubId!) });
        void queryClient.invalidateQueries({ queryKey: ["clubs", clubId!, "feedback"] });
      }
      return items;
    },
  });
export const usePostComment = (clubId: string, id: string) =>
  useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/clubs/${clubId}/planned-workouts/${id}/comments`, { body }),
    // A staff reply can clear the Feedbacks count (`/me` memberships[].unread.feedback).
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: threadKey(clubId, id) }); queryClient.invalidateQueries({ queryKey: ["clubs", clubId] }); queryClient.invalidateQueries({ queryKey: meKey }); },
  });

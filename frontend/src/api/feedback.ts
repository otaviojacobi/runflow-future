import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { FeedbackFilter, FeedbackItem } from "./types";

export const useFeedback = (clubId: string | undefined, filter: FeedbackFilter) =>
  useQuery({
    queryKey: ["clubs", clubId ?? "", "feedback", filter], enabled: !!clubId, placeholderData: (p) => p, refetchInterval: 30_000,
    queryFn: () => api.get<{ items: FeedbackItem[]; counts: Record<FeedbackFilter, number> }>(`/clubs/${clubId}/feedback?filter=${filter}`),
  });
/** Reading changes the inbox and the Feedbacks count (`/me` memberships[].unread.feedback). */
const refreshRead = (clubId: string) => { queryClient.invalidateQueries({ queryKey: ["clubs", clubId] }); queryClient.invalidateQueries({ queryKey: meKey }); };
export const useMarkAllRead = (clubId: string) =>
  useMutation({ mutationFn: () => api.post(`/clubs/${clubId}/feedback/read`, {}), onSuccess: () => refreshRead(clubId) });
/** Opening a conversation in Feedbacks reads it (also a completion comment with no messages). */
export const useMarkFeedbackRead = (clubId: string) =>
  useMutation({ mutationFn: (workoutId: string) => api.post(`/clubs/${clubId}/feedback/read`, { workout_ids: [workoutId] }), onSuccess: () => refreshRead(clubId) });

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { FeedbackFilter, FeedbackItem } from "./types";

export const useFeedback = (clubId: string | undefined, filter: FeedbackFilter) =>
  useQuery({
    queryKey: ["clubs", clubId ?? "", "feedback", filter], enabled: !!clubId, placeholderData: (p) => p, refetchInterval: 30_000,
    queryFn: () => api.get<{ items: FeedbackItem[]; counts: Record<FeedbackFilter, number> }>(`/clubs/${clubId}/feedback?filter=${filter}`),
  });
export const useMarkAllRead = (clubId: string) =>
  useMutation({ mutationFn: () => api.post(`/clubs/${clubId}/feedback/read`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clubs", clubId] }) });

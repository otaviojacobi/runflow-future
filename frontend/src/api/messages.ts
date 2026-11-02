/** Messages and announcements (F22). The mock polls; the backend will push over SSE. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Announcement, ConversationDetail, ConversationSummary, Message, User } from "./types";

const k = (clubId: string) => ["clubs", clubId, "messages"] as const;
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: k(clubId) }); queryClient.invalidateQueries({ queryKey: meKey }); };

export const useConversations = (clubId: string | undefined, q = "") =>
  useQuery({ queryKey: [...k(clubId ?? ""), "list", q], enabled: !!clubId, refetchInterval: 15_000, queryFn: () => api.get<{ items: ConversationSummary[] }>(`/clubs/${clubId}/conversations${qs({ q: q || undefined })}`).then((r) => r.items) });
export const useConversation = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "conversation", id], enabled: !!clubId && !!id, refetchInterval: 8_000, queryFn: () => api.get<ConversationDetail>(`/clubs/${clubId}/conversations/${id}`) });
export const useOpenConversation = (clubId: string) => useMutation({ mutationFn: (student_membership_id: string) => api.post<ConversationSummary>(`/clubs/${clubId}/conversations`, { student_membership_id }), onSuccess: () => refresh(clubId) });
export const useSendMessage = (clubId: string, id: string) => useMutation({ mutationFn: (body: string) => api.post<Message>(`/clubs/${clubId}/conversations/${id}/messages`, { body }), onSuccess: () => refresh(clubId) });
export const useMarkConversationRead = (clubId: string) => useMutation({ mutationFn: (id: string) => api.post(`/clubs/${clubId}/conversations/${id}/read`), onSuccess: () => queryClient.invalidateQueries({ queryKey: [...k(clubId), "list"] }) });
export const useDeleteMessage = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/messages/${id}`), onSuccess: () => refresh(clubId) });

export interface AnnouncementInput { title: string; body: string; group_ids: string[]; pinned: boolean }
export const useAnnouncements = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "announcements"], enabled: !!clubId, refetchInterval: 30_000, queryFn: () => api.get<{ items: Announcement[] }>(`/clubs/${clubId}/announcements`).then((r) => r.items) });
export const useSaveAnnouncement = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: Partial<AnnouncementInput> & { id?: string }) => (id ? api.patch<Announcement>(`/clubs/${clubId}/announcements/${id}`, v) : api.post<Announcement>(`/clubs/${clubId}/announcements`, v)),
  onSuccess: () => refresh(clubId),
});
export const useDeleteAnnouncement = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/announcements/${id}`), onSuccess: () => refresh(clubId) });
export const useMarkAnnouncementsRead = (clubId: string) => useMutation({ mutationFn: (ids: string[]) => api.post(`/clubs/${clubId}/announcements/read`, { ids }), onSuccess: () => queryClient.invalidateQueries({ queryKey: [...k(clubId), "announcements"] }) });
export const useAnnouncementReads = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "reads", id], enabled: !!clubId && !!id, queryFn: () => api.get<{ items: { membership_id: string; user: User; read_at: string | null }[] }>(`/clubs/${clubId}/announcements/${id}/reads`).then((r) => r.items) });

/**
 * Messages and the mural (M10, W13; api/endpoints.md § Messages and announcements), like the web's src/api/messages.ts.
 * The contract has no live channel, so open screens poll: only while they are focused (tab screens stay mounted).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Announcement, ConversationDetail, ConversationSummary, Group, ID, ISOTime, Message, User } from "./types";

// ---- payloads of this area (the rows are in types.ts)
/** GET /announcements/{id}/reads: the audience, `read_at` null until they read it. */
export interface AnnouncementRead { membership_id: ID; user: User; read_at: ISOTime | null }
export interface AnnouncementInput { title: string; body: string; group_ids: ID[]; pinned: boolean }

// ---- polling while on screen (no websockets in the contract)
const POLL = { list: 15_000, thread: 8_000, mural: 30_000 } as const;

const k = (clubId: string) => ["clubs", clubId, "messages"] as const;
export const messageKeys = {
  all: k,
  list: (clubId: string) => [...k(clubId), "list"] as const,
  conversation: (clubId: string, id: string) => [...k(clubId), "conversation", id] as const,
  announcements: (clubId: string) => [...k(clubId), "announcements"] as const,
  reads: (clubId: string, id: string) => [...k(clubId), "reads", id] as const,
  groups: (clubId: string) => [...k(clubId), "groups"] as const,
};
/** After a change to a conversation: the list (previews, unread counts) and the open threads. */
const refreshChats = (clubId: string) => Promise.all([
  queryClient.invalidateQueries({ queryKey: messageKeys.list(clubId) }),
  queryClient.invalidateQueries({ queryKey: [...k(clubId), "conversation"] }),
]);
/** After a change on the mural: the list and its receipts. */
const refreshMural = (clubId: string) => Promise.all([
  queryClient.invalidateQueries({ queryKey: messageKeys.announcements(clubId) }),
  queryClient.invalidateQueries({ queryKey: [...k(clubId), "reads"] }),
]);

/** Staff: every active student (`id: null` until the first message). Student: their one conversation with the staff. */
export const useConversations = (clubId: string | undefined, live = true) =>
  useQuery({
    queryKey: messageKeys.list(clubId ?? ""), enabled: !!clubId, refetchInterval: live ? POLL.list : false,
    queryFn: () => api.get<{ items: ConversationSummary[] }>(`/clubs/${clubId}/conversations`).then((r) => r.items),
  });
export const useConversation = (clubId: string | undefined, id: string | undefined, live = true) =>
  useQuery({
    queryKey: messageKeys.conversation(clubId ?? "", id ?? ""), enabled: !!clubId && !!id, refetchInterval: live ? POLL.thread : false,
    queryFn: () => api.get<ConversationDetail>(`/clubs/${clubId}/conversations/${id}`),
  });
/** Staff: get or create a student's conversation. */
export const useOpenConversation = (clubId: string) =>
  useMutation({
    mutationFn: (studentMembershipId: string) => api.post<ConversationSummary>(`/clubs/${clubId}/conversations`, { student_membership_id: studentMembershipId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messageKeys.list(clubId) }),
  });
/** Sends a message; the thread shows it as pending meanwhile and appends the server's copy right away. */
export const useSendMessage = (clubId: string, id: string) =>
  useMutation({
    mutationFn: (body: string) => api.post<Message>(`/clubs/${clubId}/conversations/${id}/messages`, { body }),
    onSuccess: (m) => {
      queryClient.setQueryData<ConversationDetail>(messageKeys.conversation(clubId, id), (c) =>
        c && !c.messages.some((x) => x.id === m.id) ? { ...c, messages: [...c.messages, m], last_message: m, last_message_at: m.created_at } : c);
      void refreshChats(clubId);
    },
  });
export const useMarkConversationRead = (clubId: string) =>
  useMutation({
    mutationFn: (id: string) => api.post<void>(`/clubs/${clubId}/conversations/${id}/read`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<ConversationDetail>(messageKeys.conversation(clubId, id), (c) => (c ? { ...c, unread_count: 0 } : c));
      queryClient.setQueryData<ConversationSummary[]>(messageKeys.list(clubId), (l) => l?.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    },
  });
/** The author deletes their message (shown as "Mensagem apagada"). */
export const useDeleteMessage = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/messages/${id}`), onSuccess: () => refreshChats(clubId) });

/** The mural: pinned first, then newest. Staff also get `audience_count` and `reads_count`. */
export const useAnnouncements = (clubId: string | undefined, live = true) =>
  useQuery({
    queryKey: messageKeys.announcements(clubId ?? ""), enabled: !!clubId, refetchInterval: live ? POLL.mural : false,
    queryFn: () => api.get<{ items: Announcement[] }>(`/clubs/${clubId}/announcements`).then((r) => r.items),
  });
/** Publish (no id) or edit/pin/retarget (with id). */
export const useSaveAnnouncement = (clubId: string) =>
  useMutation({
    mutationFn: ({ id, ...v }: Partial<AnnouncementInput> & { id?: string }) =>
      (id ? api.patch<Announcement>(`/clubs/${clubId}/announcements/${id}`, v) : api.post<Announcement>(`/clubs/${clubId}/announcements`, v)),
    onSuccess: (a) => {
      queryClient.setQueryData<Announcement[]>(messageKeys.announcements(clubId), (l) => l && (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [a, ...l]));
      void refreshMural(clubId);
    },
  });
export const useDeleteAnnouncement = (clubId: string) =>
  useMutation({
    mutationFn: (id: string) => api.del(`/clubs/${clubId}/announcements/${id}`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Announcement[]>(messageKeys.announcements(clubId), (l) => l?.filter((x) => x.id !== id));
      // Its receipts are gone too: drop them instead of refetching (404) while the screen closes.
      queryClient.removeQueries({ queryKey: messageKeys.reads(clubId, id) });
      void queryClient.invalidateQueries({ queryKey: messageKeys.announcements(clubId) });
    },
  });
export const useMarkAnnouncementsRead = (clubId: string) =>
  useMutation({
    mutationFn: (ids: string[]) => api.post<void>(`/clubs/${clubId}/announcements/read`, { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messageKeys.announcements(clubId) }),
  });
/** Staff: the audience with `read_at` (who read, who didn't). */
export const useAnnouncementReads = (clubId: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: messageKeys.reads(clubId ?? "", id ?? ""), enabled: !!clubId && !!id,
    queryFn: () => api.get<{ items: AnnouncementRead[] }>(`/clubs/${clubId}/announcements/${id}/reads`).then((r) => r.items),
  });
/** Staff: the club's groups, to address an announcement. */
export const useGroups = (clubId: string | undefined) =>
  useQuery({ queryKey: messageKeys.groups(clubId ?? ""), enabled: !!clubId, staleTime: 5 * 60_000, queryFn: () => api.get<{ items: Group[] }>(`/clubs/${clubId}/groups`).then((r) => r.items) });

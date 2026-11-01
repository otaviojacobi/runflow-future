import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { AthleteSummary, Group, Member, Role } from "./types";

export const memberKeys = {
  members: (clubId: string) => ["clubs", clubId, "members"] as const,
  groups: (clubId: string) => ["clubs", clubId, "groups"] as const,
  athletes: (clubId: string) => ["clubs", clubId, "athletes"] as const,
};
const refresh = (clubId: string) => {
  for (const k of [memberKeys.members(clubId), memberKeys.groups(clubId), memberKeys.athletes(clubId), meKey]) queryClient.invalidateQueries({ queryKey: k });
};

export const useMembers = (clubId: string | undefined, f: { role?: string; q?: string } = {}) =>
  useQuery({ queryKey: [...memberKeys.members(clubId ?? ""), f], enabled: !!clubId, queryFn: () => api.get<{ items: Member[] }>(`/clubs/${clubId}/members${qs({ ...f, limit: 500 })}`).then((r) => r.items) });
export const useUpdateMember = (clubId: string) =>
  useMutation({ mutationFn: (v: { id: string; role?: Role; status?: "active" | "suspended" }) => api.patch<Member>(`/clubs/${clubId}/members/${v.id}`, { role: v.role, status: v.status }), onSuccess: () => refresh(clubId) });
export const useRemoveMember = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/members/${id}`), onSuccess: () => refresh(clubId) });

export const useGroups = (clubId: string | undefined) =>
  useQuery({ queryKey: memberKeys.groups(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Group[] }>(`/clubs/${clubId}/groups`).then((r) => r.items) });
export const useSaveGroup = (clubId: string) =>
  useMutation({
    mutationFn: async (v: { id?: string; name: string; member_ids?: string[] }) => {
      const g = v.id ? await api.patch<Group>(`/clubs/${clubId}/groups/${v.id}`, { name: v.name }) : await api.post<Group>(`/clubs/${clubId}/groups`, { name: v.name });
      return v.member_ids ? api.put<Group>(`/clubs/${clubId}/groups/${g.id}/members`, { membership_ids: v.member_ids }) : g;
    },
    onSuccess: () => refresh(clubId),
  });
export const useDeleteGroup = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/groups/${id}`), onSuccess: () => refresh(clubId) });

export const useAthletes = (clubId: string | undefined, f: { q?: string; group_id?: string } = {}) =>
  useQuery({ queryKey: [...memberKeys.athletes(clubId ?? ""), f], enabled: !!clubId, queryFn: () => api.get<{ items: AthleteSummary[] }>(`/clubs/${clubId}/athletes${qs({ ...f, limit: 500 })}`).then((r) => r.items) });

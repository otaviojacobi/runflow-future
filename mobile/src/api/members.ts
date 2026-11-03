/** Membros (O2): the club's people by role, promoting, suspending, removing; like the web's src/api/members.ts. Groups
 * and athletes live in api/staff.ts. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Member, Role } from "./types";

export const membersKey = (clubId: string) => ["clubs", clubId, "members"] as const;
/** Members change the seats (`/me` subscription), the athlete lists and the dashboard: refresh the club. */
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId] });
  void queryClient.invalidateQueries({ queryKey: meKey });
};

export const useMembers = (clubId: string | undefined, f: { role?: string; q?: string } = {}) =>
  useQuery({
    queryKey: [...membersKey(clubId ?? ""), f], enabled: !!clubId,
    queryFn: () => {
      const q = new URLSearchParams({ limit: "500" });
      if (f.role) q.set("role", f.role);
      if (f.q) q.set("q", f.q);
      return api.get<{ items: Member[] }>(`/clubs/${clubId}/members?${q.toString()}`).then((r) => r.items);
    },
  });
/** Promote a trainer to owner, or suspend / reactivate a student (`409 plan.limit_reached` when there's no seat). */
export const useUpdateMember = (clubId: string) =>
  useMutation({ mutationFn: (v: { id: string; role?: Role; status?: "active" | "suspended" }) => api.patch<Member>(`/clubs/${clubId}/members/${v.id}`, { role: v.role, status: v.status }), onSuccess: () => refresh(clubId) });
export const useRemoveMember = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/members/${id}`), onSuccess: () => refresh(clubId) });

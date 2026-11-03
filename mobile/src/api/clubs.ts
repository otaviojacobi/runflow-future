import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Branding, Club, Invitation, Membership, PublicInvite, Sport, Subscription } from "./types";

/** The invite page data depends on who asks (email_matches, already_member), so the key carries the session. */
export function usePublicInvite(token: string) {
  const { signedIn } = useSession();
  return useQuery({ queryKey: ["public-invite", token, signedIn], queryFn: () => api.get<PublicInvite>(`/public/invites/${encodeURIComponent(token)}`), staleTime: 0 });
}
export const useAcceptInvite = () =>
  useMutation({
    mutationFn: (token: string) => api.post<{ membership: Membership; club: Club; already_member: boolean }>(`/invites/${encodeURIComponent(token)}/accept`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });

// ---------- creating a club (A5) and its first setup; Club Studio and Membros (X15) build on these
export const clubKeys = { invites: (clubId: string) => ["clubs", clubId, "invites"] as const };
export const useCreateClub = () =>
  useMutation({
    mutationFn: (v: { name: string; city: string; state: string; modalities: Sport[] }) =>
      api.post<{ club: Club; membership: Membership; branding: Branding; subscription: Subscription }>("/clubs", v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });
/** Colors (0–2, D-014) and the logo; the server derives and stores the theme (D-019). */
export const useSaveBranding = (clubId: string) =>
  useMutation({
    mutationFn: (v: { primary_color: string | null; secondary_color: string | null; logo_asset_id?: string | null }) => api.put<Branding>(`/clubs/${clubId}/branding`, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });
export const useUploadAsset = (clubId: string) =>
  useMutation({ mutationFn: (v: { data_url: string; width: number; height: number; kind?: "logo" | "avatar" }) => api.post<{ id: string; url: string }>(`/clubs/${clubId}/assets`, v) });
/** A personal invite e-mailed by Runflow (D-023); over the plan's seats → `409 plan.limit_reached`. */
export const useCreateInvite = (clubId: string) =>
  useMutation({
    mutationFn: (v: { email: string; role: "student" | "trainer"; name?: string; group_ids?: string[] }) => api.post<Invitation>(`/clubs/${clubId}/invites`, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }),
  });

// ---------- the owner's club (O1–O3, X15)
/** Club data, modalities, the trainer label, timezone and week release (PATCH takes only what's sent). */
export const useUpdateClub = (clubId: string) =>
  useMutation({ mutationFn: (v: Partial<Club>) => api.patch<Club>(`/clubs/${clubId}`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }) });
/** Close the club (owner): soft delete, plan canceled, invites revoked; `confirm_name` must match. */
export const useCloseClub = (clubId: string) =>
  useMutation({ mutationFn: (confirm_name: string) => api.del(`/clubs/${clubId}`, { confirm_name }), onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }) });

export const useInvites = (clubId: string | undefined) =>
  useQuery({ queryKey: clubKeys.invites(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Invitation[] }>(`/clubs/${clubId}/invites`).then((r) => r.items) });
/** A new link, valid 7 more days; the old one stops working. */
export const useResendInvite = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.post<Invitation>(`/clubs/${clubId}/invites/${id}/resend`), onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }) });
export const useRevokeInvite = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/invites/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }) });
export interface BulkResult { created: number; items: { email: string; url: string; name: string | null }[]; skipped: { row: number; email: string; reason: string }[]; over_limit: number }
/** Invite many students from a spreadsheet: one personal invite e-mailed per valid row. */
export const useBulkInvites = (clubId: string) =>
  useMutation({
    mutationFn: (rows: { name: string; email: string; groups: string }[]) => api.post<BulkResult>(`/clubs/${clubId}/invites/bulk`, { rows }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }),
  });

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

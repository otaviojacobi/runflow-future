import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Club, Membership, PublicInvite } from "./types";

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

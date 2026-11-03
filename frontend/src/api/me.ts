import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { session } from "@/lib/session";
import type { Me } from "./types";
import { setErrorUser } from "@/lib/sentry";

export const meKey = ["me"] as const;
/** The signed-in person; errors sent to Sentry carry their id (S12). */
export const fetchMe = () => api.get<Me>("/me").then((me) => { setErrorUser(me.user.id); return me; });

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, enabled: session.isSignedIn(), staleTime: 60_000 });
}
export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: meKey });
}

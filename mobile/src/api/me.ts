import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { session, useSession } from "@/lib/session";
import type { Me } from "./types";

export const meKey = ["me"] as const;
/** GET /me, kept on the device for the next cold start (first frame themed, shell offline). */
export const fetchMe = () => api.get<Me>("/me").then((m) => { session.setMe(m); return m; });

/** Starts from the cached `/me` and revalidates right away. */
export function useMe() {
  const { signedIn } = useSession();
  // Refetched every minute while the app is in front: the bell and the Mensagens count (messages don't push by default).
  return useQuery({ queryKey: meKey, queryFn: fetchMe, enabled: signedIn, initialData: () => session.me() ?? undefined, initialDataUpdatedAt: 0, staleTime: 60_000, refetchInterval: 60_000 });
}

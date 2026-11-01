import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { session } from "@/lib/session";
import type { Me } from "./types";

export const meKey = ["me"] as const;
export const fetchMe = () => api.get<Me>("/me");

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, enabled: session.isSignedIn(), staleTime: 60_000 });
}
export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: meKey });
}

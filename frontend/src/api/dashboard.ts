import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Dashboard } from "./types";

export const useDashboard = (clubId: string | undefined) =>
  useQuery({ queryKey: ["clubs", clubId ?? "", "dashboard"], enabled: !!clubId, refetchInterval: 60_000, queryFn: () => api.get<Dashboard>(`/clubs/${clubId}/dashboard`) });

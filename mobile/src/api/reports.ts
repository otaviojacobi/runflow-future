/** Reports (W16), like the web's src/api/reports.ts. Exports are built on the device from this payload. */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TrainingReport } from "./types";

type F = { from: string; to: string; group_id?: string };
export const useTrainingReport = (clubId: string | undefined, f: F) =>
  useQuery({
    queryKey: ["clubs", clubId ?? "", "reports", "training", f], enabled: !!clubId,
    queryFn: () => api.get<TrainingReport>(`/clubs/${clubId}/reports/training?from=${f.from}&to=${f.to}${f.group_id ? `&group_id=${f.group_id}` : ""}`),
    placeholderData: (prev) => prev,
  });

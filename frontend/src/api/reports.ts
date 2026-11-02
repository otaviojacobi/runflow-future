/** Reports (F25). */
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type { AttendanceReport, TrainingReport } from "./types";

type F = { from: string; to: string; group_id?: string };
export const useTrainingReport = (clubId: string | undefined, f: F) =>
  useQuery({ queryKey: ["clubs", clubId ?? "", "reports", "training", f], enabled: !!clubId, queryFn: () => api.get<TrainingReport>(`/clubs/${clubId}/reports/training${qs(f)}`) });
export const useAttendanceReport = (clubId: string | undefined, f: F) =>
  useQuery({ queryKey: ["clubs", clubId ?? "", "reports", "attendance", f], enabled: !!clubId, queryFn: () => api.get<AttendanceReport>(`/clubs/${clubId}/reports/attendance${qs(f)}`) });

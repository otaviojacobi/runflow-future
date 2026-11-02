/** Assessments and tests (F23). */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AssessmentData, AssessmentKind } from "@/domain/assessments";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { accountKeys } from "./account";
import type { Assessment } from "./types";

const k = (clubId: string) => ["clubs", clubId, "assessments"] as const;
export const useAssessments = (clubId: string | undefined, f: { membership_id?: string; kind?: string } = {}) =>
  useQuery({ queryKey: [...k(clubId ?? ""), f], enabled: !!clubId, queryFn: () => api.get<{ items: Assessment[] }>(`/clubs/${clubId}/assessments${qs(f)}`).then((r) => r.items) });
export const useMyAssessments = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "mine"], enabled: !!clubId, queryFn: () => api.get<{ items: Assessment[] }>(`/clubs/${clubId}/my/assessments`).then((r) => r.items) });
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: k(clubId) }); queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "athletes"] }); queryClient.invalidateQueries({ queryKey: accountKeys.myProfile(clubId) }); };
export const useCreateAssessment = (clubId: string) => useMutation({
  mutationFn: (v: { membership_id: string; kind: AssessmentKind; date: string; data: AssessmentData; notes?: string; apply_zones?: boolean }) => api.post<Assessment>(`/clubs/${clubId}/assessments`, v),
  onSuccess: () => refresh(clubId),
});
export const useDeleteAssessment = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/assessments/${id}`), onSuccess: () => refresh(clubId) });

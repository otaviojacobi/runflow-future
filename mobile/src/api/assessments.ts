/** Assessments and tests (W14), like the web's src/api/assessments.ts. The student's own list is in api/account.ts. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Assessment, AssessmentData, AssessmentKind } from "./types";

const k = (clubId: string) => ["clubs", clubId, "assessments"] as const;
export const useAssessments = (clubId: string | undefined, f: { membership_id?: string; kind?: string } = {}) =>
  useQuery({
    queryKey: [...k(clubId ?? ""), f], enabled: !!clubId,
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
      return api.get<{ items: Assessment[] }>(`/clubs/${clubId}/assessments${q ? `?${q}` : ""}`).then((r) => r.items);
    },
  });
/** A test can change the student's zones and profile: refresh the athlete views and their own profile too. */
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: k(clubId) });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "athletes"] });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "athlete"] });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "my-profile"] });
};
export const useCreateAssessment = (clubId: string) => useMutation({
  mutationFn: (v: { membership_id: string; kind: AssessmentKind; date: string; data: AssessmentData; notes?: string; apply_zones?: boolean }) => api.post<Assessment>(`/clubs/${clubId}/assessments`, v),
  onSuccess: () => refresh(clubId),
});
export const useDeleteAssessment = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/assessments/${id}`), onSuccess: () => refresh(clubId) });

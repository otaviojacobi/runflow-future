/** Club finances (F26): fee plans, student fees, charges, payments, receipts. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Charge, ChargeMethod, FeePlan, FinanceSummary, Receipt, StudentFeeRow } from "./types";

const k = (clubId: string) => ["clubs", clubId, "finances"] as const;
const refresh = (clubId: string) => queryClient.invalidateQueries({ queryKey: k(clubId) });

export const useFinanceSummary = (clubId: string | undefined, period: string) => useQuery({ queryKey: [...k(clubId ?? ""), "summary", period], enabled: !!clubId, queryFn: () => api.get<FinanceSummary>(`/clubs/${clubId}/finance/summary${qs({ period })}`) });
export const useConnectAccount = (clubId: string) => useMutation({ mutationFn: () => api.post(`/clubs/${clubId}/finance/account/connect`), onSuccess: () => refresh(clubId) });
export const useFeePlans = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "plans"], enabled: !!clubId, queryFn: () => api.get<{ items: FeePlan[] }>(`/clubs/${clubId}/fee-plans`).then((r) => r.items) });
export const useSaveFeePlan = (clubId: string) => useMutation({ mutationFn: ({ id, ...v }: Partial<FeePlan> & { name: string; amount_cents: number }) => (id ? api.patch<FeePlan>(`/clubs/${clubId}/fee-plans/${id}`, v) : api.post<FeePlan>(`/clubs/${clubId}/fee-plans`, v)), onSuccess: () => refresh(clubId) });
export const useArchiveFeePlan = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/fee-plans/${id}`), onSuccess: () => refresh(clubId) });
export const useStudentFees = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "student-fees"], enabled: !!clubId, queryFn: () => api.get<{ items: StudentFeeRow[] }>(`/clubs/${clubId}/student-fees`).then((r) => r.items) });
export const useAssignFee = (clubId: string) => useMutation({ mutationFn: ({ membership_id, ...v }: { membership_id: string; fee_plan_id: string; amount_cents?: number | null; due_day?: number }) => api.put(`/clubs/${clubId}/student-fees/${membership_id}`, v), onSuccess: () => refresh(clubId) });
export const useRemoveFee = (clubId: string) => useMutation({ mutationFn: (membership_id: string) => api.del(`/clubs/${clubId}/student-fees/${membership_id}`), onSuccess: () => refresh(clubId) });
export const useCharges = (clubId: string | undefined, f: { period?: string; state?: string; membership_id?: string }) => useQuery({ queryKey: [...k(clubId ?? ""), "charges", f], enabled: !!clubId, queryFn: () => api.get<{ items: Charge[] }>(`/clubs/${clubId}/charges${qs(f)}`).then((r) => r.items) });
export const useGenerateCharges = (clubId: string) => useMutation({ mutationFn: (period: string) => api.post<{ created: number }>(`/clubs/${clubId}/charges/generate`, { period }), onSuccess: () => refresh(clubId) });
export const useCreateCharge = (clubId: string) => useMutation({ mutationFn: (v: { membership_id: string; description: string; amount_cents: number; due_date: string }) => api.post<Charge>(`/clubs/${clubId}/charges`, v), onSuccess: () => refresh(clubId) });
export const useChargeAction = (clubId: string) => useMutation({ mutationFn: (v: { id: string; action: "mark-paid" | "void" | "remind"; method?: ChargeMethod }) => api.post<Charge>(`/clubs/${clubId}/charges/${v.id}/${v.action}`, v.method ? { method: v.method } : {}), onSuccess: () => refresh(clubId) });
export const useMyCharges = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "mine"], enabled: !!clubId, queryFn: () => api.get<{ items: Charge[]; account: boolean }>(`/clubs/${clubId}/my/charges`) });
export const useChargeCheckout = (clubId: string) => useMutation({ mutationFn: (id: string) => api.post<{ checkout_url: string }>(`/clubs/${clubId}/my/charges/${id}/checkout`) });
export const useReceipt = (clubId: string | undefined, id: string) => useQuery({ queryKey: [...k(clubId ?? ""), "receipt", id], enabled: !!clubId, retry: false, queryFn: () => api.get<Receipt>(`/clubs/${clubId}/charges/${id}/receipt`) });
export const useMockPay = (clubId: string) => useMutation({ mutationFn: (v: { charge_id: string; method: "pix" | "card" }) => api.post<Charge>(`/mock/payments/complete`, v), onSuccess: () => refresh(clubId) });

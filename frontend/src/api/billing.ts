/** Billing (Stripe). In the mock, checkout and portal URLs point to in-app pages under /dev/stripe/*. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Invoice, Subscription } from "./types";

const k = (clubId: string) => ["clubs", clubId, "billing"] as const;
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: k(clubId) }); queryClient.invalidateQueries({ queryKey: meKey }); };

export const useSubscription = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "subscription"], enabled: !!clubId, queryFn: () => api.get<Subscription>(`/clubs/${clubId}/subscription`) });
export const useInvoices = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "invoices"], enabled: !!clubId, queryFn: () => api.get<{ items: Invoice[] }>(`/clubs/${clubId}/invoices`).then((r) => r.items) });
export const useCheckout = (clubId: string) => useMutation({ mutationFn: (plan: "pro") => api.post<{ checkout_url: string }>(`/clubs/${clubId}/subscription/checkout`, { plan }) });
export const usePortal = (clubId: string) => useMutation({ mutationFn: () => api.post<{ portal_url: string }>(`/clubs/${clubId}/subscription/portal`) });

/** Mock only: what Stripe's webhooks would do. */
export const useMockCompleteCheckout = (clubId: string) => useMutation({ mutationFn: (plan: "pro") => api.post<Subscription>(`/mock/stripe/complete`, { club_id: clubId, plan }), onSuccess: () => refresh(clubId) });
export const useMockPortalAction = (clubId: string) => useMutation({ mutationFn: (action: "cancel" | "resume" | "fail_payment" | "pay" | "expire") => api.post<Subscription>(`/mock/stripe/portal`, { club_id: clubId, action }), onSuccess: () => refresh(clubId) });

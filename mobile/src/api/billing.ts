/**
 * Billing (Stripe, D-016) and plans by seats (D-043), like the web's src/api/billing.ts. Checkout and the billing portal
 * are Stripe's pages, opened in the browser; the mock answers in-app `/dev/stripe/*` paths instead, which the app
 * simulates with its own sheets (components/billing/MockStripe.tsx).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Invoice, PaidPlan, PlanCatalog, Subscription } from "./types";

const k = (clubId: string) => ["clubs", clubId, "billing"] as const;
/** The plan shows in `/me` (frozen layer, seats) and on the Painel: refresh both. */
export const refreshBilling = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: k(clubId) });
  void queryClient.invalidateQueries({ queryKey: meKey });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "dashboard"] });
};

/** The plan catalog: seats per role and prices (public, rarely changes). */
export const usePlans = () => useQuery({ queryKey: ["public", "plans"], staleTime: Infinity, queryFn: () => api.get<PlanCatalog>("/public/plans") });
export const useSubscription = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "subscription"], enabled: !!clubId, queryFn: () => api.get<Subscription>(`/clubs/${clubId}/subscription`) });
export const useInvoices = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "invoices"], enabled: !!clubId, queryFn: () => api.get<{ items: Invoice[] }>(`/clubs/${clubId}/invoices`).then((r) => r.items) });
export const useCheckout = (clubId: string) => useMutation({ mutationFn: (plan: PaidPlan) => api.post<{ checkout_url: string }>(`/clubs/${clubId}/subscription/checkout`, { plan }) });
/** Pro ⇄ Max on a paid plan (`409 plan.too_small` when the club doesn't fit). */
export const useChangePlan = (clubId: string) =>
  useMutation({ mutationFn: (plan: PaidPlan) => api.post<Subscription>(`/clubs/${clubId}/subscription/change`, { plan }), onSuccess: () => refreshBilling(clubId) });
export const usePortal = (clubId: string) => useMutation({ mutationFn: () => api.post<{ portal_url: string }>(`/clubs/${clubId}/subscription/portal`) });

/** Mock only: what Stripe's webhooks would do. */
export type MockPortalAction = "cancel" | "resume" | "fail_payment" | "freeze" | "pay" | "expire";
export const useMockCompleteCheckout = (clubId: string) =>
  useMutation({ mutationFn: (plan: PaidPlan) => api.post<Subscription>("/mock/stripe/complete", { club_id: clubId, plan }), onSuccess: () => refreshBilling(clubId) });
export const useMockPortalAction = (clubId: string) =>
  useMutation({ mutationFn: (action: MockPortalAction) => api.post<Subscription>("/mock/stripe/portal", { club_id: clubId, action }), onSuccess: () => refreshBilling(clubId) });

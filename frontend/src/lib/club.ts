import { useSyncExternalStore } from "react";
import { useMe } from "@/api/me";
import type { Me, MembershipContext, Role } from "@/api/types";
import { session } from "./session";
import { applyClubTheme } from "./theme";

/** The active club: the stored one if the user still belongs to it, else staff clubs first, else the first. */
export function activeMembership(me: Me | undefined): MembershipContext | null {
  if (!me?.memberships.length) return null;
  const stored = session.clubId();
  return me.memberships.find((m) => m.club.id === stored) ?? me.memberships.find((m) => m.membership.role !== "student") ?? me.memberships[0]!;
}
// Active club id as a subscribable store, so every component re-renders on a club switch.
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export function selectClub(m: MembershipContext | null) {
  session.setClubId(m?.club.id ?? null);
  applyClubTheme(m?.branding?.theme_css ?? null);
  listeners.forEach((l) => l());
}
export function homeFor(role: Role | null | undefined): "/dashboard" | "/today" | "/clubs" {
  return role === "owner" || role === "trainer" ? "/dashboard" : role === "student" ? "/today" : "/clubs";
}
/** Hook for screens inside the app shell: always has a club (the shell guarantees it). */
export function useClub() {
  useSyncExternalStore(subscribe, session.clubId);
  const me = useMe();
  const ctx = activeMembership(me.data);
  return { me: me.data, ctx, club: ctx?.club, role: ctx?.membership.role, isStaff: ctx ? ctx.membership.role !== "student" : false, isOwner: ctx?.membership.role === "owner" };
}

/** pt-BR role names (pass through t()). */
export const ROLE_LABEL = { owner: "Gestor(a)", trainer: "Treinador(a)", student: "Aluno(a)" } as const;

/** The active club, like the web's lib/club.ts: per-club roles (§4.2), one club at a time, switched in the shell. */
import type { Href } from "expo-router";
import { useMe } from "@/api/me";
import type { Me, MembershipContext, Role } from "@/api/types";
import { session, useSession } from "./session";

/** The stored club if the person still belongs to it, else a staff club first, else the first. */
export function activeMembership(me: Me | null | undefined, stored: string | null): MembershipContext | null {
  if (!me?.memberships.length) return null;
  return me.memberships.find((m) => m.club.id === stored) ?? me.memberships.find((m) => m.membership.role !== "student") ?? me.memberships[0]!;
}
export function selectClub(m: MembershipContext | null) {
  session.setClubId(m?.club.id ?? null);
}
/** Where a role starts. Until the in-club tabs exist (X3) everyone starts on the club list. */
export function homeFor(_role: Role | null | undefined): Href {
  return "/clubs";
}
/** A safe in-app path from a `redirect` param (never another host). */
export function safeRedirect(r: unknown): Href | null {
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? (r as Href) : null;
}

export function useClub() {
  const { clubId } = useSession();
  const me = useMe();
  const ctx = activeMembership(me.data, clubId);
  return { me: me.data, meQuery: me, ctx, club: ctx?.club, role: ctx?.membership.role, isStaff: ctx ? ctx.membership.role !== "student" : false, isOwner: ctx?.membership.role === "owner" };
}

/** Accepts a full invite link (…/invite/abc, runflow://invite/abc) or just the code (same rule as the web). */
export function inviteTokenFrom(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/invite\/([\w-]+)/);
  return m ? m[1]! : /^[\w-]{3,}$/.test(s) ? s : null;
}

/** pt-BR role names (pass through t()). */
export const ROLE_LABEL = { owner: "Gestor(a)", trainer: "Treinador(a)", student: "Aluno(a)" } as const;

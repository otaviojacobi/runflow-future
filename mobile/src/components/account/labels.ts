/**
 * pt-BR labels for the account screens, the same as the web's (onboarding/Welcome GOALS/LEVELS, student Profile
 * RACES, NotificationSettings INFO, Account deviceName). Pass the labels through t().
 */
import type { AssessmentData, AssessmentKind, AssessmentResult, Goal, Level, MembershipContext, NotificationKind, UserSession } from "@/api/types";
import { headline } from "@/components/assessments";
import { has } from "@/lib/features";
import { t } from "@/i18n";

export const GOALS: { value: Goal; label: string }[] = [
  { value: "5k", label: "5 km" }, { value: "10k", label: "10 km" }, { value: "21k", label: "Meia maratona" }, { value: "42k", label: "Maratona" },
  { value: "trail", label: "Trilha" }, { value: "triathlon", label: "Triatlo" }, { value: "swim", label: "Natação" }, { value: "strength", label: "Força" },
  { value: "health", label: "Saúde e bem-estar" }, { value: "other", label: "Outro" },
];
export const LEVELS: { value: Level; label: string }[] = [{ value: "beginner", label: "Iniciante" }, { value: "intermediate", label: "Intermediário" }, { value: "advanced", label: "Avançado" }];
export const RACES = [{ m: 5000, label: "5 km" }, { m: 10000, label: "10 km" }, { m: 21097, label: "Meia maratona" }, { m: 42195, label: "Maratona" }];

/** Assessments: one copy, shared with W14 (components/assessments.ts). */
export { ASSESSMENT_NAME } from "@/components/assessments";
export const assessmentHeadline = (kind: AssessmentKind, r: AssessmentResult, d: AssessmentData): string => headline(kind, r, d).text;

// ---------- notifications (D-045)
/** Notification kinds by name only (founder, 2026-11-07: the names say it, no explanations). */
export const KIND_LABEL: Record<NotificationKind, string> = {
  workout_assigned: "Treino novo",
  workout_changed: "Treino alterado",
  week_released: "Semana liberada",
  comment: "Comentários",
  message: "Mensagens",
  announcement: "Mural",
  feedback: "Feedbacks dos alunos",
  member_joined: "Novos membros",
  billing: "Plano e cobrança",
  class_cancelled: "Aula cancelada",
  waitlist_promoted: "Vaga liberada",
  activity_synced: "Atividade sincronizada",
};
const STUDENT_KINDS: NotificationKind[] = ["week_released", "workout_assigned", "workout_changed", "comment", "message", "announcement"];
const STAFF_KINDS: NotificationKind[] = ["feedback", "comment", "message", "member_joined"];
/** The kinds this person can receive, by the roles they hold in any club. */
export function kindsFor(memberships: MembershipContext[]): NotificationKind[] {
  const roles = new Set(memberships.map((m) => m.membership.role));
  const out: NotificationKind[] = [];
  if (roles.has("student")) out.push(...STUDENT_KINDS);
  // Where a club the person studies at uses them (D-052): class news; Strava syncs (D-055).
  const studies = memberships.filter((m) => m.membership.role === "student" && m.membership.status === "active");
  if (studies.some((m) => has(m.club, "classes"))) out.push("class_cancelled", "waitlist_promoted");
  if (studies.some((m) => has(m.club, "strava"))) out.push("activity_synced");
  if (roles.has("trainer") || roles.has("owner")) out.push(...STAFF_KINDS);
  if (roles.has("owner")) out.push("billing");
  return [...new Set(out)];
}

// ---------- devices
/** "App Runflow", "Chrome no Android", "Safari no iPhone"… from the session's kind and user agent. */
export function deviceName(s: UserSession): string {
  if (s.kind === "mobile") return t("App Runflow");
  const ua = s.user_agent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : t("Navegador");
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? t("{b} no {o}", { b: browser, o: os }) : browser;
}

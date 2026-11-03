/**
 * pt-BR labels for the account screens, the same as the web's (onboarding/Welcome GOALS/LEVELS, student Profile
 * RACES, components/assessments, NotificationSettings INFO, Account deviceName). Pass the labels through t().
 */
import type { AssessmentData, AssessmentKind, AssessmentResult, Goal, Level, MembershipContext, NotificationKind, UserSession } from "@/api/types";
import { t } from "@/i18n";
import { clock, number, pace } from "@/lib/format";

export const GOALS: { value: Goal; label: string }[] = [
  { value: "5k", label: "5 km" }, { value: "10k", label: "10 km" }, { value: "21k", label: "Meia maratona" }, { value: "42k", label: "Maratona" },
  { value: "trail", label: "Trilha" }, { value: "triathlon", label: "Triatlo" }, { value: "swim", label: "Natação" }, { value: "strength", label: "Força" },
  { value: "health", label: "Saúde e bem-estar" }, { value: "other", label: "Outro" },
];
export const LEVELS: { value: Level; label: string }[] = [{ value: "beginner", label: "Iniciante" }, { value: "intermediate", label: "Intermediário" }, { value: "advanced", label: "Avançado" }];
export const RACES = [{ m: 5000, label: "5 km" }, { m: 10000, label: "10 km" }, { m: 21097, label: "Meia maratona" }, { m: 42195, label: "Maratona" }];

export const ASSESSMENT_NAME: Record<AssessmentKind, string> = {
  cooper: "Teste de Cooper", run_3k: "Teste de 3 km", css: "CSS (natação)", ftp: "FTP (ciclismo)", hr_max: "FC máxima", one_rm: "1RM estimado", body: "Avaliação física",
};
/** The headline value of a result (the web's components/assessments `headline`). */
export function assessmentHeadline(kind: AssessmentKind, r: AssessmentResult, d: AssessmentData): string {
  switch (kind) {
    case "body": return t("{w} kg · IMC {b}", { w: number(d.weight_kg ?? 0, 1), b: number(r.bmi ?? 0, 1) }) + (d.body_fat_pct ? ` · ${t("{p}% de gordura", { p: number(d.body_fat_pct, 1) })}` : "");
    case "cooper": return t("{d} m · VO₂máx {v} · limiar {p} /km", { d: number(d.distance_m ?? 0), v: number(r.vo2max ?? 0, 1), p: pace(r.threshold_pace_s_per_km) });
    case "run_3k": return t("{t} · VO₂máx {v} · limiar {p} /km", { t: clock(d.time_s), v: number(r.vo2max ?? 0, 1), p: pace(r.threshold_pace_s_per_km) });
    case "css": return t("CSS {p} /100 m", { p: pace(r.css_s_per_100m) });
    case "ftp": return t("FTP {w} W", { w: r.ftp_w ?? 0 });
    case "one_rm": return t("{e}: {k} kg", { e: d.exercise ?? "", k: number(r.one_rm_kg ?? 0, 1) });
    case "hr_max": return t("FC máx {n} bpm", { n: r.max_hr ?? 0 });
  }
}

// ---------- notifications (D-045)
export const KIND_INFO: Record<NotificationKind, { label: string; hint: string }> = {
  workout_assigned: { label: "Treino novo", hint: "Um treino entrou na sua agenda" },
  workout_changed: { label: "Treino alterado", hint: "Mudou de dia ou de conteúdo" },
  week_released: { label: "Semana liberada", hint: "Os treinos da semana ficaram disponíveis" },
  comment: { label: "Comentários", hint: "Respostas nos treinos" },
  message: { label: "Mensagens", hint: "Conversas no app" },
  announcement: { label: "Mural", hint: "Avisos do clube" },
  feedback: { label: "Feedbacks dos alunos", hint: "Um aluno registrou ou comentou um treino" },
  member_joined: { label: "Novos membros", hint: "Alguém entrou no clube" },
  billing: { label: "Plano e cobrança", hint: "Limite de alunos e avisos do plano" },
};
const STUDENT_KINDS: NotificationKind[] = ["week_released", "workout_assigned", "workout_changed", "comment", "message", "announcement"];
const STAFF_KINDS: NotificationKind[] = ["feedback", "comment", "message", "member_joined"];
/** The kinds this person can receive, by the roles they hold in any club. */
export function kindsFor(memberships: MembershipContext[]): NotificationKind[] {
  const roles = new Set(memberships.map((m) => m.membership.role));
  const out: NotificationKind[] = [];
  if (roles.has("student")) out.push(...STUDENT_KINDS);
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

/**
 * Assessment protocols and how to summarize a result (W14 staff, M7 student): the web's components/assessments.tsx.
 * Labels are pt-BR source strings; pass them through t().
 */
import type { AssessmentData, AssessmentKind, AssessmentResult } from "@/api/types";
import { t } from "@/i18n";
import { clock, number, pace } from "@/lib/format";
import { Activity, Bike, Dumbbell, HeartPulse, Ruler, Timer, Waves, type Icon } from "@/ui/icons";

export interface Protocol { kind: AssessmentKind; name: string; how: string; icon: Icon; zones?: string }
export const PROTOCOLS: Protocol[] = [
  { kind: "cooper", name: "Teste de Cooper", how: "Correr a maior distância possível em 12 minutos.", icon: Timer, zones: "zonas de pace" },
  { kind: "run_3k", name: "Teste de 3 km", how: "3 km no melhor tempo, em pista ou percurso plano.", icon: Activity, zones: "zonas de pace" },
  { kind: "css", name: "CSS (natação)", how: "400 m e 200 m no máximo, com descanso entre eles.", icon: Waves, zones: "zonas de natação" },
  { kind: "ftp", name: "FTP (ciclismo)", how: "Potência média dos melhores 20 minutos.", icon: Bike, zones: "zonas de potência" },
  { kind: "hr_max", name: "FC máxima", how: "Maior frequência cardíaca em teste de esforço.", icon: HeartPulse, zones: "zonas de FC" },
  { kind: "one_rm", name: "1RM estimado", how: "Carga e repetições até a falha; estimamos o máximo.", icon: Dumbbell },
  { kind: "body", name: "Avaliação física", how: "Peso, altura, % de gordura e circunferências.", icon: Ruler },
];
export const ASSESSMENT_NAME = Object.fromEntries(PROTOCOLS.map((p) => [p.kind, p.name])) as Record<AssessmentKind, string>;

/** The headline value of a result, for lists and comparisons (`better`: which way is an improvement). */
export function headline(kind: AssessmentKind, r: AssessmentResult, d: AssessmentData): { text: string; value?: number; better?: "up" | "down" } {
  switch (kind) {
    case "body": return { text: t("{w} kg · IMC {b}", { w: number(d.weight_kg ?? 0, 1), b: number(r.bmi ?? 0, 1) }) + (d.body_fat_pct ? ` · ${t("{p}% de gordura", { p: number(d.body_fat_pct, 1) })}` : ""), value: d.weight_kg };
    case "cooper": return { text: t("{d} m · VO₂máx {v} · limiar {p} /km", { d: number(d.distance_m ?? 0), v: number(r.vo2max ?? 0, 1), p: pace(r.threshold_pace_s_per_km) }), value: r.vo2max, better: "up" };
    case "run_3k": return { text: t("{t} · VO₂máx {v} · limiar {p} /km", { t: clock(d.time_s), v: number(r.vo2max ?? 0, 1), p: pace(r.threshold_pace_s_per_km) }), value: r.vo2max, better: "up" };
    case "css": return { text: t("CSS {p} /100 m", { p: pace(r.css_s_per_100m) }), value: r.css_s_per_100m, better: "down" };
    case "ftp": return { text: t("FTP {w} W", { w: r.ftp_w ?? 0 }), value: r.ftp_w, better: "up" };
    case "one_rm": return { text: t("{e}: {k} kg", { e: d.exercise ?? "", k: number(r.one_rm_kg ?? 0, 1) }), value: r.one_rm_kg, better: "up" };
    case "hr_max": return { text: t("FC máx {n} bpm", { n: r.max_hr ?? 0 }), value: r.max_hr };
  }
}

/** Student labels (the web's onboarding GOALS and LEVELS: keep them in sync) and the parsers of W3's forms. Pass labels through t(). */
import type { Goal, Level } from "@/api/types";

export const GOAL_LABEL: Record<Goal, string> = {
  "5k": "5 km", "10k": "10 km", "21k": "Meia maratona", "42k": "Maratona", trail: "Trilha", triathlon: "Triatlo", swim: "Natação", strength: "Força",
  health: "Saúde e bem-estar", other: "Outro",
};
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Iniciante", intermediate: "Intermediário", advanced: "Avançado" };

/** "52:30" → 3150 s, "1:45:00" → 6300 s (the web's parseTime); anything else → null. */
export const parseTime = (s: string) => {
  const p = s.trim().split(":").map(Number);
  if (p.some((x) => isNaN(x)) || p.length < 2 || p.length > 3) return null;
  return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!;
};
/** "4:30" → 270 s per km, or null. */
export const parsePace = (s: string) => { const m = s.trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

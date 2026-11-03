/** Small helpers shared by the Mensagens screens (pt-BR labels go through t()). */
import type { Club, Message, Role } from "@/api/types";
import { t } from "@/i18n";
import { addDays, shortDate } from "@/lib/format";

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Treinadores" or "Professores", as the club calls its staff. */
export const staffPlural = (club: Pick<Club, "trainer_label">) => (club.trainer_label === "professor" ? t("Professores") : t("Treinadores"));
/** A staff author's role in a bubble: "treinador(a)" / "professor(a)"; nothing for students. */
export const roleTag = (club: Pick<Club, "trainer_label">, role: Role | undefined) =>
  role && role !== "student" ? (club.trainer_label === "professor" ? t("professor(a)") : t("treinador(a)")) : null;

/** "Hoje", "Ontem" or "seg, 2 nov" for a club-local date. */
export const dayLabel = (d: string, today: string) => (d === today ? t("Hoje") : d === addDays(today, -1) ? t("Ontem") : shortDate(d));

/** Case- and accent-insensitive text for search ("Júlia" matches "julia"). */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * A conversation row's last line: "Você: …", the text, or "Mensagem apagada". `named`: prefix others' messages with
 * the author's first name (the student's row, where several staff members write).
 */
export function previewOf(m: Message, myId: string, named = false) {
  if (m.deleted_at) return t("Mensagem apagada");
  const body = m.body.replace(/\s+/g, " ").trim();
  if (m.author_membership_id === myId) return t("Você: {text}", { text: body });
  return named ? t("{name}: {text}", { name: firstName(m.author.user.name), text: body }) : body;
}

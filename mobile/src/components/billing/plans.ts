/** How plans read in pt-BR (D-043): seats and prices come from GET /public/plans; the copy lives here so Plano e
 * cobrança and the checkout say the same thing. A copy of the web's components/billing/plans.ts: keep them in sync. */
import type { Plan, PlanSpec, Subscription } from "@/api/types";
import { t, tn } from "@/i18n";
import { money } from "@/lib/format";

export const trainersText = (n: number) => tn(n, "{n} treinador", "{n} treinadores");
export const studentsText = (n: number) => tn(n, "{n} aluno", "{n} alunos");

/** "Até 30 alunos e 2 treinadores" (hard limits) or "100 alunos e 5 treinadores incluídos" (Max). */
export const seatsText = (p: PlanSpec) => p.extra
  ? t("{students} e {trainers} incluídos", { students: studentsText(p.students), trainers: trainersText(p.trainers) })
  : t("Até {students} e {trainers}", { students: studentsText(p.students), trainers: trainersText(p.trainers) });

/** Max: what each seat above the included ones costs. */
export const extraText = (p: PlanSpec) => p.extra
  ? t("Vaga extra: {student} por aluno e {trainer} por treinador, por mês", { student: money(p.extra.student_cents), trainer: money(p.extra.trainer_cents) })
  : null;

/** "R$ 20" for whole reais, "R$ 0,50" otherwise. */
export const price = (cents: number) => money(cents).replace(/,00$/, "");

const FEATURES: Record<Plan, string[]> = {
  free: ["Todos os recursos", "Club Studio com logo e cores", "Grátis para sempre"],
  pro: ["Todos os recursos do plano Free", "Suporte prioritário", "Cancele quando quiser"],
  max: ["Todos os recursos do plano Pro", "Cresça sem trocar de plano: pague só as vagas extras", "Atendimento dedicado"],
};
export const featuresOf = (id: Plan) => FEATURES[id].map((f) => t(f));

/** Whether a club with these members fits a plan (Free and Pro are hard limits). */
export const fits = (p: PlanSpec, s: Pick<Subscription, "active_students" | "active_trainers">) =>
  !!p.extra || (s.active_students <= p.students && s.active_trainers <= p.trainers);

import { Construction } from "lucide-react";
import { t } from "@/i18n";
import { ButtonLink, EmptyState } from "@/ui";

/** Temporary screen for routes whose step in docs/build-plan.md isn't built yet. */
export function Placeholder({ title, step }: { title: string; step: string }) {
  return (
    <EmptyState icon={<Construction />} title={title} action={<ButtonLink to="/clubs" variant="secondary">{t("Meus clubes")}</ButtonLink>}>
      {t("Esta tela chega na etapa {step} do plano.", { step })}
    </EmptyState>
  );
}

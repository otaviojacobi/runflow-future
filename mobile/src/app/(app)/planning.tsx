/** W4 · Planejamento (staff): quick edits of today's workouts come with X8; the full week grid stays on the web. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { PageHeader, Screen } from "@/ui";
import { CalendarRange } from "@/ui/icons";

export default function PlanningScreen() {
  return (
    <Screen>
      <PageHeader title={t("Planejamento")} />
      <ComingSoon icon={CalendarRange} title={t("Os treinos da semana aparecem aqui")} web="/planning">
        {t("Ajustes rápidos nos treinos de hoje chegam ao app em breve. Para planejar a semana inteira, use o Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

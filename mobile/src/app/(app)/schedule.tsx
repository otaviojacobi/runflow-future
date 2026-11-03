/** M3 · Agenda (student): the week and month of workouts come with X4. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { PageHeader, Screen } from "@/ui";
import { Calendar } from "@/ui/icons";

export default function ScheduleScreen() {
  return (
    <Screen>
      <PageHeader title={t("Agenda")} />
      <ComingSoon icon={Calendar} title={t("Sua agenda aparece aqui")} web="/schedule">
        {t("A semana e o mês de treinos chegam ao app em breve. Enquanto isso, veja sua agenda no Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

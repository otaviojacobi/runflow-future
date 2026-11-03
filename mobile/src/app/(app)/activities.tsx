/** M4 · Atividades (student, from Perfil, D-035): the list, detail and Strava come with X5. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { Screen } from "@/ui";
import { Activity } from "@/ui/icons";

export default function ActivitiesScreen() {
  return (
    <Screen>
      <ComingSoon icon={Activity} title={t("Suas atividades aparecem aqui")} web="/activities">
        {t("As atividades do Strava e as registradas à mão chegam ao app em breve. Enquanto isso, veja tudo no Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

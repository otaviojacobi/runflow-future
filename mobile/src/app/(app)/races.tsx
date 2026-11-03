/** Provas (student, from Perfil): the club's race calendar comes in a later step. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { Screen } from "@/ui";
import { Flag } from "@/ui/icons";

export default function RacesScreen() {
  return (
    <Screen>
      <ComingSoon icon={Flag} title={t("As provas do clube aparecem aqui")} web="/races">
        {t("O calendário de provas chega ao app em breve. Enquanto isso, veja as provas no Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

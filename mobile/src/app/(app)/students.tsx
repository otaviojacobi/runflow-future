/** W2 · Alunos (staff): the list with search, groups and compliance comes with X8. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { PageHeader, Screen } from "@/ui";
import { Users } from "@/ui/icons";

export default function StudentsScreen() {
  return (
    <Screen>
      <PageHeader title={t("Alunos")} />
      <ComingSoon icon={Users} title={t("Seus alunos aparecem aqui")} web="/students">
        {t("A lista de alunos, com a semana e o último treino de cada um, chega ao app em breve. Enquanto isso, use o Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

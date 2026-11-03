/** Mensagens (everyone; a student tab, under "Mais" for staff): conversations come in a later step. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { PageHeader, Screen } from "@/ui";
import { MessageCircle } from "@/ui/icons";

export default function MessagesScreen() {
  const { isStaff } = useClub();
  return (
    <Screen>
      {!isStaff && <PageHeader title={t("Mensagens")} />}
      <ComingSoon icon={MessageCircle} title={t("Suas conversas aparecem aqui")} web="/messages">
        {isStaff
          ? t("As conversas com os alunos e o mural do clube chegam ao app em breve. Enquanto isso, use o Runflow pela web.")
          : t("As conversas com o seu treinador e o mural do clube chegam ao app em breve. Enquanto isso, use o Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

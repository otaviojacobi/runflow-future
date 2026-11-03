/** W8 · Feedbacks (staff): the inbox of completions and comments comes with X8. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { PageHeader, Screen } from "@/ui";
import { MessageSquare } from "@/ui/icons";

export default function FeedbackScreen() {
  return (
    <Screen>
      <PageHeader title={t("Feedbacks")} />
      <ComingSoon icon={MessageSquare} title={t("Os feedbacks dos alunos aparecem aqui")} web="/feedback">
        {t("Treinos concluídos, PSE e comentários para responder chegam ao app em breve. Enquanto isso, use o Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

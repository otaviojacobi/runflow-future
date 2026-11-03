/** W11 · Notificações (everyone, from the bell): the list and read state come with X7. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { Screen } from "@/ui";
import { Bell } from "@/ui/icons";

export default function NotificationsScreen() {
  return (
    <Screen>
      <ComingSoon icon={Bell} title={t("Suas notificações aparecem aqui")} web="/notifications">
        {t("Treinos novos, comentários e avisos do clube chegam ao app em breve. Enquanto isso, veja tudo no Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

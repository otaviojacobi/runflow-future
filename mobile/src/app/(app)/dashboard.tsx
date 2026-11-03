/** W1 · Painel (staff): today's board, feedback to answer and alerts come with X8. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { longDate, today } from "@/lib/format";
import { PageHeader, Screen } from "@/ui";
import { LayoutDashboard } from "@/ui/icons";

export default function DashboardScreen() {
  const { me, club } = useClub();
  const first = me?.user.name.split(" ")[0] ?? "";
  return (
    <Screen>
      <PageHeader eyebrow={longDate(today(club?.timezone))} title={first ? t("Olá, {name}", { name: first }) : t("Painel")} />
      <ComingSoon icon={LayoutDashboard} title={t("O painel do clube aparece aqui")} web="/dashboard">
        {t("Quem treinou, quem não treinou e o que precisa da sua atenção chegam ao app em breve. Enquanto isso, use o Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

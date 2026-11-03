/** M1 · Hoje (student): today's workouts, the week strip and the last activity come with X4. */
import { ComingSoon } from "@/components/ComingSoon";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { longDate, today } from "@/lib/format";
import { PageHeader, Screen } from "@/ui";
import { Sun } from "@/ui/icons";

export default function TodayScreen() {
  const { me, club } = useClub();
  const first = me?.user.name.split(" ")[0] ?? "";
  return (
    <Screen>
      <PageHeader eyebrow={longDate(today(club?.timezone))} title={first ? t("Olá, {name}", { name: first }) : t("Hoje")} />
      <ComingSoon icon={Sun} title={t("Seu treino de hoje aparece aqui")} web="/today">
        {t("O Hoje está chegando ao app: o treino do dia, a semana e a última atividade. Enquanto isso, veja tudo no Runflow pela web.")}
      </ComingSoon>
    </Screen>
  );
}

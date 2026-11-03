/** C1 · Notificações (D-045): push per kind on the person's devices + "Pausar tudo". The settings live in components/account. */
import { NotificationSettings } from "@/components/account/NotificationSettings";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { Screen, Text } from "@/ui";

export default function NotificationSettingsScreen() {
  const { me } = useClub();
  return (
    <Screen>
      <Text tone="muted">{t("Tudo aparece na central do app. Escolha o que também chega como notificação no seu aparelho.")}</Text>
      <NotificationSettings memberships={me?.memberships ?? []} />
    </Screen>
  );
}

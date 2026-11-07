/** C1 · Notificações (D-045): push per kind on the person's devices + "Pausar todas as notificações". The settings live in components/account. */
import { NotificationSettings } from "@/components/account/NotificationSettings";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { Screen } from "@/ui";

export default function NotificationSettingsScreen() {
  const { me } = useClub();
  return (
    <Screen>
      <NotificationSettings memberships={me?.memberships ?? []} />
    </Screen>
  );
}

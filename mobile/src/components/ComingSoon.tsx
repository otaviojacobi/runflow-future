/**
 * The body of a screen whose content comes in a later step (docs/build-plan.md Phase 3): says what will be there and,
 * when the app knows the web app's address, opens the same screen on the web meanwhile.
 */
import { t } from "@/i18n";
import { hasWeb, openOnWeb } from "@/lib/web";
import { Button, Card, EmptyState, type Icon } from "@/ui";
import { ExternalLink } from "@/ui/icons";

export function ComingSoon({ icon, title, children, web }: { icon: Icon; title: string; children: string; web?: string }) {
  return (
    <Card>
      <EmptyState icon={icon} title={title}
        action={web && hasWeb ? <Button variant="secondary" icon={ExternalLink} onPress={() => openOnWeb(web)}>{t("Abrir na web")}</Button> : undefined}>
        {children}
      </EmptyState>
    </Card>
  );
}

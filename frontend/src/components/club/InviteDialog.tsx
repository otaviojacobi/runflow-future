import { useInvites } from "@/api/clubs";
import type { Club } from "@/api/types";
import { t } from "@/i18n";
import { Dialog } from "@/ui";
import { InviteShare } from "./InviteShare";

/** "Convidar alunos" dialog: the club's student link with copy / WhatsApp / QR. */
export function InviteDialog({ club, open, onOpenChange }: { club: Club; open: boolean; onOpenChange: (v: boolean) => void }) {
  const invites = useInvites(open ? club.id : undefined);
  const link = invites.data?.find((i) => i.role === "student" && (!i.max_uses || i.uses < i.max_uses));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Convidar alunos")} description={t("Mande o link no WhatsApp ou mostre o QR code no treino.")}>
      {link ? <InviteShare url={link.url} clubName={club.name} /> : invites.isPending ? <div className="h-28 animate-pulse rounded-md bg-soft" /> : <p className="text-fg-muted">{t("Nenhum link ativo. Crie um em Membros e convites.")}</p>}
    </Dialog>
  );
}

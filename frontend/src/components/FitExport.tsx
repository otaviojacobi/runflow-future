/** Download a workout as a .FIT file, with instructions for Garmin watches (until the Garmin sync is available). */
import { Download, Watch } from "lucide-react";
import { useState } from "react";
import type { Sport } from "@/api/types";
import { stepText, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { downloadFit, encodeFitWorkout } from "@/lib/fit";
import { Button, type ButtonSize, type ButtonVariant, Dialog } from "@/ui";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "treino";

export function FitButton({ name, sport, structure, size = "md", variant = "secondary", label }: { name: string; sport: Sport; structure: Structure; size?: ButtonSize; variant?: ButtonVariant; label?: string }) {
  const [open, setOpen] = useState(false);
  const empty = structure.blocks.length === 0;
  const go = () => { downloadFit(slug(name), encodeFitWorkout(name || t("Treino"), sport, structure, (s) => stepText(s, sport))); setOpen(false); };
  return (
    <>
      <Button size={size} variant={variant} icon={<Watch />} disabled={empty} onClick={() => setOpen(true)}>{label ?? t("Levar para o relógio")}</Button>
      <Dialog open={open} onOpenChange={setOpen} size="sm" title={t("Treino no relógio")} description={name}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("Cancelar")}</Button><Button icon={<Download />} onClick={go}>{t("Baixar arquivo .FIT")}</Button></>}>
        <ol className="grid list-decimal gap-2 pl-5 text-[15px]">
          <li>{t("Baixe o arquivo .FIT do treino.")}</li>
          <li>{t("Conecte o relógio Garmin ao computador pelo cabo USB.")}</li>
          <li>{t("Copie o arquivo para a pasta GARMIN/NewFiles do relógio.")}</li>
          <li>{t("Desconecte: o treino aparece em Treinos no relógio.")}</li>
        </ol>
        <p className="mt-3 text-sm text-fg-muted">{t("Em breve: envio direto pelo app, sem cabo.")}</p>
      </Dialog>
    </>
  );
}

import qrcode from "qrcode-generator";
import { Check, Copy, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "@/i18n";
import { Button, buttonClass, cn } from "@/ui";

/** QR as an SVG path; always dark-on-light (forced light mode) so phones can scan it. */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  return (
    <div data-theme="light" className="inline-block rounded-lg bg-surface p-3 ring-1 ring-line">
      <svg width={size} height={size} viewBox={`-1 -1 ${n + 2} ${n + 2}`} role="img" aria-label={t("QR code do convite")} shapeRendering="crispEdges">
        <path d={d} className="fill-fg" />
      </svg>
    </div>
  );
}

export function whatsappLink(clubName: string, url: string, role: "student" | "trainer" = "student") {
  const text = role === "trainer"
    ? t("Oi! Entre na equipe de treinadores do {club} no Runflow: {url}", { club: clubName, url })
    : t("Oi! Agora os treinos do {club} são pelo Runflow. Entre pelo link: {url}", { club: clubName, url });
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function InviteShare({ url, clubName, role = "student", showQr = true }: { url: string; clubName: string; role?: "student" | "trainer"; showQr?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked: the link stays selectable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className={cn("grid gap-4", showQr && "sm:grid-cols-[1fr_auto] sm:items-start")}>
      <div className="grid gap-3">
        <div className="flex items-center gap-2 rounded-md border border-line bg-sunken py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-sm" title={url}>{url.replace(/^https:\/\//, "")}</span>
          <Button size="sm" variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? t("Copiado") : t("Copiar")}</Button>
        </div>
        <a href={whatsappLink(clubName, url, role)} target="_blank" rel="noreferrer" className={buttonClass("primary", "lg", { block: true })}>
          <MessageCircle className="size-5" />{t("Enviar no WhatsApp")}
        </a>
      </div>
      {showQr && <div className="grid justify-items-center gap-1"><QrCode value={url} size={132} /><span className="text-xs text-fg-muted">{t("Aponte a câmera")}</span></div>}
    </div>
  );
}

/** QR code (SVG, crisp at any size); light background in both themes so phones can scan it. Used for class check-in. */
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { t } from "@/i18n";

export function QrCode({ value, size = 160, label }: { value: string; size?: number; label?: string }) {
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
      <svg width={size} height={size} viewBox={`-1 -1 ${n + 2} ${n + 2}`} role="img" aria-label={label ?? t("QR code")} shapeRendering="crispEdges">
        <path d={d} className="fill-fg" />
      </svg>
    </div>
  );
}

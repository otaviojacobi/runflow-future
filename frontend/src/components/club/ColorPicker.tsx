import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/ui";

export const PRIMARY_PRESETS = ["#D62828", "#E85D04", "#FFC300", "#2D6A4F", "#0096C7", "#1D3557", "#4B4FE8", "#7B2CBF", "#E91E63", "#111111"];
export const SECONDARY_PRESETS = ["#FFB703", "#CFF846", "#48CAE4", "#F77F00", "#FFFFFF", "#111111"];
const HEX = /^#?[0-9a-f]{6}$/i;
const norm = (v: string) => ("#" + v.trim().replace("#", "")).toUpperCase();

/** Swatch presets + native picker + hex field. `value = null` means "none" (default / automatic). */
export function ColorPicker({ label, value, onChange, presets, noneLabel, disabled }: { label: string; value: string | null; onChange: (v: string | null) => void; presets: string[]; noneLabel: string; disabled?: boolean }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <fieldset disabled={disabled} className="grid gap-2.5 disabled:opacity-50">
      <legend className="mb-2 rf-text-label-sm">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onChange(null)} aria-pressed={value === null}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold", value === null ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
          {value === null ? <Check className="size-4" /> : <X className="size-4" />}{noneLabel}
        </button>
        {presets.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={value === c} title={c}
            className={cn("grid size-9 place-items-center rounded-full ring-1 ring-inset ring-line-strong transition-transform hover:scale-105", value === c && "ring-2 ring-offset-2 ring-offset-surface ring-[var(--rf-fg-default)]")}
            style={{ background: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={t("{label}: escolher no seletor", { label })} value={(value ?? "#4B4FE8").toLowerCase()} onChange={(e) => onChange(norm(e.target.value))}
          className="h-10 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1" />
        <input aria-label={t("{label} em hexadecimal", { label })} value={text} placeholder={noneLabel} spellCheck={false} maxLength={7}
          onChange={(e) => { setText(e.target.value); if (HEX.test(e.target.value.trim())) onChange(norm(e.target.value)); }}
          className="h-10 w-32 rounded-md border border-line-strong bg-surface px-3 font-mono text-sm uppercase text-fg focus:border-brand-ring focus:outline-none focus:ring-3 focus:ring-brand-ring/25" />
      </div>
    </fieldset>
  );
}

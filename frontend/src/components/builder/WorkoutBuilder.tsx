/** W5 core: quick text ⇄ structured editor ⇄ live summary. Controlled; reused by the library screen and the planning dialog. */
import { CircleAlert, CircleCheck, Lightbulb, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Sport } from "@/api/types";
import { SPORTS, SPORT_ICON, SPORT_LABEL } from "@/components/sport";
import { IntensityProfile, zoneBg } from "@/components/workout";
import { parseQuickText, toQuickText } from "@/domain/quicktext";
import { extractTags } from "@/domain/tags";
import { estimate, segments, type Structure, type ZoneN } from "@/domain/workout";
import { t } from "@/i18n";
import { distance, duration } from "@/lib/format";
import { Card, cn } from "@/ui";
import { BlockEditor } from "./BlockEditor";

const EXAMPLES: Record<Sport, string[]> = {
  run: ["10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq", "15' Z2 + 3x(2km Z4 + 3' Z1) + 10' Z1", "40' leve", "1h20 Z2 (longão, hidratação a cada 5 km)"],
  swim: ["400 livre aquec + 8x50 educativo + 10x100 crawl @1:45 palmar + 200 costas desaq", "300 aquec + 4x200 crawl @3:30 pull + 200 escolha"],
  bike: ["15' Z2 + 4x8' Z4 c/ 4' Z1 + 10' Z1", "2h Z2"],
  strength: ["Agachamento 4x8 70% desc 90\"\nSupino 4x10 20kg desc 60\"\nPrancha 3x45s pc desc 30\""],
  mobility: ["20' mobilidade (quadril, tornozelo e torácica)"],
  other: ["45' livre"],
};

export function WorkoutSummary({ structure, sport, className }: { structure: Structure; sport: Sport; className?: string }) {
  const est = estimate(structure, sport);
  const zones = useMemo(() => {
    const acc: Record<ZoneN, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const s of segments(structure, sport)) acc[s.zone] += s.seconds;
    const total = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
    return ([1, 2, 3, 4, 5] as ZoneN[]).map((z) => ({ z, pct: Math.round((acc[z] / total) * 100), s: acc[z] }));
  }, [structure, sport]);
  return (
    <Card className={cn("grid gap-4 p-4", className)}>
      <IntensityProfile structure={structure} sport={sport} height={72} />
      <div className="grid grid-cols-2 gap-3">
        <div><div className="rf-text-caption text-fg-muted">{t("Duração estimada")}</div><div className="font-display text-[22px] font-bold tabular-nums [font-stretch:110%]">{est.duration_s ? duration(est.duration_s) : "–"}</div></div>
        <div><div className="rf-text-caption text-fg-muted">{t("Distância estimada")}</div><div className="font-display text-[22px] font-bold tabular-nums [font-stretch:110%]">{est.distance_m ? distance(est.distance_m, { swim: sport === "swim" }) : "–"}</div></div>
      </div>
      {sport !== "strength" && sport !== "mobility" && est.duration_s > 0 && (
        <div className="grid gap-1.5">
          <div className="rf-text-caption text-fg-muted">{t("Tempo por zona")}</div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-soft">{zones.map((x) => x.pct > 0 && <span key={x.z} className={zoneBg[x.z]} style={{ width: `${x.pct}%` }} />)}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">{zones.filter((x) => x.s > 0).map((x) => <span key={x.z} className="inline-flex items-center gap-1"><i className={cn("size-2 rounded-[2px]", zoneBg[x.z])} />Z{x.z} {duration(x.s)}</span>)}</div>
        </div>
      )}
    </Card>
  );
}

export function SportPicker({ value, onChange, allowed }: { value: Sport; onChange: (s: Sport) => void; allowed?: Sport[] }) {
  const list = SPORTS.filter((s) => !allowed || allowed.includes(s) || s === value);
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Modalidade")}>
      {list.map((s) => {
        const I = SPORT_ICON[s];
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors", value === s ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
            <I className="size-4" />{t(SPORT_LABEL[s])}
          </button>
        );
      })}
    </div>
  );
}

/** `onTags`: "#hashtags" typed in the quick text (only where the workout has tags, i.e. the library). */
export function WorkoutBuilder({ sport, structure, onChange, onTags, compact }: { sport: Sport; structure: Structure; onChange: (s: Structure) => void; onTags?: (tags: string[]) => void; compact?: boolean }) {
  const [text, setText] = useState(() => toQuickText(structure, sport));
  const [warnings, setWarnings] = useState<string[]>([]);
  const fromText = useRef(false);
  // Editor (or sport) changes rewrite the text; text changes don't loop back.
  useEffect(() => {
    if (fromText.current) { fromText.current = false; return; }
    setText(toQuickText(structure, sport));
    setWarnings([]);
  }, [structure, sport]);
  const onText = (v: string) => {
    setText(v);
    const r = parseQuickText(v, sport);
    setWarnings(r.warnings);
    fromText.current = true;
    onChange(r.structure);
    // Only finished hashtags (followed by a space); the one still being typed is taken on blur.
    if (onTags) { const done = extractTags(v.replace(/#[^\s#]*$/, "")).tags; if (done.length) onTags(done); }
  };

  return (
    <div className={cn("grid gap-5", !compact && "lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start")}>
      <div className="grid min-w-0 gap-5">
        <Card className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="quicktext" className="flex items-center gap-2 font-semibold"><Wand2 className="size-[18px] text-accent-text" />{t("Escrita rápida")}</label>
            <span className="text-xs text-fg-muted">{t("Escreva como no WhatsApp. O editor abaixo acompanha.")}</span>
          </div>
          <textarea id="quicktext" value={text} onChange={(e) => onText(e.target.value)} onBlur={() => { const x = extractTags(text).tags; if (onTags && x.length) onTags(x); }} rows={sport === "strength" ? 5 : 3} spellCheck={false}
            placeholder={EXAMPLES[sport][0]}
            className="min-h-20 w-full resize-y rounded-md border border-line-strong bg-sunken px-3 py-2.5 font-mono text-[15px] leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-ring focus:bg-surface focus:outline-none focus:ring-3 focus:ring-brand-ring/25" />
          {warnings.length > 0 ? (
            <p className="flex items-start gap-2 rf-text-body-sm text-warning-text"><CircleAlert className="mt-0.5 size-4 shrink-0" />{t("Não entendi: {x}. O resto foi aplicado.", { x: warnings.map((w) => `“${w}”`).join(", ") })}</p>
          ) : text.trim() ? (
            <p className="flex items-center gap-2 rf-text-body-sm text-success-text"><CircleCheck className="size-4" />{t("Tudo entendido.")}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Lightbulb className="size-4 text-fg-subtle" />
            {EXAMPLES[sport].map((ex) => (
              <button key={ex} type="button" onClick={() => onText(ex)} className="max-w-full truncate rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs text-fg-muted hover:bg-soft hover:text-fg">{ex.split("\n")[0]}</button>
            ))}
          </div>
        </Card>
        <section className="grid gap-2">
          <h2 className="rf-text-title-sm">{sport === "strength" ? t("Exercícios") : t("Etapas")}</h2>
          <BlockEditor blocks={structure.blocks} sport={sport} onChange={(blocks) => onChange({ v: 1, blocks })} />
        </section>
      </div>
      {!compact && <div className="lg:sticky lg:top-6"><WorkoutSummary structure={structure} sport={sport} /></div>}
    </div>
  );
}

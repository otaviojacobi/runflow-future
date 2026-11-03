/** Structured editor for a workout: steps, repeats (séries) and exercises. Controlled: blocks + onChange. */
import { useId } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Repeat as RepeatIcon, Trash2 } from "lucide-react";
import type { Sport } from "@/api/types";
import { EQUIPMENT_LABEL, INTENT_LABEL, STROKE_LABEL, type Block, type Duration, type Equipment, type Exercise, type Intent, type Load, type Repeat, type Step, type Stroke, type Target, type ZoneN } from "@/domain/workout";
import { useExercises } from "@/api/exercises";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { pace as fmtPace } from "@/lib/format";
import { IconButton, cn } from "@/ui";
import { zoneBg } from "@/components/workout";
import { zoneOf } from "@/domain/workout";

// ---------------------------------------------------------------- value <-> input helpers
const clockIn = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
/** "10" → 600 · "10:30" → 630 · "1:05:00" → 3900 */
export const parseClock = (v: string): number | null => {
  const p = v.trim().split(":").map((x) => Number(x.replace(",", ".")));
  if (!p.length || p.some((x) => isNaN(x))) return null;
  if (p.length === 1) return Math.round(p[0]! * 60);
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return p[0]! * 3600 + p[1]! * 60 + p[2]!;
};
const paceIn = (s: number) => fmtPace(s);
const parsePace = (v: string) => { const m = v.trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

const field = "h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg focus:border-brand-ring focus:outline-none focus:ring-3 focus:ring-brand-ring/25";
const sel = cn(field, "pr-6");

export const newStep = (sport: Sport, intent: Intent = "active"): Step =>
  sport === "swim"
    ? { kind: "step", intent, duration: { type: "distance", m: 100 }, target: { type: "open" }, stroke: "free" }
    : { kind: "step", intent, duration: intent === "active" ? { type: "distance", m: 1000 } : { type: "time", s: intent === "recovery" ? 120 : 600 }, target: intent === "active" ? { type: "zone", metric: "pace", zone: 3 } : { type: "zone", metric: "pace", zone: intent === "recovery" || intent === "cooldown" ? 1 : 2 } };
export const newRepeat = (sport: Sport): Repeat => ({ kind: "repeat", count: 4, steps: [newStep(sport, "active"), newStep(sport, "recovery")] });
/** "15 a 20 vezes": the upper count stays while it's above the lower one. */
const withCount = (r: Repeat, count: number, max?: number): Repeat => {
  const { max_count: _drop, ...rest } = r;
  void _drop;
  return max !== undefined && max > count ? { ...rest, count, max_count: max } : { ...rest, count };
};
export const newExercise = (): Exercise => ({ kind: "exercise", name: "", sets: 3, reps: "10", load: { type: "bodyweight" }, rest_s: 60 });

// ---------------------------------------------------------------- step row
/** A range ("30–40 min", "60–80 m": the athlete picks) keeps its upper end while it stays above the lower one. */
const timeWithMax = (s: number, max?: number): Duration => (max !== undefined && max > s ? { type: "time", s, max_s: max } : { type: "time", s });
const distanceWithMax = (m: number, max?: number): Duration => (max !== undefined && max > m ? { type: "distance", m, max_m: max } : { type: "distance", m });
function DurationInput({ d, sport, onChange }: { d: Duration; sport: Sport; onChange: (d: Duration) => void }) {
  const km = sport !== "swim";
  const kmIn = (m: number) => (km ? String(m / 1000).replace(".", ",") : String(m));
  const kmOut = (v: string) => { const x = Number(v.replace(",", ".")); return x > 0 ? Math.round(km ? x * 1000 : x) : null; };
  return (
    <div className="flex items-center gap-1.5">
      <select aria-label={t("Tipo de duração")} className={sel} value={d.type} onChange={(e) => onChange(e.target.value === "time" ? { type: "time", s: 600 } : e.target.value === "distance" ? { type: "distance", m: km ? 1000 : 100 } : { type: "open" })}>
        <option value="time">{t("Tempo")}</option><option value="distance">{t("Distância")}</option><option value="open">{t("Até a volta")}</option>
      </select>
      {d.type === "time" && (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <input aria-label={t("Tempo (min ou mm:ss)")} className={cn(field, "w-20 tabular-nums")} defaultValue={clockIn(d.s)} key={d.s} onBlur={(e) => { const s = parseClock(e.target.value); if (s && s > 0) onChange(timeWithMax(s, d.max_s)); else e.target.value = clockIn(d.s); }} />
          {d.max_s !== undefined && <>–<input aria-label={t("Tempo máximo (min ou mm:ss)")} className={cn(field, "w-20 tabular-nums")} defaultValue={clockIn(d.max_s)} key={"max" + d.max_s} onBlur={(e) => { const v = e.target.value.trim() ? parseClock(e.target.value) : null; onChange(timeWithMax(d.s, v ?? undefined)); }} /></>}
        </span>
      )}
      {d.type === "distance" && (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <input aria-label={km ? t("Distância em km") : t("Distância em metros")} inputMode="decimal" className={cn(field, "w-20 tabular-nums")} defaultValue={kmIn(d.m)} key={d.m}
            onBlur={(e) => { const m = kmOut(e.target.value); if (m) onChange(distanceWithMax(m, d.max_m)); else e.target.value = kmIn(d.m); }} />
          {d.max_m !== undefined && <>–<input aria-label={km ? t("Distância máxima em km") : t("Distância máxima em metros")} inputMode="decimal" className={cn(field, "w-20 tabular-nums")} defaultValue={kmIn(d.max_m)} key={"max" + d.max_m}
            onBlur={(e) => onChange(distanceWithMax(d.m, kmOut(e.target.value) ?? undefined))} /></>}
          <span>{km ? "km" : "m"}</span>
        </span>
      )}
    </div>
  );
}
function TargetInput({ tg, sport, onChange }: { tg: Target; sport: Sport; onChange: (t: Target) => void }) {
  const unit = sport === "swim" ? "/100 m" : "/km";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label={t("Alvo")} className={sel} value={tg.type} onChange={(e) => {
        const v = e.target.value;
        onChange(v === "zone" ? { type: "zone", metric: "pace", zone: 2 } : v === "pace" ? (sport === "swim" ? { type: "pace", min_s: 100, max_s: 110 } : { type: "pace", min_s: 300, max_s: 310 }) : v === "hr" ? { type: "hr", min: 140, max: 155 } : v === "rpe" ? { type: "rpe", value: 6 } : { type: "open" });
      }}>
        <option value="open">{t("Livre")}</option><option value="zone">{t("Zona")}</option><option value="pace">{t("Pace")}</option><option value="hr">{t("FC")}</option><option value="rpe">{t("PSE")}</option>
      </select>
      {tg.type === "zone" && (
        <div className="flex gap-1" role="radiogroup" aria-label={t("Zona")}>
          {([1, 2, 3, 4, 5] as ZoneN[]).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={tg.zone === z} onClick={() => onChange({ ...tg, zone: z })}
              className={cn("h-9 w-9 rounded-md text-xs font-bold transition-colors", tg.zone === z ? cn(zoneBg[z], "ring-2 ring-fg ring-offset-1 ring-offset-surface") : "bg-soft text-fg-muted hover:bg-line")}
              style={tg.zone === z ? { color: `var(--rf-zone-${z}-on-solid)` } : undefined}>Z{z}</button>
          ))}
        </div>
      )}
      {tg.type === "pace" && (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <input aria-label={t("Pace mais rápido")} className={cn(field, "w-16 tabular-nums")} defaultValue={paceIn(tg.min_s)} key={"a" + tg.min_s} onBlur={(e) => { const v = parsePace(e.target.value); if (v) onChange({ ...tg, min_s: Math.min(v, tg.max_s) }); else e.target.value = paceIn(tg.min_s); }} />–
          <input aria-label={t("Pace mais lento")} className={cn(field, "w-16 tabular-nums")} defaultValue={paceIn(tg.max_s)} key={"b" + tg.max_s} onBlur={(e) => { const v = parsePace(e.target.value); if (v) onChange({ ...tg, max_s: Math.max(v, tg.min_s) }); else e.target.value = paceIn(tg.max_s); }} />{unit}
        </span>
      )}
      {tg.type === "hr" && (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <input aria-label={t("FC mínima")} type="number" className={cn(field, "w-16")} value={tg.min} onChange={(e) => onChange({ ...tg, min: Number(e.target.value) })} />–
          <input aria-label={t("FC máxima")} type="number" className={cn(field, "w-16")} value={tg.max} onChange={(e) => onChange({ ...tg, max: Number(e.target.value) })} />bpm
        </span>
      )}
      {/* A new number drops the coach's word ("forte" is PSE 8 only). */}
      {tg.type === "rpe" && <select aria-label={t("PSE")} className={sel} value={tg.value} onChange={(e) => onChange({ type: "rpe", value: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>}
      {tg.type === "rpe" && tg.label && <span className="text-xs text-fg-muted">{tg.label}</span>}
    </div>
  );
}

function StepRow({ step, sport, onChange, actions, nested }: { step: Step; sport: Sport; onChange: (s: Step) => void; actions: React.ReactNode; nested?: boolean }) {
  const z = zoneOf(step, sport);
  return (
    <div className={cn("group relative grid gap-2 rounded-md border border-line bg-surface p-2.5 pl-4", nested && "bg-canvas")}>
      <span aria-hidden className={cn("absolute inset-y-2 left-1.5 w-1 rounded-full", zoneBg[z])} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label={t("Tipo de etapa")} className={cn(sel, "font-semibold")} value={step.intent} onChange={(e) => onChange({ ...step, intent: e.target.value as Intent })}>
          {(Object.keys(INTENT_LABEL) as Intent[]).map((i) => <option key={i} value={i}>{t(INTENT_LABEL[i])}</option>)}
        </select>
        <DurationInput d={step.duration} sport={sport} onChange={(duration) => onChange({ ...step, duration })} />
        {sport !== "swim" && <TargetInput tg={step.target} sport={sport} onChange={(target) => onChange({ ...step, target })} />}
        <div className="ml-auto flex items-center opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div>
      </div>
      {sport === "swim" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label={t("Estilo")} className={sel} value={step.stroke ?? ""} onChange={(e) => onChange({ ...step, stroke: (e.target.value || undefined) as Stroke | undefined })}>
            <option value="">{t("Estilo")}</option>{(Object.keys(STROKE_LABEL) as Stroke[]).map((s) => <option key={s} value={s}>{t(STROKE_LABEL[s])}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-fg-muted">{t("Saída")}<input aria-label={t("Saída (mm:ss)")} placeholder="1:45" className={cn(field, "w-16 tabular-nums")} defaultValue={step.send_off_s ? clockIn(step.send_off_s) : ""} key={step.send_off_s ?? 0} onBlur={(e) => { const v = e.target.value.trim() ? parseClock(e.target.value) : null; onChange({ ...step, send_off_s: v ?? undefined }); }} /></label>
          {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((eq) => {
            const on = step.equipment?.includes(eq);
            return <button key={eq} type="button" aria-pressed={on} onClick={() => onChange({ ...step, equipment: on ? step.equipment!.filter((x) => x !== eq) : [...(step.equipment ?? []), eq] })}
              className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line text-fg-muted hover:bg-soft")}>{t(EQUIPMENT_LABEL[eq])}</button>;
          })}
          <TargetInput tg={step.target} sport={sport} onChange={(target) => onChange({ ...step, target })} />
        </div>
      )}
      <input aria-label={t("Observação")} placeholder={t("Observação (opcional)")} className="h-8 rounded-md bg-transparent px-1 text-sm text-fg placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-ring/25" value={step.note ?? ""} onChange={(e) => onChange({ ...step, note: e.target.value || undefined })} />
    </div>
  );
}

function ExerciseRow({ ex, onChange, actions }: { ex: Exercise; onChange: (e: Exercise) => void; actions: React.ReactNode }) {
  const load = ex.load ?? { type: "bodyweight" };
  const { club } = useClub();
  const lib = useExercises(club?.id);
  const listId = useId();
  // Picking a library name links the block to it (video and cues for the student).
  const rename = (name: string) => { const hit = lib.data?.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()); const { exercise_id: _drop, ...rest } = ex; void _drop; onChange(hit ? { ...rest, name, exercise_id: hit.id } : { ...rest, name }); };
  return (
    <div className="group grid gap-2 rounded-md border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <input aria-label={t("Exercício")} placeholder={t("Exercício, ex.: Agachamento")} className={cn(field, "min-w-48 flex-1 font-semibold")} value={ex.name} list={listId} onChange={(e) => rename(e.target.value)} />
        <datalist id={listId}>{(lib.data ?? []).map((x) => <option key={x.id} value={x.name} />)}</datalist>
        <label className="flex items-center gap-1 text-xs text-fg-muted"><input aria-label={t("Séries")} type="number" min={1} className={cn(field, "w-14")} value={ex.sets} onChange={(e) => onChange({ ...ex, sets: Math.max(1, Number(e.target.value)) })} />×</label>
        <input aria-label={t("Repetições")} className={cn(field, "w-16")} value={ex.reps} onChange={(e) => onChange({ ...ex, reps: e.target.value })} />
        <select aria-label={t("Carga")} className={sel} value={load.type} onChange={(e) => onChange({ ...ex, load: { type: e.target.value as Load["type"], value: e.target.value === "bodyweight" ? undefined : load.value ?? 10 } })}>
          <option value="bodyweight">{t("Peso corporal")}</option><option value="kg">kg</option><option value="pct_1rm">% 1RM</option><option value="rpe">{t("PSE")}</option>
        </select>
        {load.type !== "bodyweight" && <input aria-label={t("Valor da carga")} type="number" className={cn(field, "w-16")} value={load.value ?? ""} onChange={(e) => onChange({ ...ex, load: { ...load, value: Number(e.target.value) } })} />}
        <label className="flex items-center gap-1 text-xs text-fg-muted">{t("desc.")}<input aria-label={t("Descanso em segundos")} type="number" step={15} className={cn(field, "w-16")} value={ex.rest_s ?? 0} onChange={(e) => onChange({ ...ex, rest_s: Number(e.target.value) })} />s</label>
        <div className="ml-auto flex items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div>
      </div>
      <input aria-label={t("Observação")} placeholder={t("Observação (opcional)")} className="h-8 rounded-md bg-transparent px-1 text-sm placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-ring/25" value={ex.note ?? ""} onChange={(e) => onChange({ ...ex, note: e.target.value || undefined })} />
    </div>
  );
}

// ---------------------------------------------------------------- list
function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
function RowActions({ onUp, onDown, onDup, onDel, label }: { onUp?: () => void; onDown?: () => void; onDup: () => void; onDel: () => void; label: string }) {
  return (
    <>
      <IconButton size="sm" label={t("Subir {x}", { x: label })} onClick={onUp} disabled={!onUp}><ArrowUp /></IconButton>
      <IconButton size="sm" label={t("Descer {x}", { x: label })} onClick={onDown} disabled={!onDown}><ArrowDown /></IconButton>
      <IconButton size="sm" label={t("Duplicar {x}", { x: label })} onClick={onDup}><Copy /></IconButton>
      <IconButton size="sm" label={t("Remover {x}", { x: label })} onClick={onDel}><Trash2 /></IconButton>
    </>
  );
}

export function BlockEditor({ blocks, sport, onChange }: { blocks: Block[]; sport: Sport; onChange: (b: Block[]) => void }) {
  const set = (i: number, b: Block) => onChange(blocks.map((x, k) => (k === i ? b : x)));
  const actions = (i: number, label: string) => (
    <RowActions label={label} onUp={i > 0 ? () => onChange(move(blocks, i, -1)) : undefined} onDown={i < blocks.length - 1 ? () => onChange(move(blocks, i, 1)) : undefined}
      onDup={() => onChange([...blocks.slice(0, i + 1), structuredClone(blocks[i]!), ...blocks.slice(i + 1)])} onDel={() => onChange(blocks.filter((_, k) => k !== i))} />
  );
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) => {
        if (b.kind === "exercise") return <ExerciseRow key={i} ex={b} onChange={(e) => set(i, e)} actions={actions(i, t("exercício"))} />;
        if (b.kind === "step") return <StepRow key={i} step={b} sport={sport} onChange={(s) => set(i, s)} actions={actions(i, t("etapa"))} />;
        const r = b;
        const setStep = (j: number, s: Step) => set(i, { ...r, steps: r.steps.map((x, k) => (k === j ? s : x)) });
        return (
          <div key={i} className="grid gap-2 rounded-lg border-2 border-dashed border-line-strong p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <RepeatIcon className="size-4 text-fg-muted" />
              <span className="text-sm font-semibold">{t("Série: repetir")}</span>
              <input aria-label={t("Repetições da série")} type="number" min={1} max={99} className={cn(field, "w-16 text-center font-bold")} value={r.count} onChange={(e) => set(i, withCount(r, Math.max(1, Math.min(99, Number(e.target.value))), r.max_count))} />
              {r.max_count !== undefined && <><span className="text-sm text-fg-muted">{t("a")}</span><input aria-label={t("Máximo de repetições da série")} type="number" min={1} max={200} className={cn(field, "w-16 text-center font-bold")} value={r.max_count} onChange={(e) => set(i, withCount(r, r.count, Math.min(200, Number(e.target.value))))} /></>}
              <span className="text-sm text-fg-muted">{t("vezes")}</span>
              <input aria-label={t("Nome da série")} placeholder={t("Nome (opcional)")} className={cn(field, "w-40 min-w-0")} value={r.note ?? ""} onChange={(e) => set(i, { ...r, note: e.target.value || undefined })} />
              <div className="ml-auto flex items-center">{actions(i, t("série"))}</div>
            </div>
            {r.steps.map((s, j) => (
              <StepRow key={j} nested step={s} sport={sport} onChange={(x) => setStep(j, x)}
                actions={<RowActions label={t("etapa")} onUp={j > 0 ? () => set(i, { ...r, steps: move(r.steps, j, -1) }) : undefined} onDown={j < r.steps.length - 1 ? () => set(i, { ...r, steps: move(r.steps, j, 1) }) : undefined}
                  onDup={() => set(i, { ...r, steps: [...r.steps.slice(0, j + 1), structuredClone(s), ...r.steps.slice(j + 1)] })} onDel={() => r.steps.length > 1 ? set(i, { ...r, steps: r.steps.filter((_, k) => k !== j) }) : onChange(blocks.filter((_, k) => k !== i))} />} />
            ))}
            <button type="button" onClick={() => set(i, { ...r, steps: [...r.steps, newStep(sport, "recovery")] })} className="flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-brand-text hover:bg-brand-soft"><Plus className="size-4" />{t("Etapa na série")}</button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 pt-1">
        {sport === "strength" ? (
          <button type="button" onClick={() => onChange([...blocks, newExercise()])} className="flex h-9 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 text-sm font-semibold text-fg-muted hover:bg-soft hover:text-fg"><Plus className="size-4" />{t("Exercício")}</button>
        ) : (
          <>
            <button type="button" onClick={() => onChange([...blocks, newStep(sport, blocks.length ? "active" : "warmup")])} className="flex h-9 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 text-sm font-semibold text-fg-muted hover:bg-soft hover:text-fg"><Plus className="size-4" />{t("Etapa")}</button>
            <button type="button" onClick={() => onChange([...blocks, newRepeat(sport)])} className="flex h-9 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 text-sm font-semibold text-fg-muted hover:bg-soft hover:text-fg"><RepeatIcon className="size-4" />{t("Série")}</button>
          </>
        )}
      </div>
    </div>
  );
}

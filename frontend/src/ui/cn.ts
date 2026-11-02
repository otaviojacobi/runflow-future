/**
 * Join class names, skipping falsy values. When two utilities set the same thing (same variant prefix and
 * group, e.g. `w-full` then `w-24`, `bg-surface` then `bg-brand-soft`), the later one wins, so a component's
 * `className` can override its base classes. A small subset of tailwind-merge, sized for this app's utilities.
 */
const SIZES = /^(xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*(px|rem|em)\])$/;
const ALIGN = /^(left|center|right|justify|start|end)$/;
const BG_NOT_COLOR = /^(none|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|repeat.*|no-repeat|clip-.*|origin-.*|linear.*|radial.*|conic.*|gradient.*|blend-.*|\[url.*)$/;
const BORDER_NOT_COLOR = /^(\d+|[trblxyse]|[trblxyse]-\d+|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*)$/;
const DISPLAY = new Set(["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents", "table", "flow-root"]);
const WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;

/** Conflict group of a utility without its variants, or null when it never conflicts. */
export function groupOf(u: string): string | null {
  const neg = u.startsWith("-") ? u.slice(1) : u;
  if (DISPLAY.has(neg)) return "display";
  if (WEIGHT.test(neg)) return "font-weight";
  let m = /^(w|h|min-w|min-h|max-w|max-h|size|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap-x|gap-y|gap|top|right|bottom|left|inset-x|inset-y|inset|z|opacity|shadow)-/.exec(neg);
  if (m) return m[1]!;
  m = /^rounded(-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(-|$)/.exec(neg);
  if (m) return "rounded" + (m[1] ?? "");
  if (neg.startsWith("bg-")) return BG_NOT_COLOR.test(neg.slice(3)) ? null : "bg-color";
  if (neg.startsWith("text-")) { const v = neg.slice(5); return SIZES.test(v) ? "text-size" : ALIGN.test(v) ? "text-align" : "text-color"; }
  if (neg.startsWith("border-")) { const v = neg.slice(7); if (BORDER_NOT_COLOR.test(v)) return null; const side = /^([trblxyse])-/.exec(v); return side ? `border-${side[1]}-color` : "border-color"; }
  return null;
}

/** Split "sm:hover:w-24" into ["sm:hover:", "w-24"], ignoring colons inside brackets. */
function split(c: string): [string, string] {
  let depth = 0, cut = 0;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) cut = i + 1;
  }
  return [c.slice(0, cut), c.slice(cut).replace(/^!/, "")];
}

export const cn = (...c: (string | false | null | undefined)[]) => {
  const list = c.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const [variants, util] = split(list[i]!);
    const g = groupOf(util);
    if (g) { const key = variants + g; if (seen.has(key)) continue; seen.add(key); }
    out.push(list[i]!);
  }
  return out.reverse().join(" ");
};

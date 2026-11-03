/**
 * Typed-text helpers for fields that are date or time pickers on the web: the phone's number pad plus a mask is the
 * fastest way to enter a birth date or a race time (no 30-year scroll, no ":" key needed).
 */

const digits = (s: string) => s.replace(/\D/g, "");

/** "14091988" → "14/09/1988" as the person types. */
export function maskDate(text: string): string {
  const d = digits(text).slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join("/");
}
/** "1988-09-14" → "14/09/1988". */
export const isoToBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
/** "14/09/1988" → "1988-09-14"; null when it isn't a real calendar date. */
export function brToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && Number(yyyy) >= 1900 ? iso : null;
}

/** Digits → "52:30" or "1:45:10" as the person types (up to h:mm:ss). */
export function maskClock(text: string): string {
  const d = digits(text).replace(/^0+(?=\d{3})/, "").slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, -2)}:${d.slice(-2)}`;
  return `${d.slice(0, -4)}:${d.slice(-4, -2)}:${d.slice(-2)}`;
}
/** "52:30" or "1:52:30" → seconds (minutes and seconds under 60); null otherwise. */
export function parseClock(s: string): number | null {
  const p = s.trim().split(":");
  if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d+$/.test(x))) return null;
  const n = p.map(Number);
  if (n.slice(1).some((x) => x >= 60)) return null;
  const total = p.length === 3 ? n[0]! * 3600 + n[1]! * 60 + n[2]! : n[0]! * 60 + n[1]!;
  return total > 0 ? total : null;
}

/** Whole number in [min, max] from a text field, or null when empty; NaN when out of range or not a number. */
export function intIn(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

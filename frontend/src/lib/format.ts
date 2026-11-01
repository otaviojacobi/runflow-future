/** pt-BR formatting for training data. Club-local dates are "YYYY-MM-DD" strings (no timezone math). */
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nfKm = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pad = (n: number) => String(n).padStart(2, "0");

/** 270 → "4:30" (seconds per km or per 100 m). */
export function pace(s: number | null | undefined): string {
  if (s == null || !isFinite(s) || s <= 0) return "–";
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${pad(r % 60)}`;
}
/** 6128 → "1:42:08"; 545 → "9:05". */
export function clock(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "–";
  const r = Math.round(s), h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), sec = r % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
/** 3540 → "59 min"; 5100 → "1h25"; 7200 → "2h". */
export function duration(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "–";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
/** 10400 → "10,4 km"; 400 → "400 m"; swim distances stay in meters. */
export function distance(m: number | null | undefined, opts: { swim?: boolean } = {}): string {
  if (m == null || !isFinite(m)) return "–";
  if (opts.swim || m < 1000) return `${nf0.format(m)} m`;
  return `${nfKm.format(m / 1000)} km`;
}
export function km(m: number | null | undefined): string {
  return m == null ? "–" : nf1.format(m / 1000);
}
export const number = (n: number, digits = 0) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(n);
/** 2000 → "R$ 20,00". */
export const money = (cents: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);

// ---------- dates (club-local "YYYY-MM-DD")
const asUtc = (d: string) => new Date(d + "T12:00:00Z");
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...opts });
const clean = (s: string) => s.replace(/\./g, "");
const parts = (d: string) => {
  const p = Object.fromEntries(fmt({ weekday: "short", day: "numeric", month: "short" }).formatToParts(asUtc(d)).map((x) => [x.type, clean(x.value)]));
  return { wd: p.weekday ?? "", day: p.day ?? "", mon: p.month ?? "" };
};
/** "2026-11-03" → "ter, 3 nov" (Runflow style: no "de", no dots). */
export const shortDate = (d: string) => { const p = parts(d); return `${p.wd}, ${p.day} ${p.mon}`; };
/** "2026-11-03" → "terça-feira, 3 de novembro". */
export const longDate = (d: string) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(asUtc(d));
/** "2026-11-03" → "3 nov". */
export const dayMonth = (d: string) => { const p = parts(d); return `${p.day} ${p.mon}`; };
/** "2026-11-03" → "ter". */
export const weekdayShort = (d: string) => clean(fmt({ weekday: "short" }).format(asUtc(d)));
/** ISO timestamp → "06:30" in the club timezone. */
export const timeOf = (iso: string, tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** ISO timestamp → club-local "YYYY-MM-DD". */
export const localDate = (iso: string, tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
/** Today, club-local. */
export const today = (tz = "America/Sao_Paulo") => localDate(new Date().toISOString(), tz);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const isoWeekday = (d: string) => ((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
export const mondayOf = (d: string) => addDays(d, 1 - isoWeekday(d));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
/** "há 5 min", "há 2 h", "ontem", "há 3 dias", or the short date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return shortDate(localDate(iso));
}
export const initials = (name: string) => name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

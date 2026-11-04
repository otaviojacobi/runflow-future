/**
 * Runtime checks for the JavaScript engine the app runs on (Hermes on phones, a browser in the web preview): the pt-BR
 * formats, plurals, the free-text grammar, tags and query strings must give the same answers everywhere. The dev route
 * /dev/hermes runs them on the phone and logs `RF_DIAG {...}`; `node scripts/diagnostics.mjs` prints the reference
 * from Node. Relative imports only, so Node can load this file as is.
 */
import { t, tn } from "../i18n";
import { parseQuickText, toQuickText } from "../domain/quicktext";
import { extractTags, normalizeTag } from "../domain/tags";
import {
  clock, dayMonth, distance, duration, fullDate, initials, km, localDate, longDate, money, monthTitle, number, pace, parseMoney,
  shortDate, timeOf, upperFirst, weekdayLong, weekdayShort,
} from "./format";
import { qs, queryOf } from "./query";

type Result = Record<string, unknown>;
const safe = (fn: () => unknown): unknown => { try { return fn(); } catch (e) { return `THROWS ${(e as Error)?.message ?? String(e)}`; } };

export function runDiagnostics(): Result {
  const d = "2026-11-03";
  const texts: [string, "run" | "swim" | "strength"][] = [
    ["10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq #tiro", "run"],
    ["400 aquec + 8x50 crawl @1:00 c/ palmar + 200 solto", "swim"],
    ['Agachamento 4x8-10 60kg desc 90"', "strength"],
  ];
  return {
    dates: safe(() => ({
      shortDate: shortDate(d), fullDate: fullDate(d), longDate: longDate(d), dayMonth: dayMonth(d), weekdayShort: weekdayShort(d),
      weekdayLong: weekdayLong(d), monthTitle: monthTitle(d), timeOf: timeOf("2026-11-03T09:20:00Z"), localDate: localDate("2026-11-04T01:00:00Z"),
    })),
    numbers: safe(() => ({
      pace: pace(272), clock: clock(3725), duration: duration(3725), distance: distance(9500), swim: distance(1500, { swim: true }),
      km: km(12100), number: number(1234.5, 1), money: money(1990), parseMoney: parseMoney("19,90"),
    })),
    plurals: safe(() => [0, 1, 1.5, 2].map((n) => tn(n, "{n} treino", "{n} treinos"))),
    text: safe(() => ({ t: t("Olá, {name}", { name: "Ana" }), upper: upperFirst("terça"), initials: initials("Ana Souza-Lima"), lower: "AÇÃO".toLocaleLowerCase("pt-BR") })),
    tags: safe(() => ({ one: normalizeTag("#Pista Rápida!"), extract: extractTags("6x1km #tiro #Pista") })),
    grammar: safe(() => texts.map(([s, sport]) => { const r = parseQuickText(s, sport); return { name: r.name, warnings: r.warnings, tags: r.tags, back: toQuickText(r.structure, sport), structure: r.structure }; })),
    query: safe(() => ({ qs: qs({ limit: 500, q: "ana souza", role: undefined }), of: queryOf("runflow://x/connect/strava?code=a%2Bb&state=s1&scope=read,activity:read_all") })),
    engine: safe(() => ({
      textEncoder: typeof TextEncoder === "function" ? new TextEncoder().encode("ação").length : "missing",
      sort: ["Érica", "ana", "Bruno"].sort((a, b) => a.localeCompare(b, "pt-BR")),
      lookbehind: safe(() => "a1".replace(/(?<=a)1/, "X")),
      unicodeProps: safe(() => "Ana-Ç9".replace(/[^\p{L}]/gu, "")),
      normalize: safe(() => "ação".normalize("NFD").replace(/[̀-ͯ]/g, "")),
    })),
  };
}

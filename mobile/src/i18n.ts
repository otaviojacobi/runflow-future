/**
 * i18n (same contract as the web app): every visible string goes through t() with the pt-BR text as the key (D-013).
 * pt-BR needs no catalog; other locales add a catalog keyed by the pt-BR source string.
 *   t("Olá, {name}", { name })   ·   tn(n, "{n} aluno", "{n} alunos")
 */
type Vars = Record<string, string | number>;
const catalogs: Record<string, Record<string, string>> = {};
let locale = "pt-BR";
/**
 * pt-BR plural rule (CLDR "pt": one when the integer part is 0 or 1, so "1 treino", "0 treino", "1,5 km"): written
 * out because Hermes, the app's JS engine, has no Intl.PluralRules (the web's i18n.ts uses it; same results).
 */
const plural = { select: (n: number) => (Math.floor(Math.abs(n)) <= 1 ? "one" : "other") };

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : s);

export function t(source: string, vars?: Vars): string {
  return fill(catalogs[locale]?.[source] ?? source, vars);
}
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  return t(plural.select(n) === "one" ? one : other, { n, ...vars });
}
export function setLocale(l: string, catalog?: Record<string, string>) {
  locale = l;
  if (catalog) catalogs[l] = catalog;
}

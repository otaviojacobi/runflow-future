/** Query strings without URLSearchParams, which React Native implements only partly (no `get`/`set`, a string ignored). */

/**
 * "?a=1&b=x" from the params that have a value (the web's `qs`). React Native's URLSearchParams is partial (no `get`/
 * `set`, ignores a string), so the app never uses it.
 */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}
/** The query of a URL as a plain object ("…?code=x&state=y" → {code: "x", state: "y"}). */
export function queryOf(url: string): Record<string, string> {
  const i = url.indexOf("?");
  if (i < 0) return {};
  const out: Record<string, string> = {};
  for (const part of url.slice(i + 1).split("#")[0]!.split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    const dec = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, " ")); } catch { return x; } };
    out[dec(k!)] = dec(v);
  }
  return out;
}

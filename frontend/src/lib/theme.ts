import Color from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { storage } from "./storage";

/**
 * Club theme on the web (§7.8). The server-stored CSS block (clubThemeCss output) is injected into
 * <style id="club-theme"> and cached, so index.html can apply it before first paint on the next load.
 */
const THEME = "rf.theme";
const MODE = "rf.mode";
export type ColorMode = "light" | "dark" | "system";

/**
 * Public pages are always Runflow's (founder, 2026-11-02): marketing, sign-in, invites, the club picker, club
 * creation and dev pages never wear a club's colors. The club theme applies only inside the signed-in app.
 * Keep this pattern in sync with the inline script in index.html (first paint).
 */
export const RUNFLOW_BRANDED = /^\/(?:$|login\/?$|invite\/|dev\/|clubs(?:\/new)?\/?$|app\/?$)/;
export const isRunflowBranded = (path: string) => RUNFLOW_BRANDED.test(path);
let forceRunflow = 0;
/** Turn the cached club stylesheet on or off for this path (it stays in the DOM, so switching is instant). */
export function syncClubTheme(path = location.pathname) {
  const el = document.getElementById("club-theme") as HTMLStyleElement | null;
  if (el) el.media = forceRunflow > 0 || isRunflowBranded(path) ? "not all" : "all";
}
/** Screens outside the route list that must look like Runflow (404) call this while mounted. */
export function holdRunflowBrand() { forceRunflow++; syncClubTheme(); return () => { forceRunflow--; syncClubTheme(); }; }

export function applyClubTheme(css: string | null) {
  let el = document.getElementById("club-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "club-theme";
    document.head.appendChild(el);
  }
  if (el.textContent !== (css ?? "")) el.textContent = css ?? "";
  promoteClubTheme();
  syncClubTheme();
  storage.set(THEME, css);
}
/** Keep <style id="club-theme"> as the LAST stylesheet so it overrides the token defaults (same specificity). */
export function promoteClubTheme() {
  const el = document.getElementById("club-theme");
  if (el && el !== document.head.lastElementChild) document.head.appendChild(el);
}
export function getColorMode(): ColorMode {
  const m = storage.get(MODE);
  return m === "light" || m === "dark" ? m : "system";
}
export function setColorMode(mode: ColorMode) {
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  storage.set(MODE, mode === "system" ? null : mode);
}

/** Paper is white: print (and "Salvar como PDF") always uses the light theme, then restores the user's mode. */
export function installPrintTheme() {
  let saved: string | null = null;
  window.addEventListener("beforeprint", () => { saved = document.documentElement.getAttribute("data-theme"); document.documentElement.setAttribute("data-theme", "light"); });
  window.addEventListener("afterprint", () => { if (saved) document.documentElement.setAttribute("data-theme", saved); else document.documentElement.removeAttribute("data-theme"); });
}

/** Inline CSS variables that theme one subtree with a club's colors (marketing demos, previews). */
export function themeVars(input: { primary?: string | null; secondary?: string | null }, mode: "light" | "dark" = "light"): Record<string, string> {
  const r = Color.resolveClubColors(input, { brand: tokens.seeds.brand, accent: tokens.seeds.accent });
  const out: Record<string, string> = {};
  const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  for (const [name, seed] of [["brand", r.primary], ["accent", r.secondary]] as const) {
    const roles = Color.roles(seed, mode, tokens.env[mode]);
    for (const k of ["solid", "solidHover", "solidActive", "onSolid", "solidBorder", "text", "subtle", "subtleHover", "subtleFg", "border", "ring"] as const) out[`--rf-${name}-${kebab(k)}`] = roles[k];
  }
  return out;
}

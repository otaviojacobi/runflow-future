import { storage } from "./storage";

/**
 * Club theme on the web (§7.8). The server-stored CSS block (clubThemeCss output) is injected into
 * <style id="club-theme"> and cached, so index.html can apply it before first paint on the next load.
 */
const THEME = "rf.theme";
const MODE = "rf.mode";
export type ColorMode = "light" | "dark" | "system";

export function applyClubTheme(css: string | null) {
  let el = document.getElementById("club-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "club-theme";
    document.head.appendChild(el);
  }
  if (el.textContent !== (css ?? "")) el.textContent = css ?? "";
  storage.set(THEME, css);
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

/** PWA (F30): service worker registration, install prompt, online status. */
import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setupPwa() {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; emit(); });
  window.addEventListener("appinstalled", () => { deferred = null; emit(); });
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
  // Production only: in dev the SW would cache Vite's modules and hide changes.
  if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  window.addEventListener("vite:preloadError", reloadIntoNewVersion);
}

/** After a deploy, a tab opened earlier asks for route bundles that no longer exist: reload once into the new app. */
const RELOADED_AT = "rf-reloaded-at";
function reloadIntoNewVersion(event: Event) {
  try {
    // The fresh page failed too: let the route's error screen show instead of reloading in a loop.
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 10_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return; // no storage, no loop guard: don't reload
  }
  event.preventDefault();
  window.location.reload();
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
/** "prompt" (Chrome/Android/desktop), "ios" (manual: Compartilhar → Tela de Início), or null (installed / unsupported). */
export function useInstall(): "prompt" | "ios" | null {
  return useSyncExternalStore(subscribe, () => (isStandalone() ? null : deferred ? "prompt" : isIos() ? "ios" : null));
}
export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; emit();
  return outcome === "accepted";
}
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
/** Drop cached personal data (shared devices). */
export const clearOfflineData = () => { navigator.serviceWorker?.controller?.postMessage("clear-api-cache"); if ("caches" in window) caches.delete("rf-api-v1").catch(() => undefined); };

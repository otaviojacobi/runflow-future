/** Push on this device (S7b): the installed web app's Web Push subscription, registered with the API. The service
 * worker (public/sw.js) shows what arrives. iPhones only get web push from the app added to the Home Screen. */
import { api } from "./api";
import { isIos, isStandalone } from "./pwa";

/** unsupported: this browser can't · install: iPhone, add to the Home Screen first · unavailable: push is off on
 * this server or no service worker (dev) · denied: blocked in the browser · off / on: this device. */
export type DevicePush = "unsupported" | "install" | "unavailable" | "denied" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const bytes = (b64url: string) => {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  if (!supported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function subscription() {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

export async function devicePushState(publicKey: string | null | undefined): Promise<DevicePush> {
  if (!supported()) return isIos() && !isStandalone() ? "install" : "unsupported";
  if (!publicKey || !(await registration())) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  const sub = await subscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

const register = (sub: PushSubscription) =>
  api.post("/me/push-tokens", { platform: "web", token: sub.endpoint, keys: sub.toJSON().keys });

/** Ask for permission, subscribe with the server's key and register this device. */
export async function enableDevicePush(publicKey: string): Promise<DevicePush> {
  const reg = await registration();
  if (!reg) return "unavailable";
  if ((await Notification.requestPermission()) !== "granted") return Notification.permission === "denied" ? "denied" : "off";
  const key = bytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key (rotated keys) can't be reused.
  const same = (k: ArrayBuffer | null | undefined) => !!k && new Uint8Array(k).every((b, i) => b === key[i]) && k.byteLength === key.length;
  if (sub && !same(sub.options.applicationServerKey)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await register(sub);
  return "on";
}

/** Stop pushes to this device (also on sign-out, so the next person on it starts clean). */
export async function disableDevicePush(): Promise<void> {
  const sub = await subscription().catch(() => null);
  if (!sub) return;
  await api.del("/me/push-tokens", { token: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => false);
}

/** Keep the server's copy fresh while the device is on (endpoints can change). */
export async function refreshDevicePush(): Promise<void> {
  const sub = await subscription().catch(() => null);
  if (sub && Notification.permission === "granted") await register(sub).catch(() => undefined);
}

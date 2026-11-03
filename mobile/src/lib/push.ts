/**
 * Push on this phone (X10, D-045; how it reaches the phone: docs/ops/push-notifications.md). The app asks for
 * permission only when the person turns it on (Perfil → Notificações), gets an Expo push token and registers it
 * (`POST /me/push-tokens`); every launch re-registers silently while permission lasts, unless the person turned it off
 * here. Signing out forgets the device first. Remote push needs a development or store build: Expo Go can't receive it
 * (SDK 53+), so there the card says so.
 */
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { storage } from "./storage";

export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

const KEY = "rf.push";
interface Saved { token: string | null; off: boolean }
const read = (): Saved => { try { return { token: null, off: false, ...(JSON.parse(storage.get(KEY) ?? "{}") as Partial<Saved>) }; } catch { return { token: null, off: false }; } };
const write = (s: Saved) => storage.set(KEY, JSON.stringify(s));

/** A real device in a build that can receive remote push (not Expo Go, not a simulator). */
const capable = () => Device.isDevice && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
/** The Expo project (EAS); without it there's no push token (docs/ops/push-notifications.md § 0). */
const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Banners while the app is open too (the bell's count updates as well); no sound. */
export function configurePush() {
  if (!capable()) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
}

export async function pushState(): Promise<PushState> {
  if (!capable()) return "unsupported";
  if (!projectId()) return "unconfigured";
  const p = await Notifications.getPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? "off" : "denied";
  const s = read();
  return s.token && !s.off ? "on" : "off";
}

async function register(): Promise<string> {
  // Android 13+: the permission prompt only appears once a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Runflow", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  await api.post("/me/push-tokens", { platform: Platform.OS === "ios" ? "ios" : "android", token });
  write({ token, off: false });
  return token;
}

/** "Ativar": asks for permission when needed, then registers this phone. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "unconfigured" || state === "denied") return state;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Runflow", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const p = await Notifications.getPermissionsAsync();
  const granted = p.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return (await Notifications.getPermissionsAsync()).canAskAgain ? "off" : "denied";
  await register();
  return "on";
}

/** "Desativar": the server forgets this phone; it stays off here until turned on again. */
export async function disablePush(): Promise<PushState> {
  const s = read();
  if (s.token) await api.del("/me/push-tokens", { token: s.token });
  write({ token: null, off: true });
  return "off";
}

/** On launch and after signing in: keep the registration fresh (tokens change; another person may have used the phone). */
export async function refreshPush() {
  try {
    if (!capable() || !projectId() || read().off) return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await register();
  } catch {
    // Offline or the push service is down: the next launch tries again.
  }
}

/** Before signing out: this phone stops getting the person's pushes (a few seconds at most, then sign out anyway). */
export async function forgetPushDevice() {
  const s = read();
  write({ token: null, off: s.off });
  if (!s.token) return;
  await Promise.race([api.del("/me/push-tokens", { token: s.token }).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
}

/** The app icon's number = unread notifications (iOS; Android launchers decide on their own). */
export function setBadge(n: number) {
  if (capable()) void Notifications.setBadgeCountAsync(n).catch(() => undefined);
}

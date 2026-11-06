/**
 * Offline (root.md §2, §7.5, §7.7): today's and this week's workouts work without a connection.
 *
 * The student's queries (calendar, summary, workout details, threads; src/api/my.ts) save their last answer in the
 * synchronous store and their hooks start from it, like `/me` does: the first frame after a cold start already shows
 * the week, then it revalidates. Only the weeks around this one are kept. The saved data belongs to the person signed
 * in: signing out, an expired session or another person signing in wipes it (it is health data, LGPD).
 *
 * The connection state is the OS's (expo-network) plus whether the API answers (lib/reachability); see "connection"
 * below: being back refetches what is on screen.
 */
import type { QueryKey } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { queryClient } from "@/queryClient";
import { api, ApiError } from "./api";
import { reachability } from "./reachability";
import { addDays, mondayOf, today } from "./format";
import { session } from "./session";
import { storage } from "./storage";

const KEY = "rf.offline";
const MAX_ENTRIES = 80;
interface Entry { data: unknown; at: number; day: string | null }
interface Saved { user: string; entries: Record<string, Entry> }

function read(): Saved | null {
  try {
    const s = JSON.parse(storage.get(KEY) ?? "null") as Saved | null;
    return s && typeof s.user === "string" && s.entries && s.user === session.me()?.user.id ? s : null;
  } catch {
    return null;
  }
}
let saved = read();
if (!saved) storage.set(KEY, null);

let timer: ReturnType<typeof setTimeout> | null = null;
const write = () => { timer = null; storage.set(KEY, saved ? JSON.stringify(saved) : null); };

/** Last week through next week (club days are close enough to São Paulo's for keeping or dropping a week). */
function inWindow(day: string) {
  const monday = mondayOf(today());
  return day >= addDays(monday, -7) && day <= addDays(monday, 13);
}
function prune(s: Saved) {
  const list = Object.entries(s.entries).filter(([, e]) => e.day === null || inWindow(e.day));
  list.sort((a, b) => b[1].at - a[1].at);
  s.entries = Object.fromEntries(list.slice(0, MAX_ENTRIES));
}

export const offline = {
  get<T>(key: QueryKey): { data: T; at: number } | undefined {
    const e = saved?.entries[JSON.stringify(key)];
    return e ? { data: e.data as T, at: e.at } : undefined;
  },
  /** Every saved answer whose key starts with `prefix`. */
  list<T>(prefix: QueryKey): { key: QueryKey; data: T; at: number }[] {
    const head = JSON.stringify(prefix).slice(0, -1);
    return Object.entries(saved?.entries ?? {}).filter(([k]) => k === head + "]" || k.startsWith(head + ",")).map(([k, e]) => ({ key: JSON.parse(k) as QueryKey, data: e.data as T, at: e.at }));
  },
  /** Saves an answer for the person signed in; `day` = the date it is about (null: undated, like the summary). */
  put(key: QueryKey, data: unknown, day: string | null) {
    const user = session.me()?.user.id;
    if (!user || (day !== null && !inWindow(day))) return;
    if (!saved || saved.user !== user) saved = { user, entries: {} };
    saved.entries[JSON.stringify(key)] = { data, at: Date.now(), day };
    prune(saved);
    // One write for a burst of answers (the week's workouts load together).
    timer ??= setTimeout(write, 400);
  },
  /** Forget everything saved on this device (sign out). */
  clear() {
    saved = null;
    if (timer) clearTimeout(timer);
    timer = null;
    storage.set(KEY, null);
  },
};
// Signed out (the cached `/me` is dropped) or someone else signed in: their data never shows to the next person.
session.subscribe(() => { if (saved && saved.user !== session.me()?.user.id) offline.clear(); });

/** useQuery options that start from the saved answer, dated so it revalidates right away. */
export function savedData<T>(key: QueryKey) {
  return { initialData: () => offline.get<T>(key)?.data, initialDataUpdatedAt: () => offline.get(key)?.at };
}

// ---------- connection
// Two signals make "online": the OS's network state (expo-network) and whether the API answers (lib/reachability:
// any HTTP answer = reachable, a request that got none = unreachable). A single failed request (a resume before the
// network is ready, a server restart) must not leave the app saying "Sem internet" while the OS stays connected, so
// while the API is unreachable and the OS connected, /health is probed with backoff; the first answer refetches what
// is on screen. Coming back to the foreground probes at once. TanStack Query's own reconnect refetch follows the OS
// state (queryClient.ts).
let osOnline = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const PROBE_DELAYS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;
function stopProbe() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  probeAttempt = 0;
}
function scheduleProbe(now = false) {
  if (probeTimer || reachability.get() || !osOnline) return;
  const delay = now ? 0 : PROBE_DELAYS[Math.min(probeAttempt, PROBE_DELAYS.length - 1)];
  probeTimer = setTimeout(() => {
    probeTimer = null;
    probeAttempt++;
    // An answer marks the API reachable (lib/api.ts); none leaves it unreachable and probes again, later each time.
    api.get("/health").catch(() => undefined).finally(() => scheduleProbe());
  }, delay);
}

reachability.subscribe(() => {
  notify();
  if (!reachability.get()) { scheduleProbe(); return; }
  stopProbe();
  // Back: whatever on screen failed or went stale meanwhile asks again.
  void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" || q.isStale() });
});

function setOsOnline(v: boolean) {
  if (v === osOnline) return;
  osOnline = v;
  notify();
  if (v && !reachability.get()) { stopProbe(); scheduleProbe(true); }
}
Network.getNetworkStateAsync().then((s) => setOsOnline(s.isConnected !== false)).catch(() => undefined);
Network.addNetworkStateListener((s) => setOsOnline(s.isConnected !== false));
AppState.addEventListener("change", (s) => { if (s === "active" && !reachability.get()) { stopProbe(); scheduleProbe(true); } });

/**
 * Pull to refresh checks the connection at once (founder, 2026-11-06: "Sem internet" stayed on after the network was
 * back, waiting for the next probe or a missed network event). Reads the OS's state afresh and asks /health now,
 * outside the backoff. Any HTTP answer proves the connection, even if the OS's last event said otherwise, so the
 * banner clears; no answer goes back to probing. Calls while one is running share it.
 */
let rechecking: Promise<void> | null = null;
export function recheckConnection(): Promise<void> {
  rechecking ??= (async () => {
    const s = await Network.getNetworkStateAsync().catch(() => null);
    if (s) setOsOnline(s.isConnected !== false);
    stopProbe();
    const answered = await api.get("/health").then(() => true, (e: unknown) => !isOfflineError(e));
    if (answered) setOsOnline(true);
    else scheduleProbe();
  })().finally(() => { rechecking = null; });
  return rechecking;
}

/** False while the device has no network or the API doesn't answer (the "Sem internet" banner, prefetches). */
export function useOnline() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => osOnline && reachability.get());
}
/** The request never reached the API (no network, server unreachable). */
export const isOfflineError = (err: unknown) => err instanceof ApiError && err.status === 0;

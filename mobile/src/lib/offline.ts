/**
 * Offline (root.md §2, §7.5, §7.7): today's and this week's workouts work without a connection.
 *
 * The student's queries (calendar, summary, workout details, threads; src/api/my.ts) save their last answer in the
 * synchronous store and their hooks start from it, like `/me` does: the first frame after a cold start already shows
 * the week, then it revalidates. Only the weeks around this one are kept. The saved data belongs to the person signed
 * in: signing out, an expired session or another person signing in wipes it (it is health data, LGPD).
 *
 * The connection state comes from expo-network; coming back online refetches what is on screen.
 */
import type { QueryKey } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { queryClient } from "@/queryClient";
import { ApiError } from "./api";
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
let online = true;
const listeners = new Set<() => void>();
function setOnline(v: boolean) {
  if (v === online) return;
  const back = v && !online;
  online = v;
  listeners.forEach((l) => l());
  if (back) void queryClient.refetchQueries({ type: "active", stale: true });
}
// "Connected" is what the OS knows; a request that fails without an answer counts too (isOfflineError).
Network.getNetworkStateAsync().then((s) => setOnline(s.isConnected !== false)).catch(() => undefined);
Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false));

/** False while the device has no network. */
export function useOnline() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => online);
}
/** The request never reached the API (no network, server unreachable). */
export const isOfflineError = (err: unknown) => err instanceof ApiError && err.status === 0;

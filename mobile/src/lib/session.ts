/**
 * Session (root.md §7.3, §7.8). The opaque token lives in the keychain (expo-secure-store, D-022) and goes out as a
 * Bearer token. The last `/me` and the active club id live in the synchronous store, so the first frame already
 * knows the club's colors and the person's role, and the shell opens offline.
 *
 * The state is one immutable snapshot, replaced on every change: `useSession()` returns it from
 * useSyncExternalStore, so components (and the React Compiler's memoization) see every change.
 */
import { useSyncExternalStore } from "react";
import type { Me } from "@/api/types";
import { secure } from "./secure";
import { storage } from "./storage";

const ME = "rf.me";
const CLUB = "rf.club";
const read = <T,>(key: string): T | null => { try { return JSON.parse(storage.get(key) ?? "null") as T | null; } catch { return null; } };

interface State { token: string | null; me: Me | null; clubId: string | null }
let state: State = { token: null, me: read<Me>(ME), clubId: storage.get(CLUB) };
const listeners = new Set<() => void>();
const update = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export const session = {
  /** Reads the token from the keychain, once, behind the splash. Without a token the cached data is dropped. */
  async load() {
    const token = await secure.getToken();
    if (!token) { storage.set(ME, null); storage.set(CLUB, null); update({ token: null, me: null, clubId: null }); }
    else update({ token });
    return token;
  },
  token: () => state.token,
  isSignedIn: () => !!state.token,
  async start(token: string) { await secure.setToken(token); update({ token }); },
  /** Forget everything about the person on this device (sign out, expired session). */
  async clear() {
    storage.set(ME, null); storage.set(CLUB, null);
    update({ token: null, me: null, clubId: null });
    await secure.setToken(null).catch(() => undefined);
  },
  /** The last `/me` this device saw. */
  me: () => state.me,
  setMe(me: Me) { storage.set(ME, JSON.stringify(me)); update({ me }); },
  /** The active club (the web keeps the same in `rf.club`). */
  clubId: () => state.clubId,
  setClubId(clubId: string | null) { storage.set(CLUB, clubId); update({ clubId }); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

const snapshot = () => state;
/** Re-renders on sign-in, sign-out, a new `/me` and club switches. */
export function useSession() {
  const s = useSyncExternalStore(session.subscribe, snapshot);
  return { signedIn: !!s.token, clubId: s.clubId, me: s.me };
}

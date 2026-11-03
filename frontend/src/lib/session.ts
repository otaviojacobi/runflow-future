import { storage } from "./storage";

/** Session. Mock: a Bearer token in localStorage. Real backend (S9): the HttpOnly `rf_session` cookie the API sets carries
 * the session, which scripts can't read; we only remember that we're signed in. This module is the only place to change. */
const KEY = "rf.token";
const COOKIE = "cookie";
const MOCK = import.meta.env.VITE_MOCK !== "false";
const CLUB = "rf.club";
export const session = {
  /** A Bearer token to send, if any (a token stored before S9 keeps working until the next sign-in). */
  token: () => { const v = storage.get(KEY); return v && v !== COOKIE ? v : null; },
  set: (token: string) => storage.set(KEY, MOCK ? token : COOKIE),
  clear: () => storage.set(KEY, null),
  isSignedIn: () => !!storage.get(KEY),
  /** Last active club (id). Mirrors the `rf_club` cookie the real server reads to inline the theme. */
  clubId: () => storage.get(CLUB),
  setClubId: (id: string | null) => {
    storage.set(CLUB, id);
    try { document.cookie = id ? `rf_club=${id}; path=/; max-age=31536000; samesite=lax` : "rf_club=; path=/; max-age=0"; } catch { /* ignore */ }
  },
};

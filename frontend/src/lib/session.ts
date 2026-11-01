import { storage } from "./storage";

/** Session token. Mock/dev: Bearer token in localStorage. Production web: HttpOnly cookie (§7.3); this module is the only place to change. */
const KEY = "rf.token";
const CLUB = "rf.club";
export const session = {
  token: () => storage.get(KEY),
  set: (token: string) => storage.set(KEY, token),
  clear: () => storage.set(KEY, null),
  isSignedIn: () => !!storage.get(KEY),
  /** Last active club (id). Mirrors the `rf_club` cookie the real server reads to inline the theme. */
  clubId: () => storage.get(CLUB),
  setClubId: (id: string | null) => {
    storage.set(CLUB, id);
    try { document.cookie = id ? `rf_club=${id}; path=/; max-age=31536000; samesite=lax` : "rf_club=; path=/; max-age=0"; } catch { /* ignore */ }
  },
};

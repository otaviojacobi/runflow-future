/**
 * Theme context. The active club's colors are cached in a synchronous store and read before the first frame,
 * so the app never flashes Runflow colors for a club user (root.md §7.8). Color mode follows the system unless set.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { storage } from "@/lib/storage";
import { buildTheme, type ClubColors, type Theme } from "./theme";

const CLUB_KEY = "rf.club-colors";
const MODE_KEY = "rf.mode";
export type ModePref = "system" | "light" | "dark";
/** Read synchronously at startup. */
export const readCachedClub = (): (ClubColors & { rev?: number; club_id?: string }) | null => { try { return JSON.parse(storage.get(CLUB_KEY) ?? "null"); } catch { return null; } };

interface Ctx { theme: Theme; setClub: (c: (ClubColors & { rev?: number; club_id?: string }) | null) => void; modePref: ModePref; setModePref: (m: ModePref) => void }
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [club, setClubState] = useState(readCachedClub);
  const [modePref, setModePrefState] = useState<ModePref>(() => (storage.get(MODE_KEY) as ModePref | null) ?? "system");
  const mode = modePref === "system" ? (system === "dark" ? "dark" : "light") : modePref;
  const theme = useMemo(() => buildTheme(mode, club ?? undefined), [mode, club?.primary, club?.secondary]); // eslint-disable-line react-hooks/exhaustive-deps
  const setClub = useCallback((c: (ClubColors & { rev?: number; club_id?: string }) | null) => { storage.set(CLUB_KEY, c ? JSON.stringify(c) : null); setClubState(c); }, []);
  const setModePref = useCallback((m: ModePref) => { storage.set(MODE_KEY, m === "system" ? null : m); setModePrefState(m); }, []);
  const value = useMemo(() => ({ theme, setClub, modePref, setModePref }), [theme, setClub, modePref, setModePref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

/**
 * Theme context. The active club's colors are cached in a synchronous store and read before the first frame,
 * so the app never flashes Runflow colors for a club user (root.md §7.8). Color mode follows the system unless set.
 * `ThemeScope` re-themes a subtree (Runflow-branded public screens, the component preview in light and dark).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { storage } from "@/lib/storage";
import { buildTheme, type ClubColors, type Mode, type Theme } from "./theme";

const CLUB_KEY = "rf.club-colors";
const MODE_KEY = "rf.mode";
export type ModePref = "system" | "light" | "dark";
/** Read synchronously at startup. */
export const readCachedClub = (): (ClubColors & { rev?: number; club_id?: string }) | null => { try { return JSON.parse(storage.get(CLUB_KEY) ?? "null"); } catch { return null; } };

interface Ctx { theme: Theme; club: ClubColors | null; setClub: (c: (ClubColors & { rev?: number; club_id?: string }) | null) => void; modePref: ModePref; setModePref: (m: ModePref) => void }
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [club, setClubState] = useState(readCachedClub);
  const [modePref, setModePrefState] = useState<ModePref>(() => (storage.get(MODE_KEY) as ModePref | null) ?? "system");
  const mode = modePref === "system" ? (system === "dark" ? "dark" : "light") : modePref;
  const theme = useMemo(() => buildTheme(mode, club ?? undefined), [mode, club?.primary, club?.secondary]); // eslint-disable-line react-hooks/exhaustive-deps
  const setClub = useCallback((c: (ClubColors & { rev?: number; club_id?: string }) | null) => { storage.set(CLUB_KEY, c ? JSON.stringify(c) : null); setClubState(c); }, []);
  const setModePref = useCallback((m: ModePref) => { storage.set(MODE_KEY, m === "system" ? null : m); setModePrefState(m); }, []);
  const value = useMemo(() => ({ theme, club, setClub, modePref, setModePref }), [theme, club, setClub, modePref, setModePref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/**
 * Re-themes its children: `club={null}` = Runflow's colors (D-024 public screens), `mode` forces light or dark.
 * Anything left out is inherited from the surrounding theme.
 */
export function ThemeScope({ club, mode, children }: { club?: ClubColors | null; mode?: Mode; children: ReactNode }) {
  const parent = useTheme();
  const m = mode ?? parent.theme.mode;
  const colors = club === undefined ? parent.club : club;
  const theme = useMemo(() => buildTheme(m, colors ?? undefined), [m, colors?.primary, colors?.secondary]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ ...parent, theme, club: colors }), [parent, theme, colors]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

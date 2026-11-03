/**
 * Theme context. The root is Runflow's theme (public screens: sign-in, invite, club picker; D-024). The signed-in
 * app wraps itself in `ThemeScope club={…}` with the active club's colors, which come from the `/me` cached in the
 * synchronous store, so the first frame is already in the club's colors (root.md §7.8). Color mode follows the
 * system unless the person picks one. `ThemeScope` also forces light or dark (the component preview).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { storage } from "@/lib/storage";
import { buildTheme, type ClubColors, type Mode, type Theme } from "./theme";

const MODE_KEY = "rf.mode";
export type ModePref = "system" | "light" | "dark";

interface Ctx { theme: Theme; club: ClubColors | null; modePref: ModePref; setModePref: (m: ModePref) => void }
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [modePref, setModePrefState] = useState<ModePref>(() => (storage.get(MODE_KEY) as ModePref | null) ?? "system");
  const mode = modePref === "system" ? (system === "dark" ? "dark" : "light") : modePref;
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const setModePref = useCallback((m: ModePref) => { storage.set(MODE_KEY, m === "system" ? null : m); setModePrefState(m); }, []);
  const value = useMemo(() => ({ theme, club: null, modePref, setModePref }), [theme, modePref, setModePref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/**
 * Re-themes its children: `club` = a club's colors (`null` = Runflow's), `mode` forces light or dark.
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

/**
 * Runflow theme for React Native, generated from @runflow/design tokens (the same source as the web app).
 * The club's brand/accent roles come from the shared color engine, so contrast guarantees match the web (D-014, D-018).
 */
import Color, { type Roles } from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";

export type Mode = "light" | "dark";
type RoleSet = Omit<Roles, "meta">;
export interface ClubColors { primary: string | null; secondary: string | null }

export function buildTheme(mode: Mode, club: ClubColors = { primary: null, secondary: null }) {
  const s = tokens.semantic[mode];
  const resolved = Color.resolveClubColors(club, { brand: tokens.seeds.brand, accent: tokens.seeds.accent });
  const strip = ({ meta: _meta, ...r }: Roles): RoleSet => r;
  return {
    mode,
    color: {
      canvas: s.bg.canvas, surface: s.bg.surface, raised: s.bg.surfaceRaised, sunken: s.bg.sunken, soft: s.bg.muted, inverse: s.bg.inverse,
      fg: s.fg.default, fgMuted: s.fg.muted, fgSubtle: s.fg.subtle, fgDisabled: s.fg.disabled, fgInverse: s.fg.inverse,
      line: s.border.default, lineSubtle: s.border.subtle, lineStrong: s.border.strong, overlay: s.overlay,
      brand: strip(Color.roles(resolved.primary, mode, tokens.env[mode])),
      accent: strip(Color.roles(resolved.secondary, mode, tokens.env[mode])),
      success: s.success as RoleSet, warning: s.warning as RoleSet, danger: s.danger as RoleSet, info: s.info as RoleSet,
      sport: s.sport, zone: s.zone,
    },
    space: tokens.space, radius: tokens.radius, font: tokens.font, text: tokens.text,
    source: resolved.source,
  };
}
export type Theme = ReturnType<typeof buildTheme>;

type TextName = keyof typeof tokens.text;
/** React Native text style from a token text style (letter spacing is in em in the tokens). */
export function textStyle(name: TextName) {
  const s = tokens.text[name] as { size: number; lineHeight: number; weight: number; letterSpacing?: number };
  return { fontSize: s.size, lineHeight: s.lineHeight, fontWeight: String(s.weight) as "400" | "500" | "600" | "700" | "800", letterSpacing: (s.letterSpacing ?? 0) * s.size };
}

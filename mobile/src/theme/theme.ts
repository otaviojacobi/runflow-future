/**
 * Runflow theme for React Native, generated from @runflow/design tokens (the same source as the web app).
 * The club's brand/accent roles come from the shared color engine, so contrast guarantees match the web (D-014, D-018).
 */
import Color, { type Roles } from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { Easing } from "react-native";

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
      systemBar: s.bg.systemBar,
      fg: s.fg.default, fgMuted: s.fg.muted, fgSubtle: s.fg.subtle, fgDisabled: s.fg.disabled, fgInverse: s.fg.inverse,
      line: s.border.default, lineSubtle: s.border.subtle, lineStrong: s.border.strong, overlay: s.overlay,
      brand: strip(Color.roles(resolved.primary, mode, tokens.env[mode])),
      accent: strip(Color.roles(resolved.secondary, mode, tokens.env[mode])),
      success: s.success as RoleSet, warning: s.warning as RoleSet, danger: s.danger as RoleSet, info: s.info as RoleSet,
      sport: s.sport, zone: s.zone,
    },
    /** CSS box-shadow strings; React Native's `boxShadow` style takes them as they are (new architecture). */
    shadow: s.shadow,
    space: tokens.space, radius: tokens.radius, font: tokens.font, text: tokens.text, size: tokens.size, z: tokens.z,
    motion: { duration: tokens.motion.duration, easing: EASING },
    source: resolved.source,
  };
}
export type Theme = ReturnType<typeof buildTheme>;
export type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";

const bezier = ([a, b, c, d]: readonly number[]) => Easing.bezier(a!, b!, c!, d!);
/** Token easing curves as React Native easing functions (for Animated). */
const EASING = { standard: bezier(tokens.motion.easing.standard), emphasized: bezier(tokens.motion.easing.emphasized), exit: bezier(tokens.motion.easing.exit) };

export type TextName = keyof typeof tokens.text;
type FontWeight = "400" | "500" | "600" | "700" | "800";
/** React Native text style from a token text style (letter spacing is in em in the tokens). */
export function textStyle(name: TextName) {
  const s = tokens.text[name] as { size: number; lineHeight: number; weight: number; letterSpacing?: number; numeric?: string; transform?: string };
  return {
    fontSize: s.size, lineHeight: s.lineHeight, fontWeight: String(s.weight) as FontWeight, letterSpacing: (s.letterSpacing ?? 0) * s.size,
    ...(s.numeric === "tabular" && { fontVariant: ["tabular-nums" as const] }),
    ...(s.transform === "uppercase" && { textTransform: "uppercase" as const }),
  };
}
/** A token font weight as React Native expects it. */
export const weight = (w: keyof typeof tokens.font.weight) => String(tokens.font.weight[w]) as FontWeight;

/** A token color with an alpha (focus rings, glows): `#RRGGBB` + alpha → `#RRGGBBAA`. */
export function alpha(hex: string, a: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}
/** Soft (subtle background + its text) and solid (fill + text on it) colors for a tone. */
export function toneColors(theme: Theme, tone: Tone) {
  const c = theme.color;
  if (tone === "neutral") return { softBg: c.soft, softFg: c.fgMuted, solidBg: c.inverse, solidFg: c.fgInverse, text: c.fgMuted, border: c.line };
  const r = c[tone];
  return { softBg: r.subtle, softFg: r.subtleFg, solidBg: r.solid, solidFg: r.onSolid, text: r.text, border: r.border };
}

/** Types for @runflow/design/color (a UMD/CommonJS file in design/src/color.js). */
declare module "@runflow/design/color" {
  export type Mode = "light" | "dark";
  export interface Env { canvas: string; surface: string; white: string; ink: string }
  export interface ClubColorsInput { primary?: string | null; secondary?: string | null }
  export interface ResolvedClubColors { primary: string; secondary: string; source: "default" | "derived" | "club" }
  export interface Roles {
    solid: string; solidHover: string; solidActive: string; onSolid: string; solidBorder: string;
    text: string; subtle: string; subtleHover: string; subtleFg: string; border: string; ring: string;
    meta: { seed: string; solidAdjusted: boolean; onSolidContrast: number; solidVsCanvas: number; textAdjusted: boolean };
  }
  export function contrast(a: string, b: string): number;
  export function toOklch(hex: string): [number, number, number];
  export function scale(seed: string): Record<string, string> & { anchor: number };
  export function roles(seed: string, mode: Mode, env: Env): Roles;
  export function whiteTextVariant(seed: string, white?: string): string | null;
  export function resolveClubColors(input: ClubColorsInput, defaults: { brand: string; accent: string }): ResolvedClubColors;
  export function clubThemeCss(input: ClubColorsInput, envs: Record<Mode, Env>, defaults: { brand: string; accent: string }): string;
  export function suggestFromPixels(data: Uint8ClampedArray, max?: number): string[];
  const Color: {
    contrast: typeof contrast; toOklch: typeof toOklch; scale: typeof scale; roles: typeof roles; whiteTextVariant: typeof whiteTextVariant;
    resolveClubColors: typeof resolveClubColors; clubThemeCss: typeof clubThemeCss; suggestFromPixels: typeof suggestFromPixels;
  };
  export default Color;
}

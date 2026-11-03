/** Runflow's mark, "Ritmo" (B1): geometry on a 48 × 48 grid and an SVG generator. See logo.js. */
export interface LogoColors { tile?: string; ink: string; accent: string }
export interface LogoSvgOptions { colors: LogoColors; tile?: "rounded" | "square" | "none"; scale?: number; size?: number }
declare const Logo: {
  GRID: 48;
  TILE_RADIUS: number;
  BAR: { width: number; radius: number; baseline: number };
  BARS: { x: number; top: number; accent?: boolean }[];
  svg(o: LogoSvgOptions): string;
};
export default Logo;

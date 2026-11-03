/**
 * Text in a token text style (the web's `rf-text-*` classes). React Native text doesn't inherit color from views,
 * so tinted containers (Card `tone`) pass their text color down through `InheritColor`.
 */
import { createContext, useContext, type ReactNode } from "react";
import { Text as RNText, type TextProps } from "react-native";
import { textStyle, type TextName, type Theme } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";

export type TextTone = "default" | "muted" | "subtle" | "disabled" | "inverse" | "brand" | "accent" | "success" | "warning" | "danger" | "info";
export const textColor = (theme: Theme, tone: TextTone) => {
  const c = theme.color;
  switch (tone) {
    case "default": return c.fg;
    case "muted": return c.fgMuted;
    case "subtle": return c.fgSubtle;
    case "disabled": return c.fgDisabled;
    case "inverse": return c.fgInverse;
    default: return c[tone].text;
  }
};

const Inherited = createContext<string | null>(null);
/** Default text color for the Text inside (tinted cards, banners). */
export function InheritColor({ color, children }: { color: string | null; children: ReactNode }) {
  return <Inherited.Provider value={color}>{children}</Inherited.Provider>;
}

export function Text({ variant = "bodyMd", tone, color, style, ...rest }: TextProps & { variant?: TextName; tone?: TextTone; color?: string }) {
  const { theme } = useTheme();
  const inherited = useContext(Inherited);
  const fg = color ?? (tone ? textColor(theme, tone) : inherited ?? theme.color.fg);
  return <RNText style={[textStyle(variant), { color: fg }, style]} {...rest} />;
}

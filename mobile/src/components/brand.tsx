/** Runflow's mark and wordmark, and club logos: the web's components/brand.tsx for React Native. */
import Color from "@runflow/design/color";
import Logo from "@runflow/design/logo";
import { tokens } from "@runflow/design/tokens";
import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { Branding, Club } from "@/api/types";
import { assetUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";

/** Ritmo (D-038): always Runflow's colors, never a club's (D-018). `mono` draws the bars alone in `color`. */
export function RunflowMark({ size = tokens.space[8], mono, color }: { size?: number; mono?: boolean; color?: string }) {
  const white = tokens.palette.neutral["0"];
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${Logo.GRID} ${Logo.GRID}`} aria-hidden>
      {!mono && <Rect width={Logo.GRID} height={Logo.GRID} rx={Logo.TILE_RADIUS} fill={tokens.seeds.brand} />}
      {Logo.BARS.map((b) => (
        <Rect key={b.x} x={b.x} y={b.top} width={Logo.BAR.width} height={Logo.BAR.baseline - b.top} rx={Logo.BAR.radius}
          fill={mono ? color ?? white : b.accent ? tokens.seeds.accent : white} />
      ))}
    </Svg>
  );
}
/** The mark + "runflow" (the web wordmark's expanded, tight lettering). Its accessible name is "Runflow". */
export function RunflowWordmark({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const size = tokens.text.titleLg.size;
  return (
    <View style={[styles.row, { gap: theme.space[2] }, style]} accessible accessibilityRole="image" accessibilityLabel="Runflow">
      <RunflowMark size={tokens.space[6] + tokens.space[1]} />
      <Text variant="titleLg" style={{ fontWeight: weight("black"), letterSpacing: -0.035 * size, lineHeight: size }}>runflow</Text>
    </View>
  );
}

/** Club logo: the uploaded image, or the initials on the club's own primary color (lists show several clubs). */
export function ClubLogo({ club, branding, size = 36, style }: { club: Pick<Club, "name">; branding?: Pick<Branding, "logo_url"> | Branding | null; size?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const c = theme.color;
  const box = { width: size, height: size, borderRadius: theme.radius.md };
  const uri = assetUrl(branding?.logo_url);
  if (uri) return <Image source={{ uri }} style={[box, styles.logo, { backgroundColor: c.surface, borderColor: c.line, padding: theme.space["0.5"] }, style as never]} contentFit="contain" aria-hidden />;
  const primary = branding && "theme" in branding ? branding.theme?.primary : undefined;
  const bg = primary ?? c.brand.solid;
  const fg = primary ? (Color.contrast(primary, tokens.palette.neutral["0"]) >= 4.5 ? tokens.palette.neutral["0"] : tokens.palette.neutral["950"]) : c.brand.onSolid;
  return (
    <View aria-hidden style={[box, styles.center, { backgroundColor: bg }, style]}>
      <Text variant="labelMd" color={fg} style={{ fontSize: Math.round(size * 0.36), lineHeight: Math.round(size * 0.5), fontWeight: weight("black") }}>{initials(club.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { borderWidth: StyleSheet.hairlineWidth },
});

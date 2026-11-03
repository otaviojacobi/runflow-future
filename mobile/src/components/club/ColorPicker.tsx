/**
 * A club color: "none" (Runflow's default / automatic), preset swatches, or a hex code (the web's
 * components/club/ColorPicker.tsx; the phone has no native color well, so the hex field covers any color).
 * The swatches are the club's candidate colors, so they're drawn in those colors, not in tokens.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Input, Text } from "@/ui";
import { Check, X } from "@/ui/icons";

export const PRIMARY_PRESETS = ["#D62828", "#E85D04", "#FFC300", "#2D6A4F", "#0096C7", "#1D3557", "#4B4FE8", "#7B2CBF", "#E91E63", "#111111"];
export const SECONDARY_PRESETS = ["#FFB703", "#CFF846", "#48CAE4", "#F77F00", "#FFFFFF", "#111111"];
const HEX = /^#?[0-9a-f]{6}$/i;
const norm = (v: string) => ("#" + v.trim().replace("#", "")).toUpperCase();

export function ColorPicker({ label, value, onChange, presets, noneLabel, disabled }: {
  label: string; value: string | null; onChange: (v: string | null) => void; presets: string[]; noneLabel: string; disabled?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const swatch = theme.size.touchMin;
  return (
    <View style={{ gap: theme.space[2], opacity: disabled ? 0.5 : 1 }} accessibilityState={{ disabled }}>
      <Text variant="labelSm" accessibilityRole="header">{label}</Text>
      <View style={[styles.wrap, { gap: theme.space[2] }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Pressable disabled={disabled} onPress={() => onChange(null)} accessibilityRole="radio" accessibilityState={{ checked: value === null, disabled }} accessibilityLabel={noneLabel}
          style={({ pressed }) => [styles.row, {
            height: swatch, gap: theme.space["1.5"], paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, borderWidth: value === null ? 2 : 1,
            borderColor: value === null ? c.brand.ring : c.line, backgroundColor: value === null ? c.brand.subtle : pressed ? c.soft : c.surface,
          }]}>
          {value === null ? <Check size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden /> : <X size={theme.size.iconSm} color={c.fgMuted} aria-hidden />}
          <Text variant="labelSm" color={value === null ? c.brand.subtleFg : c.fgMuted} style={{ fontWeight: weight("semibold") }}>{noneLabel}</Text>
        </Pressable>
        {presets.map((hex) => {
          const on = value === hex;
          return (
            <Pressable key={hex} disabled={disabled} onPress={() => onChange(hex)} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} accessibilityLabel={hex}
              style={{ width: swatch, height: swatch, borderRadius: theme.radius.full, padding: on ? 3 : 0, borderWidth: on ? 2 : 0, borderColor: c.fg }}>
              <View style={[styles.fill, { borderRadius: theme.radius.full, backgroundColor: hex, borderWidth: 1, borderColor: c.lineStrong }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <View aria-hidden style={{ width: swatch, height: swatch, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: value ?? c.sunken }} />
        <Input value={text} editable={!disabled} placeholder={noneLabel} autoCapitalize="characters" autoCorrect={false} maxLength={7}
          accessibilityLabel={t("{label} em hexadecimal", { label })}
          onChangeText={(v) => { setText(v); if (HEX.test(v.trim())) onChange(norm(v)); }}
          style={[styles.hex, { width: theme.space[20] + theme.space[16] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  fill: { flex: 1 },
  hex: { fontVariant: ["tabular-nums"] },
});

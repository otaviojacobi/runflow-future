/**
 * QR code (the web's components/QrCode.tsx): one SVG path, crisp at any size. Always dark modules on a light tile, in
 * both themes, because many scanners can't read an inverted code. Used for the class check-in (staff show it at the
 * venue). qrcode-generator is plain JavaScript, so it runs on Hermes.
 */
import { tokens } from "@runflow/design/tokens";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label?: string }) {
  const { theme } = useTheme();
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label ?? t("QR code")}
      style={{ alignSelf: "center", padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: tokens.env.light.white, borderWidth: 1, borderColor: theme.color.line }}>
      <Svg width={size} height={size} viewBox={`-1 -1 ${n + 2} ${n + 2}`}>
        <Path d={d} fill={tokens.env.light.ink} />
      </Svg>
    </View>
  );
}

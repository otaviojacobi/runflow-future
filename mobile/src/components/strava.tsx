/**
 * Strava's brand, as its guidelines require (docs/strava-brand.md): the official "Connect with Strava" button, the
 * "Powered by Strava" logo where Strava data shows, and "View on Strava" links back to the activity. The artwork in
 * assets/strava is Strava's, unmodified (React Native picks the @2x file on dense screens); only its size and the space
 * around it are ours. Copy of the web's components/strava.tsx in spirit.
 */
import { Image, Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { t } from "@/i18n";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Spinner, Text, toast } from "@/ui";

const CONNECT = require("../../assets/strava/btn_strava_connect_with_orange.png");
const POWERED_BLACK = require("../../assets/strava/api_logo_pwrdBy_strava_horiz_black.png");
const POWERED_WHITE = require("../../assets/strava/api_logo_pwrdBy_strava_horiz_white.png");

/** Strava's page for one of its activities. */
export const stravaActivityUrl = (externalId: string) => `https://www.strava.com/activities/${encodeURIComponent(externalId)}`;

/**
 * The official orange button, 48 pt high (237 × 48). Pressing draws a ring around it; the artwork itself is never
 * dimmed or altered (Strava's rule), so a disabled button is explained by the text next to it.
 */
export function StravaConnectButton({ onPress, loading, disabled, style }: { onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const off = !!loading || !!disabled;
  return (
    <View style={[styles.row, { gap: theme.space[3] }, style]}>
      <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={t("Conectar com Strava")}
        accessibilityState={{ disabled: off, busy: !!loading }}
        style={({ pressed }) => [styles.press, { borderRadius: theme.radius.lg, padding: theme.space["0.5"], borderColor: pressed ? theme.color.brand.ring : "transparent" }]}>
        <Image source={CONNECT} style={styles.connect} accessibilityIgnoresInvertColors />
      </Pressable>
      {loading && <Spinner />}
    </View>
  );
}

/** "Powered by Strava", small and quiet: black artwork on light, white on dark. */
export function PoweredByStrava({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <View style={style} accessible accessibilityRole="image" accessibilityLabel="Powered by Strava">
      <Image source={theme.mode === "dark" ? POWERED_WHITE : POWERED_BLACK} style={styles.powered} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

/** "View on Strava" (Strava's wording, never translated): bold and underlined, opens the activity on Strava. */
export function ViewOnStrava({ externalId }: { externalId: string }) {
  const { theme } = useTheme();
  const open = () => void Linking.openURL(stravaActivityUrl(externalId)).catch(() => toast.info(t("Não deu para abrir o Strava")));
  return (
    <Pressable onPress={open} accessibilityRole="link" hitSlop={theme.space[3]} style={styles.link}>
      <Text variant="bodySm" style={styles.viewOn}>View on Strava</Text>
    </Pressable>
  );
}

/** The footer line under Strava data: the logo and, for one activity, the link back to it. */
export function StravaAttribution({ externalId, style }: { externalId?: string | null; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.between, { gap: theme.space[3] }, style]}>
      <PoweredByStrava />
      {externalId ? <ViewOnStrava externalId={externalId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  press: { alignSelf: "flex-start", borderWidth: 2 },
  connect: { width: 237, height: 48 },
  powered: { width: 158, height: 16 },
  link: { minHeight: 44, justifyContent: "center" },
  viewOn: { fontWeight: weight("bold"), textDecorationLine: "underline" },
});

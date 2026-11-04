/**
 * Android's navigation buttons sit over the app (edge-to-edge). The founder wants them on standard black: this strip
 * paints the bottom inset with `color.systemBar` and the expo-navigation-bar plugin (app.json: enforceContrast off,
 * style dark) makes the buttons white. Mounted once at the root and inside bottom sheets (their own window). iOS keeps
 * the app's colors under the home indicator.
 */
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";

export function SystemBarStrip() {
  const { theme } = useTheme();
  const { bottom } = useSafeAreaInsets();
  if (Platform.OS !== "android" || bottom <= 0) return null;
  return <View pointerEvents="none" style={[styles.strip, { height: bottom, backgroundColor: theme.color.systemBar }]} />;
}

const styles = StyleSheet.create({ strip: { position: "absolute", left: 0, right: 0, bottom: 0 } });

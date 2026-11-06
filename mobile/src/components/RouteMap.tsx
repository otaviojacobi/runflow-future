/**
 * The route on a real map (founder, 2026-11-06; the web's components/activity/RouteMap.tsx): MapLibre over
 * OpenFreeMap (free, no key), in a web view, so it runs in Expo Go and looks like the web. The page loads the same
 * MapLibre version from a CDN (the page's base URL is the CDN, so MapLibre may start its worker from there); the route, the colors (the theme's tokens) and the style come in as data. The card
 * keeps the plain drawing until the map says it's ready, and keeps it if it never does (offline, no WebGL). A still
 * picture: touches go to the screen's scroll, not the map. The credit is MapCredit, under the map.
 */
import { useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { MAP_STYLES, MAPLIBRE_VERSION, routeGeo } from "@/domain/activity";
import { routeMapCdn, routeMapPage } from "@/lib/routeMapPage";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";

export function RouteMap({ points, onReady }: { points: [number, number][]; onReady: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [ready, setReady] = useState(false);
  const html = useMemo(() => {
    const geo = routeGeo(points);
    if (!geo) return null;
    return routeMapPage(MAPLIBRE_VERSION, {
      ...geo, pad: theme.space[6],
      style: theme.mode === "dark" ? MAP_STYLES.dark : MAP_STYLES.light,
      brand: c.brand.text, surface: c.surface, start: c.success.solid, end: c.danger.solid,
    });
  }, [points, theme, c]);
  if (!html) return null;
  const onMessage = (e: WebViewMessageEvent) => {
    if (e.nativeEvent.data === "ready") { setReady(true); onReady(); }
  };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]} accessibilityLabel={t("Mapa do percurso")}>
      <WebView source={{ html, baseUrl: `${routeMapCdn(MAPLIBRE_VERSION)}/` }} originWhitelist={["*"]} onMessage={onMessage}
        scrollEnabled={false} style={styles.clear} containerStyle={styles.clear} />
    </View>
  );
}

/** The map's required credit (OpenFreeMap, OpenMapTiles, OpenStreetMap); "© OpenStreetMap" opens its copyright page. */
export function MapCredit() {
  return (
    <Text variant="caption" tone="subtle">
      {"OpenFreeMap © OpenMapTiles · "}{t("dados")}{" "}
      <Text variant="caption" tone="subtle" accessibilityRole="link" onPress={() => void Linking.openURL("https://www.openstreetmap.org/copyright")} style={styles.link}>© OpenStreetMap</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  clear: { backgroundColor: "transparent" },
  link: { textDecorationLine: "underline" },
});

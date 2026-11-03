/**
 * Toasts, same API as the web kit: toast.success(t("Treino salvo")) · toast.error(err) shows the API's pt-BR
 * title/detail as they come. Render <Toaster /> once, at the root; an open sheet (Dialog) hosts them while it's up,
 * because a React Native Modal covers everything rendered at the root (useToastLayer).
 */
import { tokens } from "@runflow/design/tokens";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { CircleAlert, CircleCheck, Info, X } from "./icons";
import { nativeDriver, useReducedMotion } from "./motion";
import { Text } from "./Text";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; title: string; detail?: string }
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function push(kind: Kind, title: string, detail?: string) {
  const id = ++seq;
  toasts = [...toasts.slice(-1), { id, kind, title, detail }];
  emit();
  // Android announces the live region; iOS needs it spelled out.
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(detail ? `${title}. ${detail}` : title);
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
}
function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}
export const toast = {
  success: (title: string, detail?: string) => push("success", title, detail),
  info: (title: string, detail?: string) => push("info", title, detail),
  error: (err: unknown) => (err instanceof ApiError ? push("error", err.title, err.detail) : push("error", t("Algo deu errado"), t("Tente novamente em instantes."))),
};

function ToastView({ x }: { x: Toast }) {
  const { theme } = useTheme();
  const c = theme.color;
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: reduced ? 0 : theme.motion.duration.base, easing: theme.motion.easing.standard, useNativeDriver: nativeDriver }).start();
  }, [enter, reduced, theme.motion]);
  const I = { success: CircleCheck, error: CircleAlert, info: Info }[x.kind];
  const iconColor = { success: c.success.solid, error: c.danger.solid, info: c.info.solid }[x.kind];
  return (
    <Animated.View
      accessibilityRole={x.kind === "error" ? "alert" : "summary"}
      accessibilityLiveRegion={x.kind === "error" ? "assertive" : "polite"}
      style={[styles.toast, {
        backgroundColor: c.inverse, borderRadius: theme.radius.lg, boxShadow: theme.shadow.lg, gap: theme.space[3], paddingLeft: theme.space[4], paddingVertical: theme.space[2],
        opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-theme.space[4], 0] }) }],
      }]}
    >
      <I size={theme.size.iconMd} color={iconColor} aria-hidden />
      <View style={styles.flex}>
        <Text variant="labelMd" color={c.fgInverse}>{x.title}</Text>
        {x.detail ? <Text variant="bodySm" color={c.fgInverse} style={styles.detail}>{x.detail}</Text> : null}
      </View>
      <InverseClose onPress={() => dismiss(x.id)} />
    </Animated.View>
  );
}
/** The close button sits on the inverse surface, so it takes the inverse text color. */
function InverseClose({ onPress }: { onPress: () => void }) {
  const { theme } = useTheme();
  const side = theme.size.touchMin;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("Fechar")} onPress={onPress}
      style={({ pressed }) => [styles.close, { width: side, height: side, opacity: pressed ? 1 : 0.8 }]}>
      <X size={theme.size.iconSm} color={theme.color.fgInverse} aria-hidden />
    </Pressable>
  );
}

// The open sheets, innermost last: the innermost hosts the toasts (0 = the root's Toaster).
let layers: number[] = [];
let layerSeq = 0;
const layerListeners = new Set<() => void>();
const subscribeLayers = (l: () => void) => (layerListeners.add(l), () => layerListeners.delete(l));
const topLayer = () => layers[layers.length - 1] ?? 0;
/** A sheet that's up hosts the toasts above its dim layer; returns the `layer` for its own <Toaster />. */
export function useToastLayer(active: boolean): number {
  const [id] = useState(() => ++layerSeq);
  useEffect(() => {
    if (!active) return;
    layers = [...layers, id];
    layerListeners.forEach((l) => l());
    return () => { layers = layers.filter((x) => x !== id); layerListeners.forEach((l) => l()); };
  }, [active, id]);
  return id;
}

export function Toaster({ layer = 0 }: { layer?: number }) {
  const list = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => toasts);
  const top = useSyncExternalStore(subscribeLayers, topLayer);
  const insets = useSafeAreaInsets();
  if (!list.length || top !== layer) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + tokens.space[3] }]}>
      {list.map((x) => <ToastView key={x.id} x={x} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: tokens.space[4], right: tokens.space[4], alignItems: "center", gap: tokens.space[2], zIndex: tokens.z.toast },
  toast: { width: "100%", maxWidth: tokens.breakpoint.sm, flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  detail: { opacity: 0.8 },
  close: { alignItems: "center", justifyContent: "center" },
});

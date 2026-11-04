/**
 * Overlays, same names as the web kit (frontend/src/ui/overlay.tsx). On phones the web Dialog is already a bottom
 * sheet; here it always is (root.md §6: dialog on web, bottom sheet on mobile). Menu is an action sheet.
 */
import { tokens } from "@runflow/design/tokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { IconButton } from "./Button";
import { ListItem, Divider } from "./display";
import { SystemBarStrip } from "./SystemBar";
import { KeyboardAvoid, useFocusedInputVisible } from "./keyboard";
import { X, type Icon } from "./icons";
import { nativeDriver, useReducedMotion } from "./motion";
import { Text } from "./Text";
import { Toaster, useToastLayer } from "./toast";

export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string | null; children?: ReactNode; footer?: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.color;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(open);
  const layer = useToastLayer(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const body = useRef<ScrollViewInstance>(null);
  const keepVisible = useFocusedInputVisible(body);
  // With the keyboard up the sheet sits on it: the home-indicator padding would only leave a gap.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const ios = Platform.OS === "ios";
    const a = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const b = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => { a.remove(); b.remove(); };
  }, [visible]);
  useEffect(() => {
    if (open) {
      setVisible(true);
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : theme.motion.duration.base, easing: theme.motion.easing.standard, useNativeDriver: nativeDriver }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: reduced ? 0 : theme.motion.duration.fast, easing: theme.motion.easing.exit, useNativeDriver: nativeDriver }).start(({ finished }) => finished && setVisible(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => onOpenChange(false);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.4, 0] });
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: progress }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <KeyboardAvoid contentStyle={styles.end} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            style={[styles.sheet, {
              backgroundColor: c.raised, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, boxShadow: theme.shadow.lg,
              maxHeight: height * 0.92 - insets.top, paddingBottom: keyboard ? 0 : insets.bottom, opacity: progress, transform: [{ translateY }],
            }]}
          >
            <View style={[styles.head, { gap: theme.space[4], paddingHorizontal: theme.space[5], paddingTop: theme.space[5] }]}>
              <View style={styles.flex}>
                <Text variant="titleLg" accessibilityRole="header">{title}</Text>
                {description ? <Text tone="muted" style={{ marginTop: theme.space[1] }}>{description}</Text> : null}
              </View>
              <IconButton label={t("Fechar")} icon={X} onPress={close} style={{ marginRight: -theme.space[2], marginTop: -theme.space[1] }} />
            </View>
            <ScrollView ref={body} {...keepVisible} style={styles.body} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[4] }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer && <View style={[styles.footer, { gap: theme.space[2], paddingHorizontal: theme.space[5], paddingVertical: theme.space[4], borderTopColor: c.lineSubtle }]}>{footer}</View>}
          </Animated.View>
        </KeyboardAvoid>
        {!keyboard && <SystemBarStrip />}
        <Toaster layer={layer} />
      </View>
    </Modal>
  );
}
/** The sheet is mobile's dialog; same component under the platform name. */
export const Sheet = Dialog;

export type MenuItem = { label: string; icon?: Icon; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";
/** Action sheet. `trigger` receives the function that opens it. */
export function Menu({ trigger, items, title }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen} title={title}>
        <View accessibilityRole="menu">
          {items.map((it, i) =>
            it === "separator" ? <Divider key={i} /> : (
              <ListItem key={i} title={it.label} icon={it.icon} danger={it.danger} accessibilityRole="menuitem"
                onPress={it.disabled ? undefined : () => { setOpen(false); it.onSelect(); }} style={it.disabled && styles.off} />
            ),
          )}
        </View>
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  end: { flex: 1, justifyContent: "flex-end" },
  // flexShrink: with the keyboard up the sheet fits the space left and its body scrolls.
  sheet: { width: "100%", maxWidth: tokens.breakpoint.sm, alignSelf: "center", flexShrink: 1 },
  head: { flexDirection: "row", alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  body: { flexGrow: 0, flexShrink: 1 },
  footer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", borderTopWidth: StyleSheet.hairlineWidth },
  off: { opacity: 0.5 },
});

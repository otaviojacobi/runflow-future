/**
 * The message composer pinned under a thread: a growing text field (up to 4,000 characters, the contract's limit) and
 * the send button. The screen keeps it above the keyboard (KeyboardAvoidingView); here it drops the home-indicator
 * inset while the keyboard is up, so there's no gap between them.
 */
import { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/i18n";
import { number } from "@/lib/format";
import { textStyle } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { IconButton, Input, Text } from "@/ui";
import { SendHorizontal } from "@/ui/icons";

export const MAX_MESSAGE = 4000;
const LINES = 5;

/** Whether the software keyboard is up (iOS reports it before the animation, Android after). */
export function useKeyboardVisible() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const a = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const b = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return shown;
}

export function Composer({ value, onChange, onSend, sending, placeholder }: { value: string; onChange: (v: string) => void; onSend: () => void; sending?: boolean; placeholder?: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const line = textStyle("bodyMd").lineHeight;
  const padY = (theme.size.touchMin - 2 - line) / 2;
  const left = MAX_MESSAGE - value.length;
  const canSend = value.trim().length > 0 && !sending;
  return (
    <View style={[styles.bar, {
      gap: theme.space[2], paddingHorizontal: theme.space[3], paddingTop: theme.space[2], paddingBottom: (keyboard ? 0 : insets.bottom) + theme.space[2],
      backgroundColor: c.surface, borderTopColor: c.line,
    }]}>
      <View style={[styles.row, { gap: theme.space[2], width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center" }]}>
        <Input
          multiline
          value={value}
          onChangeText={onChange}
          maxLength={MAX_MESSAGE}
          placeholder={placeholder ?? t("Escreva uma mensagem")}
          accessibilityLabel={t("Mensagem")}
          // The web preview's <textarea> starts at 2 rows; native grows with the text from one line.
          numberOfLines={Platform.OS === "web" ? 1 : undefined}
          style={[styles.flex, { minHeight: theme.size.touchMin, maxHeight: line * LINES + padY * 2 + 2, paddingVertical: padY, borderRadius: theme.radius.xl, backgroundColor: c.canvas }]}
        />
        <IconButton icon={SendHorizontal} label={t("Enviar")} variant="primary" disabled={!canSend} onPress={onSend}
          style={{ borderRadius: theme.radius.full }} />
      </View>
      {left <= 200 && (
        <Text variant="caption" tone={left <= 0 ? "danger" : "muted"} accessibilityLiveRegion="polite" style={[styles.count, { maxWidth: theme.size.readingMax }]}>
          {t("{n} caracteres restantes", { n: number(Math.max(0, left)) })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "flex-end" },
  flex: { flex: 1 },
  count: { alignSelf: "center", width: "100%", textAlign: "right" },
});

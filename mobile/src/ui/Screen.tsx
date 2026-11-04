/**
 * Screen body: canvas background, the standard gutters (16 pt) and vertical rhythm, optional pull to refresh.
 * `insetTop`/`insetBottom` add the safe-area padding when no header or tab bar already does. The keyboard never covers
 * an input: the body pads itself above it and scrolls the focused input into view (ui/keyboard.tsx).
 */
import { useRef, type ReactNode } from "react";
import { RefreshControl, ScrollView, View, type ScrollViewInstance, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { KeyboardAvoid, useFocusedInputVisible } from "./keyboard";

export function Screen({ children, scroll = true, insetTop, insetBottom, refreshing, onRefresh, contentStyle, header }: {
  children: ReactNode; scroll?: boolean; insetTop?: boolean; insetBottom?: boolean; refreshing?: boolean; onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>; header?: ReactNode;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const keepVisible = useFocusedInputVisible(scrollRef);
  const pad: ViewStyle = {
    paddingHorizontal: theme.space[4], paddingTop: (insetTop ? insets.top : 0) + theme.space[5], paddingBottom: (insetBottom ? insets.bottom : 0) + theme.space[8],
    gap: theme.space[5], width: "100%", maxWidth: theme.size.readingMax, alignSelf: "center",
  };
  return (
    <KeyboardAvoid style={{ backgroundColor: theme.color.canvas }}>
      {header}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          {...keepVisible}
          style={{ flex: 1 }}
          contentContainerStyle={[pad, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.color.brand.solid} colors={[theme.color.brand.solid]} progressBackgroundColor={theme.color.surface} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
    </KeyboardAvoid>
  );
}

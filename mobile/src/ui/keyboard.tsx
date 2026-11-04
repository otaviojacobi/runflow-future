/**
 * Keeping inputs above the keyboard. Android is edge-to-edge (SDK 54+), so the window no longer resizes for the
 * keyboard: a `KeyboardAvoidingView` needs `behavior="padding"` on both platforms (Expo's keyboard guide), and since
 * React Native measures it relative to its parent, it also needs to know where it starts in the window, which is below
 * the app's top bar for every screen. `KeyboardAvoid` measures that itself. `useFocusedInputVisible` scrolls a
 * ScrollView so the focused input sits above the keyboard once the padding has shrunk it.
 * Everything here is plain React Native, so it works in Expo Go (react-native-keyboard-controller isn't in Expo Go).
 */
import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type Ref, type RefObject } from "react";
import {
  Keyboard, KeyboardAvoidingView, ScrollView, TextInput, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type ScrollViewProps,
  type StyleProp, type ViewStyle,
} from "react-native";

/** A `KeyboardAvoidingView` (padding, both platforms) that measures its own offset from the top of the window. */
export function KeyboardAvoid({ children, style, contentStyle, pointerEvents }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; pointerEvents?: "box-none" | "auto";
}) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  const measure = () => ref.current?.measureInWindow((_x, y) => { if (Number.isFinite(y)) setTop((t) => (Math.abs(t - y) > 0.5 ? y : t)); });
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[{ flex: 1 }, style]} pointerEvents={pointerEvents}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={top} style={[{ flex: 1 }, contentStyle]} pointerEvents={pointerEvents}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Space kept between the focused input and the keyboard. */
const MARGIN = 16;

type Measurable = { measureLayout: (rel: never, ok: (x: number, y: number, w: number, h: number) => void, fail?: () => void) => void };
/** What the hook needs from a ScrollView instance. */
type Scrollable = { scrollTo: (o: { y: number; animated?: boolean }) => void; getInnerViewRef: () => unknown };

/**
 * Props for a ScrollView (spread them on it, with the same `ref`) that scrolls the focused input into view when the
 * keyboard opens. Only inputs inside this ScrollView count (a sheet above it is left alone).
 */
export function useFocusedInputVisible(scroll: RefObject<Scrollable | null>) {
  const offset = useRef(0);
  const height = useRef(0);
  const shown = useRef(false);

  const reveal = () => {
    const sv = scroll.current;
    const input = TextInput.State?.currentlyFocusedInput?.() as unknown as Measurable | null;
    const inner = sv?.getInnerViewRef?.() as never;
    if (!sv || !input || !inner || !height.current) return;
    // measureLayout fails when the input isn't inside this ScrollView's content.
    input.measureLayout(inner, (_x, y, _w, h) => {
      const bottom = y + h + MARGIN;
      const visible = offset.current + height.current;
      if (bottom > visible) sv.scrollTo({ y: bottom - height.current, animated: true });
      else if (y < offset.current) sv.scrollTo({ y: Math.max(0, y - MARGIN), animated: true });
    }, () => undefined);
  };

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = Keyboard.addListener("keyboardDidShow", () => {
      shown.current = true;
      // The padding lands after the event; check again once it has.
      timers.push(setTimeout(reveal, 60), setTimeout(reveal, 250));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => { shown.current = false; });
    return () => { show.remove(); hide.remove(); timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    scrollEventThrottle: 32,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; },
    onLayout: (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      const shrank = h < height.current;
      height.current = h;
      if (shrank && shown.current) reveal();
    },
  };
}

/** A ScrollView that keeps the focused input above the keyboard (for screens where the hook can't sit: early returns). */
export function KeyboardScrollView({ ref, onScroll, onLayout, scrollEventThrottle, ...props }: ScrollViewProps & { ref?: Ref<ScrollViewInstance> }) {
  const inner = useRef<ScrollViewInstance | null>(null);
  const keep = useFocusedInputVisible(inner);
  const setRef = (node: ScrollViewInstance | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as RefObject<ScrollViewInstance | null>).current = node;
  };
  return (
    <ScrollView {...props} ref={setRef} scrollEventThrottle={scrollEventThrottle ?? keep.scrollEventThrottle}
      onScroll={(e) => { keep.onScroll(e); onScroll?.(e); }} onLayout={(e) => { keep.onLayout(e); onLayout?.(e); }} />
  );
}

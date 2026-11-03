/**
 * Display components, same names as the web kit (frontend/src/ui/display.tsx): Badge, Card, Avatar, Skeleton,
 * ProgressBar, EmptyState, PageHeader, Tabs. Mobile adds ListItem (rows in lists and sheets), Divider and Spinner.
 */
import { tokens } from "@runflow/design/tokens";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View, type AccessibilityRole, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { assetUrl } from "@/lib/api";
import { t } from "@/i18n";
import { toneColors, type Tone } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { ChevronRight, type Icon } from "./icons";
import { nativeDriver, useReducedMotion } from "./motion";
import { InheritColor, Text } from "./Text";

export type { Tone };

export function Badge({ tone = "neutral", solid, icon: I, children, style }: { tone?: Tone; solid?: boolean; icon?: Icon; children: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const tc = toneColors(theme, tone);
  const fg = solid ? tc.solidFg : tc.softFg;
  return (
    <View style={[styles.badge, { backgroundColor: solid ? tc.solidBg : tc.softBg, borderRadius: theme.radius.sm }, style]}>
      {I && <I size={theme.size.iconSm - 2} color={fg} aria-hidden />}
      <Text variant="caption" color={fg} style={styles.bold} numberOfLines={1}>{children}</Text>
    </View>
  );
}

type CardTone = "brand" | "accent" | "danger" | "warning";
/** `tone` tints the whole card (and the text inside); `edge` only colors the border. Pass `onPress` for a tappable card. */
export function Card({ tone, edge, style, children, onPress, accessibilityRole, ...p }: ViewProps & { tone?: CardTone; edge?: "brand" | "danger" | "warning"; onPress?: () => void; children?: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.color;
  const look: ViewStyle = tone
    ? { backgroundColor: c[tone].subtle, borderColor: c[tone].border }
    : { backgroundColor: c.surface, borderColor: edge ? c[edge].border : c.line };
  const base = [styles.card, { borderRadius: theme.radius.lg, boxShadow: theme.shadow.sm }, look];
  const body = <InheritColor color={tone ? c[tone].subtleFg : null}>{children}</InheritColor>;
  if (onPress) {
    return (
      <Pressable accessibilityRole={accessibilityRole ?? "button"} onPress={onPress} style={({ pressed }) => [...base, pressed && { backgroundColor: tone ? c[tone].subtleHover : c.soft }, style]} {...p}>
        {body}
      </Pressable>
    );
  }
  return <View style={[...base, style]} accessibilityRole={accessibilityRole} {...p}>{body}</View>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
export function Avatar({ name, src, size = tokens.space[8], style }: { name: string; src?: string | null; size?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  const uri = assetUrl(src);
  return uri ? (
    <Image source={{ uri }} style={[box, { backgroundColor: theme.color.soft }, style as never]} contentFit="cover" accessibilityIgnoresInvertColors aria-hidden />
  ) : (
    <View style={[box, styles.center, { backgroundColor: theme.color.soft }, style]} aria-hidden>
      <Text variant="labelSm" tone="muted" style={[styles.bold, { fontSize: Math.round(size * 0.38), lineHeight: Math.round(size * 0.5) }]}>{initials(name)}</Text>
    </View>
  );
}

/** Placeholder block while content loads (pulses unless the OS asks for reduced motion). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const half = theme.motion.duration.slow * 3;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.5, duration: half, easing: theme.motion.easing.standard, useNativeDriver: nativeDriver }),
      Animated.timing(pulse, { toValue: 1, duration: half, easing: theme.motion.easing.standard, useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse, theme.motion]);
  return <Animated.View aria-hidden importantForAccessibility="no-hide-descendants" style={[{ backgroundColor: theme.color.soft, borderRadius: theme.radius.md, height: theme.space[4], opacity: pulse }, style]} />;
}

export function ProgressBar({ value, max = 100, tone = "brand", label, style }: { value: number; max?: number; tone?: Tone; label: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = tone === "neutral" ? theme.color.fgSubtle : theme.color[tone].solid;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: value }}
      style={[styles.track, { height: theme.space["1.5"], borderRadius: theme.radius.full, backgroundColor: theme.color.soft }, style]}>
      <View style={{ width: `${pct}%`, height: "100%", borderRadius: theme.radius.full, backgroundColor: bar }} />
    </View>
  );
}

export function EmptyState({ icon: I, title, children, action, style }: { icon?: Icon; title: string; children?: ReactNode; action?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={[styles.empty, { gap: theme.space[3], paddingHorizontal: theme.space[6], paddingVertical: theme.space[12] }, style]}>
      {I && <View style={[styles.center, { width: theme.space[12], height: theme.space[12], borderRadius: theme.radius.full, backgroundColor: c.brand.subtle }]}><I size={theme.size.iconLg} color={c.brand.subtleFg} aria-hidden /></View>}
      <Text variant="titleMd" accessibilityRole="header" style={styles.centerText}>{title}</Text>
      {typeof children === "string" ? <Text tone="muted" style={[styles.centerText, styles.reading]}>{children}</Text> : children}
      {action}
    </View>
  );
}

export function PageHeader({ title, subtitle, eyebrow, actions, style }: { title: string; subtitle?: string | null; eyebrow?: string | null; actions?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <View style={[{ gap: theme.space[3] }, style]}>
      <View style={{ gap: theme.space[1] }}>
        {eyebrow && <Text variant="overline" tone="muted">{eyebrow}</Text>}
        <Text variant="displaySm" accessibilityRole="header">{title}</Text>
        {subtitle && <Text tone="muted">{subtitle}</Text>}
      </View>
      {actions && <View style={[styles.wrap, { gap: theme.space[2] }]}>{actions}</View>}
    </View>
  );
}

/** Underlined tabs (the web's Tabs.List/Trigger); render the content for `value` yourself. */
export function Tabs<T extends string>({ value, onValueChange, items, label, style }: { value: T; onValueChange: (v: T) => void; items: { value: T; label: string }[]; label: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={[{ borderBottomWidth: 1, borderBottomColor: c.line }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={label} contentContainerStyle={{ gap: theme.space[1] }}>
        {items.map((it) => {
          const on = it.value === value;
          return (
            <Pressable key={it.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onValueChange(it.value)}
              style={[styles.tab, { minHeight: theme.size.touchMin, paddingHorizontal: theme.space[3], borderBottomColor: on ? c.brand.solid : "transparent" }]}>
              <Text variant="labelMd" color={on ? c.fg : c.fgMuted}>{it.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * A row in a list or a sheet (menus, settings, the club switcher): leading icon or element, title, subtitle,
 * trailing element or a chevron. With `href` it navigates; `selected` marks the current choice.
 */
export function ListItem({ title, subtitle, icon: I, leading, trailing, chevron, selected, danger, onPress, href, accessibilityRole, accessibilityLabel, style }: {
  title: string; subtitle?: string | null; icon?: Icon; leading?: ReactNode; trailing?: ReactNode; chevron?: boolean; selected?: boolean; danger?: boolean;
  onPress?: () => void; href?: Href; accessibilityRole?: AccessibilityRole; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const fg = danger ? c.danger.text : selected ? c.brand.subtleFg : c.fg;
  const press = onPress ?? (href ? () => router.push(href) : undefined);
  const content = (
    <>
      {leading ?? (I && <I size={theme.size.iconMd} color={danger ? c.danger.text : selected ? c.brand.subtleFg : c.fgMuted} aria-hidden />)}
      <View style={styles.flex}>
        <Text variant="labelMd" color={fg} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="bodySm" tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {chevron && <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />}
    </>
  );
  const box = [styles.row, { minHeight: theme.size.touchMin + theme.space[2], gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.md }];
  if (!press) return <View style={[...box, style]}>{content}</View>;
  return (
    <Pressable accessibilityRole={accessibilityRole ?? (href ? "link" : "button")} accessibilityLabel={accessibilityLabel} accessibilityState={selected !== undefined ? { selected } : undefined} onPress={press}
      style={({ pressed }) => [...box, { backgroundColor: pressed ? c.soft : selected ? c.brand.subtle : "transparent" }, style]}>
      {content}
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return <View aria-hidden style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.lineSubtle, marginVertical: theme.space[2] }, style]} />;
}

/** Spinner, shown only past ~300 ms (root.md §6: perceived speed; skeletons first). */
export function Spinner({ delay, label }: { delay?: number; label?: string }) {
  const { theme } = useTheme();
  const wait = delay ?? theme.motion.duration.slow;
  const [shown, setShown] = useState(wait === 0);
  useEffect(() => { const id = setTimeout(() => setShown(true), wait); return () => clearTimeout(id); }, [wait]);
  if (!shown) return null;
  return <ActivityIndicator color={theme.color.brand.solid} accessibilityLabel={label ?? t("Carregando…")} />;
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: tokens.space[1], paddingHorizontal: tokens.space[2], paddingVertical: tokens.space["0.5"] },
  bold: { fontWeight: String(tokens.font.weight.bold) as "700" },
  card: { borderWidth: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  reading: { maxWidth: tokens.size.readingMax / 2 },
  track: { overflow: "hidden" },
  empty: { alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  tab: { justifyContent: "center", borderBottomWidth: 2, marginBottom: -1 },
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});

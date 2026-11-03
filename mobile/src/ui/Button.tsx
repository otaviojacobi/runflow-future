/**
 * Button, IconButton, ButtonLink: same names, variants and sizes as the web kit (frontend/src/ui/Button.tsx).
 * `block` stretches across the container; otherwise the parent's alignItems decides (columns stretch by default).
 */
import { router, type Href } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { tokens } from "@runflow/design/tokens";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import type { Icon } from "./icons";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonColors(theme: Theme, variant: ButtonVariant) {
  const c = theme.color;
  switch (variant) {
    case "primary": return { bg: c.brand.solid, pressed: c.brand.solidActive, fg: c.brand.onSolid, fgPressed: c.brand.onSolid, border: c.brand.solidBorder, shadow: undefined };
    case "accent": return { bg: c.accent.solid, pressed: c.accent.solidActive, fg: c.accent.onSolid, fgPressed: c.accent.onSolid, border: c.accent.solidBorder, shadow: undefined };
    case "danger": return { bg: c.danger.solid, pressed: c.danger.solidActive, fg: c.danger.onSolid, fgPressed: c.danger.onSolid, border: c.danger.solidBorder, shadow: undefined };
    case "secondary": return { bg: c.surface, pressed: c.soft, fg: c.fg, fgPressed: c.fg, border: c.line, shadow: theme.shadow.sm };
    case "ghost": return { bg: "transparent", pressed: c.soft, fg: c.fgMuted, fgPressed: c.fg, border: "transparent", shadow: undefined };
  }
}
/** Mobile sizes: md is the 44 pt touch minimum, lg the 48 pt primary action (root.md §6); sm stays 32 with a hit slop. */
export function buttonMetrics(theme: Theme, size: ButtonSize) {
  const { space, size: s } = theme;
  const height = { sm: s.controlSm, md: s.touchMin, lg: s.controlLg }[size];
  return {
    height,
    padX: { sm: space[3], md: space[4], lg: space[5] }[size],
    gap: { sm: space["1.5"], md: space[2], lg: space[2] }[size],
    icon: { sm: s.iconSm, md: s.iconMd, lg: s.iconMd }[size],
    text: ({ sm: "labelSm", md: "labelMd", lg: "titleSm" } as const)[size],
    hitSlop: Math.max(0, (s.touchMin - height) / 2),
  };
}

type Common = {
  variant?: ButtonVariant; size?: ButtonSize; block?: boolean; loading?: boolean; disabled?: boolean;
  icon?: Icon; iconRight?: Icon; children?: ReactNode; style?: StyleProp<ViewStyle>;
} & Omit<PressableProps, "children" | "style" | "disabled">;

export function Button({ variant = "primary", size = "md", block, loading, disabled, icon: I, iconRight: IR, children, style, accessibilityRole = "button", ...rest }: Common) {
  const { theme } = useTheme();
  const v = buttonColors(theme, variant);
  const m = buttonMetrics(theme, size);
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      hitSlop={m.hitSlop || undefined}
      style={({ pressed }) => [
        styles.base,
        { minHeight: m.height, paddingHorizontal: m.padX, gap: m.gap, borderRadius: theme.radius.md, backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border, boxShadow: v.shadow },
        block && styles.block,
        pressed && styles.pressed,
        off && styles.off,
        style,
      ]}
      {...rest}
    >
      {({ pressed }) => {
        const fg = pressed ? v.fgPressed : v.fg;
        return (
          <>
            {loading ? <ActivityIndicator size="small" color={fg} /> : I ? <I size={m.icon} color={fg} aria-hidden /> : null}
            {typeof children === "string" ? <Text variant={m.text} color={fg} numberOfLines={1}>{children}</Text> : children}
            {IR && <IR size={m.icon} color={fg} aria-hidden />}
          </>
        );
      }}
    </Pressable>
  );
}

/** Icon-only button: `label` is required (it is the accessible name). */
export function IconButton({ label, icon: I, variant = "ghost", size = "md", disabled, style, badge, ...rest }: { label: string; icon: Icon; variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean; style?: StyleProp<ViewStyle>; badge?: ReactNode } & Omit<PressableProps, "children" | "style" | "disabled">) {
  const { theme } = useTheme();
  const v = buttonColors(theme, variant);
  const m = buttonMetrics(theme, size);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={m.hitSlop || undefined}
      style={({ pressed }) => [
        styles.base,
        { width: m.height, height: m.height, borderRadius: theme.radius.md, backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border, boxShadow: v.shadow },
        pressed && styles.pressed,
        disabled && styles.off,
        style,
      ]}
      {...rest}
    >
      {({ pressed }) => (
        <>
          <I size={size === "sm" ? theme.size.iconSm : size === "lg" ? theme.size.iconLg : theme.size.iconMd} color={pressed ? v.fgPressed : v.fg} aria-hidden />
          {badge && <View style={styles.badge} pointerEvents="none">{badge}</View>}
        </>
      )}
    </Pressable>
  );
}

/** A route link styled as a button. */
export function ButtonLink({ href, replace, ...rest }: Common & { href: Href; replace?: boolean }) {
  return <Button accessibilityRole="link" onPress={() => (replace ? router.replace(href) : router.push(href))} {...rest} />;
}

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  block: { alignSelf: "stretch" },
  pressed: { transform: [{ scale: 0.98 }] },
  off: { opacity: 0.5 },
  badge: { position: "absolute", top: tokens.space["0.5"], right: tokens.space["0.5"] },
});

/**
 * Form controls, same names as the web kit (frontend/src/ui/form.tsx): Field, Input, Textarea, Select, Checkbox,
 * Switch, Segmented. On mobile, Select opens a bottom sheet (there is no native <select>).
 */
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { AccessibilityInfo, Platform, Pressable, Switch as RNSwitch, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { tokens } from "@runflow/design/tokens";
import { alpha, textStyle } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { t } from "@/i18n";
import { Check, ChevronDown, CircleAlert, type Icon } from "./icons";
import { Dialog } from "./overlay";
import { Text } from "./Text";

/** What Field hands its control: the label is the control's accessible name, the error (or hint) its hint. */
export interface FieldControl { accessibilityLabel: string; accessibilityHint?: string; invalid: boolean }

/** Label + control + hint/error. `children` is a render function that receives the accessibility props. */
export function Field({ label, hint, error, optional, children, style }: { label: string; hint?: string | null; error?: string | null; optional?: boolean; children: (a: FieldControl) => ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const c = theme.color;
  // Android reads the live region; iOS needs an explicit announcement.
  useEffect(() => { if (error && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(error); }, [error]);
  return (
    <View style={[styles.field, style]}>
      <Text variant="labelSm" importantForAccessibility="no" accessibilityElementsHidden>
        {label}{optional ? <Text variant="bodySm" tone="muted">{` ${t("(opcional)")}`}</Text> : null}
      </Text>
      {children({ accessibilityLabel: optional ? `${label} ${t("(opcional)")}` : label, accessibilityHint: error ?? hint ?? undefined, invalid: !!error })}
      {error ? (
        <View style={styles.msg} accessibilityLiveRegion="polite">
          <CircleAlert size={theme.size.iconSm - 2} color={c.danger.text} aria-hidden />
          <Text variant="caption" tone="danger" style={styles.flex}>{error}</Text>
        </View>
      ) : hint ? (
        <Text variant="caption" tone="muted">{hint}</Text>
      ) : null}
    </View>
  );
}

function useControlColors(invalid?: boolean, focused?: boolean, readOnly?: boolean) {
  const { theme } = useTheme();
  const c = theme.color;
  const ring = invalid ? c.danger.ring : c.brand.ring;
  return {
    borderColor: invalid ? c.danger.solid : focused ? c.brand.ring : c.lineStrong,
    backgroundColor: readOnly ? c.sunken : c.surface,
    // The web's focus ring (ring-3 at 25 %).
    boxShadow: focused ? `0 0 0 3px ${alpha(ring, 0.25)}` : undefined,
  };
}

type InputProps = ComponentProps<typeof TextInput> & { invalid?: boolean };
export function Input({ invalid, style, readOnly, onFocus, onBlur, ref, multiline, ...p }: InputProps) {
  const { theme } = useTheme();
  const c = theme.color;
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      readOnly={readOnly}
      multiline={multiline}
      placeholderTextColor={c.fgSubtle}
      selectionColor={c.brand.solid}
      cursorColor={c.brand.solid}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[
        styles.control, textStyle("bodyMd"),
        { color: readOnly ? c.fgMuted : c.fg, borderRadius: theme.radius.md, minHeight: theme.size.controlLg },
        multiline && { minHeight: theme.size.controlLg * 2, paddingVertical: theme.space[3], textAlignVertical: "top" },
        useControlColors(invalid, focused && !readOnly, readOnly),
        style,
      ]}
      {...p}
    />
  );
}
export function Textarea(p: InputProps) {
  return <Input multiline {...p} />;
}

export interface SelectOption<T extends string> { value: T; label: string; description?: string }
/** A field-styled button that opens a sheet with the options (radio list). */
export function Select<T extends string>({ value, onChange, options, placeholder, title, invalid, disabled, accessibilityLabel, accessibilityHint, style }: {
  value: T | null; onChange: (v: T) => void; options: SelectOption<T>[]; placeholder?: string; title?: string; invalid?: boolean; disabled?: boolean;
  accessibilityLabel: string; accessibilityHint?: string; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const c = theme.color;
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityValue={{ text: current?.label ?? placeholder ?? "" }}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.control, styles.select, { borderRadius: theme.radius.md, minHeight: theme.size.controlLg }, useControlColors(invalid, open), disabled && styles.off, style]}
      >
        <Text numberOfLines={1} tone={current ? "default" : "subtle"} style={styles.flex}>{current?.label ?? placeholder ?? ""}</Text>
        <ChevronDown size={theme.size.iconSm} color={c.fgMuted} aria-hidden />
      </Pressable>
      <Dialog open={open} onOpenChange={setOpen} title={title ?? accessibilityLabel}>
        <View accessibilityRole="radiogroup" accessibilityLabel={title ?? accessibilityLabel}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => { onChange(o.value); setOpen(false); }}
                style={({ pressed }) => [styles.option, { minHeight: theme.size.touchMin + theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : selected ? c.brand.subtle : "transparent" }]}>
                <View style={styles.flex}>
                  <Text variant="labelMd" color={selected ? c.brand.subtleFg : c.fg}>{o.label}</Text>
                  {o.description && <Text variant="bodySm" tone="muted">{o.description}</Text>}
                </View>
                {selected && <Check size={theme.size.iconMd} color={c.brand.subtleFg} aria-hidden />}
              </Pressable>
            );
          })}
        </View>
      </Dialog>
    </>
  );
}

function ToggleRow({ role, checked, onCheckedChange, label, description, disabled, control }: { role: "checkbox" | "switch"; checked: boolean; onCheckedChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean; control: ReactNode }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      style={[styles.toggle, { minHeight: theme.size.touchMin, flexDirection: role === "checkbox" ? "row" : "row-reverse" }, disabled && styles.off]}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{control}</View>
      <View style={styles.flex}>
        <Text variant="labelMd">{label}</Text>
        {description && <Text variant="bodySm" tone="muted">{description}</Text>}
      </View>
    </Pressable>
  );
}
export function Checkbox({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const box = (
    <View style={[styles.box, { width: theme.size.iconMd, height: theme.size.iconMd, borderRadius: theme.radius.xs, borderColor: checked ? c.brand.solid : c.lineStrong, backgroundColor: checked ? c.brand.solid : c.surface }]}>
      {checked && <Check size={theme.size.iconSm} color={c.brand.onSolid} strokeWidth={3} aria-hidden />}
    </View>
  );
  return <ToggleRow role="checkbox" checked={checked} onCheckedChange={onCheckedChange} label={label} description={description} disabled={disabled} control={box} />;
}
/** The platform's switch in token colors; the whole row toggles it. */
export function Switch({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const thumb = theme.mode === "dark" ? c.fg : c.surface;
  // react-native-web colors the "on" thumb with its own `activeThumbColor` (teal by default).
  const web = Platform.OS === "web" ? ({ activeThumbColor: thumb } as object) : {};
  const control = (
    <RNSwitch value={checked} onValueChange={onCheckedChange} disabled={disabled}
      trackColor={{ false: c.lineStrong, true: c.brand.solid }} thumbColor={thumb} ios_backgroundColor={c.lineStrong} {...web} />
  );
  return <ToggleRow role="switch" checked={checked} onCheckedChange={onCheckedChange} label={label} description={description} disabled={disabled} control={control} />;
}

/** Segmented control (radio group). */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md", style }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: Icon }[]; label: string; size?: "sm" | "md"; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const c = theme.color;
  const pad = theme.space["0.5"];
  const height = (size === "sm" ? theme.size.controlSm : theme.size.touchMin) - pad * 2;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { padding: pad, gap: pad, borderRadius: theme.radius.md, backgroundColor: c.soft }, style]}>
      {options.map((o) => {
        const on = value === o.value;
        const I = o.icon;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)}
            hitSlop={size === "sm" ? (theme.size.touchMin - theme.size.controlSm) / 2 : undefined}
            style={[styles.segment, { minHeight: height, paddingHorizontal: theme.space[3], gap: theme.space["1.5"], borderRadius: theme.radius.md - pad }, on && { backgroundColor: c.surface, boxShadow: theme.shadow.sm }]}>
            {I && <I size={theme.size.iconSm} color={on ? c.fg : c.fgMuted} aria-hidden />}
            <Text variant={size === "sm" ? "labelSm" : "labelMd"} color={on ? c.fg : c.fgMuted} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: tokens.space["1.5"] },
  msg: { flexDirection: "row", alignItems: "center", gap: tokens.space[1] },
  flex: { flex: 1, minWidth: 0 },
  control: { borderWidth: 1, paddingHorizontal: tokens.space[3] },
  select: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  option: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingHorizontal: tokens.space[3], paddingVertical: tokens.space[2] },
  toggle: { alignItems: "center", gap: tokens.space[3] },
  box: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  segmented: { flexDirection: "row", alignSelf: "flex-start" },
  segment: { flexGrow: 1, flexShrink: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  off: { opacity: 0.5 },
});

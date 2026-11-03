/**
 * Building blocks of the account screens (C1, M7, W11): a titled section, a confirm sheet for destructive actions,
 * a +/− stepper and the zones table.
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { Zone } from "@/api/types";
import { t } from "@/i18n";
import { pace } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, IconButton, Text } from "@/ui";
import { Minus, Plus } from "@/ui/icons";

/** An overline title (and optional description) over a card, like the web's account sections. */
export function Section({ title, description, children, danger, padded = true, style }: {
  title: string; description?: string | null; children: ReactNode; danger?: boolean; padded?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  return (
    <View style={[{ gap: theme.space[2] }, style]}>
      <View style={{ gap: theme.space["0.5"], paddingHorizontal: theme.space[1] }}>
        <Text variant="overline" tone={danger ? "danger" : "subtle"} accessibilityRole="header">{title}</Text>
        {description ? <Text variant="bodySm" tone="muted">{description}</Text> : null}
      </View>
      <Card edge={danger ? "danger" : undefined} style={padded ? { padding: theme.space[4], gap: theme.space[4] } : { padding: theme.space[1] }}>{children}</Card>
    </View>
  );
}

/** "Are you sure?" for anything that can't be taken back: Voltar + the danger action. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, loading, disabled, children }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string | null; confirmLabel: string; onConfirm: () => void;
  loading?: boolean; disabled?: boolean; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<><Button variant="ghost" onPress={() => onOpenChange(false)}>{t("Voltar")}</Button><Button variant="danger" loading={loading} disabled={disabled} onPress={onConfirm}>{confirmLabel}</Button></>}>
      {children}
    </Dialog>
  );
}

/** − value + for small counts (sessions per week). Screen readers get an adjustable control. */
export function Stepper({ label, value, onChange, min, max, format }: { label: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; format: (v: number) => string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const v = value ?? null;
  const dec = () => onChange(v === null ? min : Math.max(min, v - 1));
  const inc = () => onChange(v === null ? Math.min(max, min + 1) : Math.min(max, v + 1));
  return (
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: v === null ? t("Não informado") : format(v) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => (e.nativeEvent.actionName === "increment" ? inc() : dec())}
      style={[styles.stepper, { gap: theme.space[2] }]}>
      <IconButton icon={Minus} label={t("Menos")} variant="secondary" onPress={dec} disabled={v !== null && v <= min} importantForAccessibility="no" accessibilityElementsHidden />
      <View style={[styles.stepValue, { minWidth: theme.space[20], minHeight: theme.size.touchMin, borderRadius: theme.radius.md, backgroundColor: c.sunken }]}>
        <Text variant="titleMd" tone={v === null ? "subtle" : "default"} style={styles.tabular}>{v === null ? "–" : format(v)}</Text>
      </View>
      <IconButton icon={Plus} label={t("Mais")} variant="secondary" onPress={inc} disabled={v !== null && v >= max} importantForAccessibility="no" accessibilityElementsHidden />
    </View>
  );
}

/** Zones from the hardest down (the web's ZoneTable): the zone color chip and the range, tabular. */
export function ZoneTable({ z, unit }: { z: Pick<Zone, "bounds">; unit: "pace" | "hr" | "swim_pace" | "power" }) {
  const { theme } = useTheme();
  const zc = theme.color.zone as Record<string, { solid: string; onSolid: string }>;
  const fmt = (b: Zone["bounds"][number]) =>
    unit === "pace" ? `${pace(b.min)} – ${pace(b.max)} /km` : unit === "swim_pace" ? `${pace(b.min)} – ${pace(b.max)} /100 m` : unit === "power" ? `${b.min} – ${b.max} W` : `${b.min} – ${b.max} bpm`;
  return (
    <View>
      {[...z.bounds].reverse().map((b, i) => {
        const col = zc[String(b.zone)] ?? { solid: theme.color.soft, onSolid: theme.color.fg };
        return (
          <View key={b.zone} accessible accessibilityLabel={`${t("Zona {n}", { n: b.zone })}: ${fmt(b)}`}
            style={[styles.zoneRow, { gap: theme.space[3], paddingVertical: theme.space[2], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }]}>
            <View style={[styles.center, { width: theme.space[8], height: theme.space[6] + theme.space[1], borderRadius: theme.radius.sm, backgroundColor: col.solid }]}>
              <Text variant="labelSm" color={col.onSolid} style={{ fontWeight: weight("bold") }}>{`Z${b.zone}`}</Text>
            </View>
            <Text variant="labelMd" style={styles.tabular}>{fmt(b)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
  stepValue: { alignItems: "center", justifyContent: "center" },
  tabular: { fontVariant: ["tabular-nums"] },
  zoneRow: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
});

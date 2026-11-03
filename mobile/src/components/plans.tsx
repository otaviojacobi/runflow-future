/** Planilha pieces (W7): the weekly volume bars, a week switcher on the editor when `onSelect` is given. */
import { Pressable, StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { duration } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";

/** Weekly volume as bars (planned time per week); empty weeks stay faint. */
export function VolumeBars({ weekly, height, selected, onSelect }: { weekly: number[]; height: number; selected?: number; onSelect?: (week: number) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const max = Math.max(1, ...weekly);
  return (
    <View accessibilityRole={onSelect ? "tablist" : "image"} accessibilityLabel={t("Volume por semana")} style={[styles.bars, { height, gap: theme.space["0.5"] }]}>
      {weekly.map((s, i) => {
        const w = i + 1;
        const bar = (
          <View style={{ height: `${Math.max(6, (s / max) * 100)}%`, borderTopLeftRadius: theme.radius.xs, borderTopRightRadius: theme.radius.xs,
            backgroundColor: selected === w ? c.brand.solid : c.brand.text, opacity: selected !== undefined && selected !== w ? 0.35 : s ? 1 : 0.2 }} />
        );
        return onSelect ? (
          <Pressable key={i} onPress={() => onSelect(w)} accessibilityRole="tab" accessibilityState={{ selected: selected === w }}
            accessibilityLabel={t("Semana {n}: {d}", { n: w, d: s ? duration(s) : t("vazia") })} style={[styles.flex, styles.end, { minHeight: theme.size.touchMin }]}>
            {bar}
          </Pressable>
        ) : <View key={i} style={[styles.flex, styles.end]}>{bar}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bars: { flexDirection: "row", alignItems: "stretch" },
  end: { justifyContent: "flex-end" },
});

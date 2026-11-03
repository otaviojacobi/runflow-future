/** Sports: label + icon + the sport's data color, never color alone (root.md §6). Mirrors the web's components/sport.tsx. */
import { StyleSheet, View } from "react-native";
import type { Sport } from "@/api/types";
import { t } from "@/i18n";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";
import { Activity, Bike, Dumbbell, Footprints, PersonStanding, Waves, type Icon } from "@/ui/icons";

export const SPORT_LABEL: Record<Sport, string> = { run: "Corrida", swim: "Natação", bike: "Ciclismo", strength: "Musculação", mobility: "Mobilidade", other: "Outro" };
export const SPORT_ICON: Record<Sport, Icon> = { run: Footprints, swim: Waves, bike: Bike, strength: Dumbbell, mobility: PersonStanding, other: Activity };

export function SportChip({ sport, size = "md" }: { sport: Sport; size?: "sm" | "md" }) {
  const { theme } = useTheme();
  const s = theme.color.sport[sport];
  const I = SPORT_ICON[sport];
  return (
    <View style={[styles.chip, { backgroundColor: s.subtle, borderRadius: theme.radius.full, gap: theme.space["1.5"], paddingHorizontal: size === "sm" ? theme.space[2] : theme.space[3], paddingVertical: theme.space[1] }]}>
      <I size={theme.size.iconSm - (size === "sm" ? 2 : 0)} color={s.subtleFg} aria-hidden />
      <Text variant={size === "sm" ? "caption" : "labelSm"} color={s.subtleFg} style={{ fontWeight: weight("semibold") }}>{t(SPORT_LABEL[sport])}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center" },
});

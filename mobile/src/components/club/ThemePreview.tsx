/**
 * A small phone showing a club's colors on real UI (the web's components/club/ThemePreview.tsx): the header with the
 * logo and name, today's workout with the primary button, and a streak in the secondary color. It re-themes only
 * itself (ThemeScope), so the screen around it keeps Runflow's colors (D-024).
 */
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ClubLogo } from "@/components/brand";
import { SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import type { Structure } from "@/domain/workout";
import { t } from "@/i18n";
import type { ClubColors } from "@/theme/theme";
import { ThemeScope, useTheme } from "@/theme/ThemeProvider";
import { Button, Segmented, Text } from "@/ui";
import { Bell, Flame } from "@/ui/icons";

const SAMPLE: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" } } ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };

function Phone({ name, logoUri }: { name: string; logoUri?: string | null }) {
  const { theme } = useTheme();
  const c = theme.color;
  const logo = theme.space[8] + theme.space[1];
  return (
    <View style={{ padding: theme.space[2], borderRadius: theme.radius.xl + theme.space[2], backgroundColor: c.inverse }}>
      <View style={{ overflow: "hidden", borderRadius: theme.radius.xl, backgroundColor: c.canvas, padding: theme.space[3], gap: theme.space[3] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} contentFit="contain" style={{ width: logo, height: logo, borderRadius: theme.radius.md, backgroundColor: c.surface }} />
          ) : <ClubLogo club={{ name: name || t("Seu clube") }} size={logo} />}
          <View style={styles.flex}>
            <Text variant="caption" tone="muted" numberOfLines={1}>{name || t("Seu clube")}</Text>
            <Text variant="titleSm" numberOfLines={1}>{t("Bom dia, Ana")}</Text>
          </View>
          <Bell size={theme.size.iconSm} color={c.fg} aria-hidden />
        </View>
        <View style={{ padding: theme.space[3], gap: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <View style={styles.between}>
            <SportChip sport="run" size="sm" />
            <View style={[styles.row, { gap: theme.space[1], paddingHorizontal: theme.space[2], paddingVertical: theme.space["0.5"], borderRadius: theme.radius.full, backgroundColor: c.accent.solid }]}>
              <Flame size={theme.size.iconSm - 2} color={c.accent.onSolid} aria-hidden />
              <Text variant="caption" color={c.accent.onSolid}>{t("4 semanas")}</Text>
            </View>
          </View>
          <Text variant="labelMd">{t("Intervalado 6×1 km")}</Text>
          <IntensityProfile structure={SAMPLE} sport="run" height={theme.space[8]} />
          <Button size="sm" block>{t("Concluir treino")}</Button>
        </View>
      </View>
    </View>
  );
}

/** The club's colors (null, null = Runflow's defaults) on one phone, light or dark (a switch under it). */
export function ThemePreview({ name, colors, logoUri }: { name: string; colors: ClubColors; logoUri?: string | null }) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<"light" | "dark">(theme.mode);
  return (
    <View style={[styles.centered, { gap: theme.space[3] }]}>
      <View accessible accessibilityLabel={t("Prévia do app com as cores escolhidas")} style={{ width: "100%", maxWidth: theme.space[20] * 3 + theme.space[10] }}>
        <ThemeScope club={colors} mode={mode}><Phone name={name} logoUri={logoUri} /></ThemeScope>
      </View>
      <Segmented<"light" | "dark"> label={t("Modo da prévia")} size="sm" value={mode} onChange={setMode}
        options={[{ value: "light", label: t("Claro") }, { value: "dark", label: t("Escuro") }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  centered: { alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
});

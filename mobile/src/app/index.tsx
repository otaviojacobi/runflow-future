/**
 * X0 · status screen: proves the scaffold end to end (theme from tokens, club theme cache, API client).
 * Replaced by sign-in (X2) and the role tabs (X3).
 */
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL, ApiError, api } from "@/lib/api";
import { t } from "@/i18n";
import { textStyle } from "@/theme/theme";
import { type ModePref, useTheme } from "@/theme/ThemeProvider";

const DEMO_CLUBS = [
  { name: "Runflow", primary: null, secondary: null },
  { name: "Pace Forte", primary: "#D62828", secondary: "#FFB703" },
  { name: "Equipe Maré", primary: "#0096C7", secondary: null },
] as const;

export default function Index() {
  const { theme, setClub, modePref, setModePref } = useTheme();
  const c = theme.color;
  const insets = useSafeAreaInsets();
  const [health, setHealth] = useState<{ ok: boolean; text: string } | null>(null);
  const check = () => {
    setHealth(null);
    api.get<{ ok: boolean; anchor_date: string; routes: number }>("/health")
      .then((h) => setHealth({ ok: true, text: t("Conectado: {n} rotas, dados de {d}", { n: h.routes, d: h.anchor_date }) }))
      .catch((e) => setHealth({ ok: false, text: e instanceof ApiError ? `${e.title}. ${e.detail}` : t("Algo deu errado") }));
  };
  useEffect(check, []);
  const card = [styles.card, { backgroundColor: c.surface, borderColor: c.line }];
  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={[styles.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.row}>
        <View style={[styles.mark, { backgroundColor: c.brand.solid }]}><View style={[styles.dot, { backgroundColor: c.accent.solid }]} /></View>
        <Text style={[textStyle("displaySm"), { color: c.fg }]}>runflow</Text>
      </View>
      <Text style={[textStyle("bodyMd"), { color: c.fgMuted }]}>{t("App móvel em construção. Esta tela confere tema, cache e conexão com a API.")}</Text>

      <View style={card}>
        <Text style={[textStyle("titleMd"), { color: c.fg }]}>{t("API")}</Text>
        <Text style={[textStyle("bodySm"), { color: c.fgMuted }]}>{API_URL}</Text>
        <Text accessibilityLiveRegion="polite" style={[textStyle("bodyMd"), { color: health ? (health.ok ? c.success.text : c.danger.text) : c.fgSubtle }]}>{health ? health.text : t("Conectando…")}</Text>
        <Pressable accessibilityRole="button" onPress={check} style={({ pressed }) => [styles.btnGhost, { borderColor: c.lineStrong, opacity: pressed ? 0.7 : 1 }]}><Text style={[textStyle("labelMd"), { color: c.fg }]}>{t("Testar de novo")}</Text></Pressable>
      </View>

      <View style={card}>
        <Text style={[textStyle("titleMd"), { color: c.fg }]}>{t("Tema do clube")}</Text>
        <Text style={[textStyle("bodySm"), { color: c.fgMuted }]}>{t("Fica salvo no aparelho: o próximo início já abre com estas cores.")}</Text>
        <View style={styles.wrap}>
          {DEMO_CLUBS.map((club) => (
            <Pressable key={club.name} accessibilityRole="button" onPress={() => setClub(club.primary ? { primary: club.primary, secondary: club.secondary } : null)}
              style={({ pressed }) => [styles.chip, { borderColor: c.line, backgroundColor: pressed ? c.soft : c.surface }]}>
              <View style={[styles.swatch, { backgroundColor: club.primary ?? "#4B4FE8" }]} />
              <Text style={[textStyle("labelMd"), { color: c.fg }]}>{club.name}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.wrap}>
          {(["system", "light", "dark"] as ModePref[]).map((m) => (
            <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: modePref === m }} onPress={() => setModePref(m)}
              style={[styles.chip, { borderColor: modePref === m ? c.brand.ring : c.line, backgroundColor: modePref === m ? c.brand.subtle : c.surface }]}>
              <Text style={[textStyle("labelMd"), { color: modePref === m ? c.brand.subtleFg : c.fgMuted }]}>{t({ system: "Sistema", light: "Claro", dark: "Escuro" }[m])}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? c.brand.solidActive : c.brand.solid, borderColor: c.brand.solidBorder }]}>
          <Text style={[textStyle("titleSm"), { color: c.brand.onSolid }]}>{t("Botão principal")}</Text>
        </Pressable>
        <View style={[styles.badge, { backgroundColor: c.accent.solid }]}><Text style={[textStyle("labelSm"), { color: c.accent.onSolid }]}>{t("Recorde")}</Text></View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 32, height: 32, borderRadius: 9, alignItems: "flex-end", padding: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  btnGhost: { minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, alignSelf: "flex-start", paddingHorizontal: 14 },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
});

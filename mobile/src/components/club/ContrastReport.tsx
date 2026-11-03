/**
 * WCAG contrast of a club's generated color roles in light and dark (the web's Club Studio report): the engine
 * guarantees the minimums; this shows the owner how. The "Aa" chips are drawn in the measured colors themselves.
 */
import Color, { type Mode, type Roles } from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { number } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Text } from "@/ui";
import { Check, Info, Moon, Sun } from "@/ui/icons";

const MODES: Mode[] = ["light", "dark"];

export function ContrastReport({ primary, secondary }: { primary: string; secondary: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const rows = useMemo(() => {
    const of = (seed: string) => Object.fromEntries(MODES.map((m) => [m, Color.roles(seed, m, tokens.env[m])])) as Record<Mode, Roles>;
    const p = of(primary), s = of(secondary);
    const env = tokens.env;
    return [
      { label: t("Texto nos botões"), min: 4.5, get: (m: Mode) => ({ v: p[m].meta.onSolidContrast, adj: false, a: p[m].solid, b: p[m].onSolid }) },
      { label: t("Botão sobre o fundo"), min: 3, get: (m: Mode) => ({ v: p[m].meta.solidVsCanvas, adj: p[m].meta.solidAdjusted, a: env[m].canvas, b: p[m].solid }) },
      { label: t("Links e textos na cor primária"), min: 4.5, get: (m: Mode) => ({ v: +Color.contrast(p[m].text, env[m].surface).toFixed(2), adj: p[m].meta.textAdjusted, a: env[m].surface, b: p[m].text }) },
      { label: t("Selos na cor secundária"), min: 4.5, get: (m: Mode) => ({ v: s[m].meta.onSolidContrast, adj: false, a: s[m].solid, b: s[m].onSolid }) },
      { label: t("Textos na cor secundária"), min: 4.5, get: (m: Mode) => ({ v: +Color.contrast(s[m].text, env[m].surface).toFixed(2), adj: s[m].meta.textAdjusted, a: env[m].surface, b: s[m].text }) },
    ];
  }, [primary, secondary]);
  const anyAdjusted = rows.some((r) => r.get("light").adj || r.get("dark").adj);
  const chip = theme.space[6];
  const col = { width: theme.space[20] + theme.space[2] };
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="titleSm" accessibilityRole="header">{t("Contraste e leitura")}</Text>
        <Text variant="bodySm" tone="muted">{t("Medido pelo padrão WCAG. Mínimo de 4,5:1 para texto e 3:1 para botões.")}</Text>
      </View>
      <View style={[styles.row, { gap: theme.space[2] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text variant="caption" tone="muted" style={[styles.flex, styles.bold]}>{t("Onde")}</Text>
        {MODES.map((m) => (
          <View key={m} style={[styles.row, col, { gap: theme.space[1] }]}>
            {m === "light" ? <Sun size={theme.size.iconSm - 2} color={c.fgMuted} /> : <Moon size={theme.size.iconSm - 2} color={c.fgMuted} />}
            <Text variant="caption" tone="muted" style={styles.bold}>{m === "light" ? t("Claro") : t("Escuro")}</Text>
          </View>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.label} style={[styles.row, { gap: theme.space[2], paddingTop: theme.space[2], borderTopWidth: 1, borderTopColor: c.lineSubtle }]}>
          <Text variant="bodySm" style={styles.flex}>{r.label}</Text>
          {MODES.map((m) => {
            const x = r.get(m);
            const ok = x.v >= r.min;
            return (
              <View key={m} accessible accessibilityLabel={`${r.label}, ${m === "light" ? t("Claro") : t("Escuro")}: ${number(x.v, 1)}:1, ${ok ? t("Aprovado") : t("Abaixo do mínimo")}${x.adj ? `, ${t("Tom ajustado")}` : ""}`}
                style={[styles.row, col, { gap: theme.space[1] }]}>
                <View style={[styles.center, { width: chip, height: chip, borderRadius: theme.radius.xs, backgroundColor: x.a, borderWidth: 1, borderColor: c.line }]}>
                  <Text variant="caption" color={x.b} style={styles.bold}>Aa</Text>
                </View>
                <Text variant="labelSm" style={styles.tabular}>{number(x.v, 1)}:1</Text>
                {ok ? <Check size={theme.size.iconSm} color={c.success.text} /> : <Info size={theme.size.iconSm} color={c.warning.text} />}
                {x.adj ? <Text variant="caption" color={c.info.text}>*</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
      {anyAdjusted && (
        <Text variant="caption" tone="muted">
          <Text variant="caption" color={c.info.text}>* </Text>
          {t("Ajustamos o tom automaticamente neste modo para manter a leitura. A cor original continua no logo e nos destaques grandes.")}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: weight("bold") },
  tabular: { fontVariant: ["tabular-nums"] },
});

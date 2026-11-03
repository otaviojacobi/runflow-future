/**
 * W5 core on the phone (the web's components/builder/WorkoutBuilder.tsx): quick text ⇄ the block list ⇄ the live
 * summary. The quick text parses on every keystroke, on the device (domain/quicktext.ts, works offline); editing a
 * block writes the text back. Controlled; used by the library builder and Planejamento's "Montar agora".
 */
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { Sport } from "@/api/types";
import { parseQuickText, toQuickText } from "@/domain/quicktext";
import { extractTags } from "@/domain/tags";
import type { Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Text, Textarea } from "@/ui";
import { CircleAlert, CircleCheck, Lightbulb, Wand2 } from "@/ui/icons";
import { BlockList } from "./BlockList";
import { Chip, WorkoutSummary } from "./parts";

const EXAMPLES: Record<Sport, string[]> = {
  run: ["10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq", "15' Z2 + 3x(2km Z4 + 3' Z1) + 10' Z1", "40' leve", "1h20 Z2 (longão, hidratação a cada 5 km)"],
  swim: ["400 livre aquec + 8x50 educativo + 10x100 crawl @1:45 palmar + 200 costas desaq", "300 aquec + 4x200 crawl @3:30 pull + 200 escolha"],
  bike: ["15' Z2 + 4x8' Z4 c/ 4' Z1 + 10' Z1", "2h Z2"],
  strength: ["Agachamento 4x8 70% desc 90\"\nSupino 4x10 20kg desc 60\"\nPrancha 3x45s pc desc 30\""],
  mobility: ["20' mobilidade (quadril, tornozelo e torácica)"],
  other: ["45' livre"],
};

/** `onTags`: "#hashtags" typed in the quick text (only where the workout has tags: the library). `compact`: no summary. */
export function WorkoutBuilder({ sport, structure, onChange, onTags, compact }: { sport: Sport; structure: Structure; onChange: (s: Structure) => void; onTags?: (tags: string[]) => void; compact?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [text, setText] = useState(() => toQuickText(structure, sport));
  const [warnings, setWarnings] = useState<string[]>([]);
  const fromText = useRef(false);
  // Editor (or sport) changes rewrite the text; text changes don't loop back.
  useEffect(() => {
    if (fromText.current) { fromText.current = false; return; }
    setText(toQuickText(structure, sport));
    setWarnings([]);
  }, [structure, sport]);
  const onText = (v: string) => {
    setText(v);
    const r = parseQuickText(v, sport);
    setWarnings(r.warnings);
    fromText.current = true;
    onChange(r.structure);
    // Only finished hashtags (followed by a space); the one still being typed is taken on blur.
    if (onTags) { const done = extractTags(v.replace(/#[^\s#]*$/, "")).tags; if (done.length) onTags(done); }
  };

  return (
    <View style={{ gap: theme.space[5] }}>
      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Wand2 size={theme.size.iconMd} color={c.accent.text} aria-hidden />
          <Text variant="titleSm" accessibilityRole="header">{t("Escrita rápida")}</Text>
        </View>
        <Text variant="bodySm" tone="muted">{t("Escreva como no WhatsApp. As etapas abaixo acompanham.")}</Text>
        <Textarea value={text} onChangeText={onText} accessibilityLabel={t("Escrita rápida")} placeholder={EXAMPLES[sport][0]} autoCorrect={false} autoCapitalize="none" spellCheck={false}
          onBlur={() => { const x = extractTags(text).tags; if (onTags && x.length) onTags(x); }}
          style={{ minHeight: sport === "strength" ? theme.space[20] + theme.space[10] : theme.space[20] }} />
        {warnings.length > 0 ? (
          <View style={[styles.row, styles.top, { gap: theme.space[2] }]} accessibilityLiveRegion="polite">
            <CircleAlert size={theme.size.iconSm} color={c.warning.text} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
            <Text variant="bodySm" color={c.warning.text} style={styles.flex}>{t("Não entendi: {x}. O resto foi aplicado.", { x: warnings.map((w) => `“${w}”`).join(", ") })}</Text>
          </View>
        ) : text.trim() ? (
          <View style={[styles.row, { gap: theme.space[2] }]} accessibilityLiveRegion="polite">
            <CircleCheck size={theme.size.iconSm} color={c.success.text} aria-hidden />
            <Text variant="bodySm" color={c.success.text}>{t("Tudo entendido.")}</Text>
          </View>
        ) : null}
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Lightbulb size={theme.size.iconSm} color={c.fgSubtle} aria-hidden style={styles.fixed} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space["1.5"] }} accessibilityLabel={t("Exemplos")}>
            {EXAMPLES[sport].map((ex) => <Chip key={ex} accessibilityRole="button" label={ex.split("\n")[0]!} onPress={() => onText(ex)} />)}
          </ScrollView>
        </View>
      </Card>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="titleSm" accessibilityRole="header">{sport === "strength" ? t("Exercícios") : t("Etapas")}</Text>
        <BlockList blocks={structure.blocks} sport={sport} onChange={(blocks) => onChange({ v: 1, blocks })} />
      </View>
      {!compact && structure.blocks.length > 0 && <WorkoutSummary structure={structure} sport={sport} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  fixed: { flexShrink: 0 },
});

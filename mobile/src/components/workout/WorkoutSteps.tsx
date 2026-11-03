/**
 * A workout's blocks, read-only (the web's components/WorkoutSteps.tsx): steps with their zone color, series grouped
 * in a dashed box, strength exercises numbered. Targets show the student's own paces and heart rates when the API
 * resolved them (`resolved`, M2), in the zone's text color so they stand out at a glance.
 */
import { StyleSheet, View } from "react-native";
import type { Sport } from "@/api/types";
import { t } from "@/i18n";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui";
import { Repeat } from "@/ui/icons";
import { countText, exerciseText, stepExtras, stepWhat, targetText, zoneOf, type Step, type Structure } from "@/domain/workout";
import { ZoneDot } from "./workout";

function StepRow({ step, sport }: { step: Step; sport: Sport }) {
  const { theme } = useTheme();
  const zone = zoneOf(step, sport);
  const target = targetText(step.target, sport);
  const extras = [stepExtras(step), step.note].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space["1.5"] }]}>
      <View style={{ paddingTop: theme.space["1.5"] }}><ZoneDot zone={zone} /></View>
      <View style={styles.flex}>
        <Text variant="labelMd">{stepWhat(step, sport)}</Text>
        {target ? <Text variant="bodySm" color={theme.color.zone[zone].text} style={styles.strong}>{target}</Text> : null}
        {extras ? <Text variant="bodySm" tone="muted">{extras}</Text> : null}
      </View>
    </View>
  );
}

export function WorkoutSteps({ structure, sport }: { structure: Structure; sport: Sport }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View accessibilityRole="list" style={{ gap: theme.space[2] }}>
      {structure.blocks.map((b, i) =>
        b.kind === "exercise" ? (
          <View key={i} accessibilityRole="none" style={[styles.row, { gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.sunken }]}>
            <Text variant="labelMd" tone="muted" style={styles.tabular}>{i + 1}</Text>
            <View style={styles.flex}>
              <Text variant="labelMd">{b.name}</Text>
              <Text variant="bodySm" tone="muted">{exerciseText(b)}{b.note ? ` · ${b.note}` : ""}</Text>
            </View>
          </View>
        ) : b.kind === "repeat" ? (
          <View key={i} style={[styles.repeat, { gap: theme.space["0.5"], padding: theme.space[3], paddingTop: theme.space[2], borderRadius: theme.radius.md, borderColor: c.lineStrong }]}>
            <View style={[styles.row, styles.center, { gap: theme.space["1.5"] }]}>
              <Repeat size={theme.size.iconSm} color={c.fgMuted} aria-hidden />
              <Text variant="labelSm">{t("{n}× série", { n: countText(b) })}</Text>
              {b.note ? <Text variant="bodySm" tone="muted" style={styles.flex}>· {b.note}</Text> : null}
            </View>
            {b.steps.map((s, j) => <StepRow key={j} step={s} sport={sport} />)}
          </View>
        ) : (
          <View key={i} style={{ paddingHorizontal: theme.space[1] }}><StepRow step={b} sport={sport} /></View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  center: { alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  repeat: { borderWidth: 1, borderStyle: "dashed" },
  strong: { fontWeight: weight("semibold") },
  tabular: { fontVariant: ["tabular-nums"] },
});

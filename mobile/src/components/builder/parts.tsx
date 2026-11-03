/**
 * Builder pieces (W5): a number field that keeps what's typed until it parses, toggle chips, the sport picker, the
 * hashtag editor and the live summary (estimate, intensity profile, time per zone). The web's
 * components/builder/{WorkoutBuilder,TagInput}.tsx, phone-sized.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from "react-native";
import type { Sport } from "@/api/types";
import { SPORT_ICON, SPORT_LABEL } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import { MAX_TAGS, cleanTags } from "@/domain/tags";
import { estimate, segments, type Structure, type ZoneN } from "@/domain/workout";
import { t } from "@/i18n";
import { distance, duration } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Input, Text, type Icon } from "@/ui";
import { Check, X } from "@/ui/icons";

export const SPORTS: Sport[] = ["run", "swim", "bike", "strength", "mobility", "other"];

/**
 * A number typed as text ("4:30", "1,5", "10:00"): what's typed stays as typed; the value changes only when it parses.
 * `optional`: emptying it gives undefined.
 */
export function ValueInput({ label, value, format, parse, onChange, optional, keyboardType = "numbers-and-punctuation", placeholder, style }: {
  label: string; value: number | undefined; format: (n: number) => string; parse: (s: string) => number | null; onChange: (n: number | undefined) => void;
  optional?: boolean; keyboardType?: KeyboardTypeOptions; placeholder?: string; style?: StyleProp<ViewStyle>;
}) {
  const [text, setText] = useState(value === undefined ? "" : format(value));
  const [bad, setBad] = useState(false);
  const change = (s: string) => {
    setText(s);
    if (!s.trim()) { setBad(!optional); if (optional) onChange(undefined); return; }
    const n = parse(s);
    setBad(n === null);
    if (n !== null) onChange(n);
  };
  return (
    <Input value={text} onChangeText={change} invalid={bad} accessibilityLabel={label} placeholder={placeholder} keyboardType={keyboardType}
      autoCorrect={false} autoCapitalize="none" selectTextOnFocus style={[styles.tabular, style]}
      onBlur={() => { if (bad && value !== undefined) { setText(format(value)); setBad(false); } }} />
  );
}

/** A pill that's on or off (equipment, filters, suggestions). */
export function Chip({ label, on, onPress, icon: I, accessibilityRole = "checkbox" }: { label: string; on?: boolean; onPress: () => void; icon?: Icon; accessibilityRole?: "checkbox" | "radio" | "button" }) {
  const { theme } = useTheme();
  const c = theme.color;
  const h = theme.space[8] + theme.space[1];
  return (
    <Pressable onPress={onPress} accessibilityRole={accessibilityRole} accessibilityState={accessibilityRole === "button" ? undefined : { checked: !!on }} accessibilityLabel={label}
      hitSlop={(theme.size.touchMin - h) / 2}
      style={({ pressed }) => [styles.row, {
        height: h, gap: theme.space["1.5"], paddingHorizontal: theme.space[3], borderRadius: theme.radius.full, borderWidth: 1,
        borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
      }]}>
      {I ? <I size={theme.size.iconSm} color={on ? c.brand.subtleFg : c.fgMuted} aria-hidden /> : null}
      <Text variant="labelSm" color={on ? c.brand.subtleFg : c.fgMuted} numberOfLines={1} style={styles.semibold}>{label}</Text>
    </Pressable>
  );
}

/** The workout's sport, as a scrolling row of chips (only the club's modalities, plus the current one). */
export function SportPicker({ value, onChange, allowed }: { value: Sport; onChange: (s: Sport) => void; allowed?: Sport[] }) {
  const { theme } = useTheme();
  const list = SPORTS.filter((s) => !allowed || allowed.includes(s) || s === value);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={t("Modalidade")}
      style={{ marginHorizontal: -theme.space[4], flexGrow: 0 }} contentContainerStyle={{ gap: theme.space["1.5"], paddingHorizontal: theme.space[4] }}>
      {list.map((s) => <Chip key={s} accessibilityRole="radio" label={t(SPORT_LABEL[s])} icon={SPORT_ICON[s]} on={value === s} onPress={() => onChange(s)} />)}
    </ScrollView>
  );
}

/** Hashtags (§ Tags): type "limiar" or "#limiar", a space, comma or Enter adds it; tap a tag to remove it. */
export function TagInput({ value, onChange, suggestions = [], label }: { value: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; label: string }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_TAGS;
  const commit = (raw = draft) => { if (raw.trim()) onChange(cleanTags([...value, ...raw.split(/[\s,]+/)])); setDraft(""); };
  // While typing: the matching tags; before that, only the club's most used few.
  const open = suggestions.filter((s) => !value.includes(s) && (!draft.trim() || s.includes(draft.trim().replace(/^#/, "").toLowerCase()))).slice(0, draft.trim() ? 8 : 4);
  return (
    <View style={{ gap: theme.space[2] }}>
      {value.length > 0 && (
        <View style={[styles.wrap, { gap: theme.space["1.5"] }]}>
          {value.map((tag) => (
            <Pressable key={tag} onPress={() => onChange(value.filter((x) => x !== tag))} accessibilityRole="button" accessibilityLabel={t("Remover #{tag}", { tag })}
              hitSlop={theme.space[1]}
              style={({ pressed }) => [styles.row, { height: theme.space[8], gap: theme.space[1], paddingLeft: theme.space[3], paddingRight: theme.space[2], borderRadius: theme.radius.full, backgroundColor: pressed ? c.soft : c.sunken }]}>
              <Text variant="labelSm" style={styles.semibold}>#{tag}</Text>
              <X size={theme.size.iconSm - 2} color={c.fgMuted} aria-hidden />
            </Pressable>
          ))}
        </View>
      )}
      <Input value={draft} editable={!full} accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} returnKeyType="done"
        placeholder={full ? t("Máximo de {n} tags", { n: MAX_TAGS }) : value.length ? t("Outra tag") : "#intervalado #pista"}
        onChangeText={(v) => { if (/[\s,]$/.test(v)) commit(v); else setDraft(v); }} onSubmitEditing={() => commit()} onBlur={() => commit()} />
      {!full && open.length > 0 && (
        <View style={[styles.wrap, { gap: theme.space["1.5"] }]}>
          {open.map((s) => <Chip key={s} accessibilityRole="button" label={`#${s}`} onPress={() => commit(s)} />)}
        </View>
      )}
    </View>
  );
}

/** Estimated duration and distance, the intensity profile and the time per zone (the web's WorkoutSummary). */
export function WorkoutSummary({ structure, sport }: { structure: Structure; sport: Sport }) {
  const { theme } = useTheme();
  const c = theme.color;
  const est = estimate(structure, sport);
  const zones = useMemo(() => {
    const acc: Record<ZoneN, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const s of segments(structure, sport)) acc[s.zone] += s.seconds;
    const total = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
    return ([1, 2, 3, 4, 5] as ZoneN[]).map((z) => ({ z, pct: Math.round((acc[z] / total) * 100), s: acc[z] }));
  }, [structure, sport]);
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <IntensityProfile structure={structure} sport={sport} height={theme.space[16]} />
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <View style={styles.flex}>
          <Text variant="caption" tone="muted">{t("Duração estimada")}</Text>
          <Text variant="metricMd">{est.duration_s ? duration(est.duration_s) : "–"}</Text>
        </View>
        <View style={styles.flex}>
          <Text variant="caption" tone="muted">{t("Distância estimada")}</Text>
          <Text variant="metricMd">{est.distance_m ? distance(est.distance_m, { swim: sport === "swim" }) : "–"}</Text>
        </View>
      </View>
      {sport !== "strength" && sport !== "mobility" && est.duration_s > 0 && (
        <View style={{ gap: theme.space["1.5"] }}>
          <Text variant="caption" tone="muted">{t("Tempo por zona")}</Text>
          <View style={[styles.row, { height: theme.space[2] + theme.space["0.5"], overflow: "hidden", borderRadius: theme.radius.full, backgroundColor: c.soft }]}>
            {zones.map((x) => (x.pct > 0 ? <View key={x.z} style={{ width: `${x.pct}%`, height: "100%", backgroundColor: c.zone[x.z].solid }} /> : null))}
          </View>
          <View style={[styles.wrap, { columnGap: theme.space[3], rowGap: theme.space[1] }]}>
            {zones.filter((x) => x.s > 0).map((x) => (
              <View key={x.z} style={[styles.row, { gap: theme.space[1] }]}>
                <View aria-hidden style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.xs, backgroundColor: c.zone[x.z].solid }} />
                <Text variant="caption" tone="muted" style={styles.tabular}>Z{x.z} {duration(x.s)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

/** A small "on" check for selected rows. */
export function OnMark({ on }: { on: boolean }) {
  const { theme } = useTheme();
  return on ? <Check size={theme.size.iconMd} color={theme.color.brand.subtleFg} aria-hidden /> : null;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ["tabular-nums"] },
  semibold: { fontWeight: weight("semibold") },
});

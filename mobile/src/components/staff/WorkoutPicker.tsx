/**
 * Pick a workout from the library or build one now → a draft (sport, title, structure, estimates), the web's
 * components/builder/WorkoutPicker for the phone. Used by the planilha editor (W7); a workout from the library keeps
 * its template id, one built here doesn't. "Montar agora" starts from the current workout, so it can be tweaked.
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTemplates } from "@/api/staff";
import type { Club, Sport } from "@/api/types";
import { SportPicker } from "@/components/builder/parts";
import { WorkoutBuilder } from "@/components/builder/WorkoutBuilder";
import { emptyStructure } from "@/domain/builder";
import { estimate, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Field, Input, Segmented, Text } from "@/ui";
import { Library, Wand2 } from "@/ui/icons";
import { TemplateList } from "./pickers";

export interface WorkoutDraft { sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null; template_id: string | null }

export function WorkoutPicker({ club, initial, onChange }: { club: Pick<Club, "id" | "modalities">; initial?: WorkoutDraft | null; onChange: (d: WorkoutDraft | null) => void }) {
  const { theme } = useTheme();
  const [source, setSource] = useState<"library" | "build">(initial && !initial.template_id ? "build" : "library");
  const [templateId, setTemplateId] = useState<string | null>(initial?.template_id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sport, setSport] = useState<Sport>(initial?.sport ?? club.modalities[0] ?? "run");
  const [structure, setStructure] = useState<Structure>(initial?.structure ?? emptyStructure());
  const templates = useTemplates(club.id);
  useEffect(() => {
    if (source === "library") {
      const w = templates.data?.find((x) => x.id === templateId);
      onChange(w ? { sport: w.sport, title: w.name, structure: w.structure, est_duration_s: w.est_duration_s, est_distance_m: w.est_distance_m, template_id: w.id } : null);
    } else {
      const e = estimate(structure, sport);
      onChange(title.trim() && structure.blocks.length ? { sport, title: title.trim(), structure, est_duration_s: e.duration_s || null, est_distance_m: e.distance_m, template_id: null } : null);
    }
  }, [source, templateId, title, sport, structure, templates.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ gap: theme.space[3] }}>
      <Segmented<"library" | "build"> label={t("Origem do treino")} value={source} style={styles.stretch}
        onChange={(v) => {
          // Building from a library pick starts from that workout.
          if (v === "build" && !title && templateId) {
            const w = templates.data?.find((x) => x.id === templateId);
            if (w) { setTitle(w.name); setSport(w.sport); setStructure(w.structure); }
          }
          setSource(v);
        }}
        options={[{ value: "library", label: t("Da biblioteca"), icon: Library }, { value: "build", label: t("Montar agora"), icon: Wand2 }]} />
      {source === "library" ? (
        <TemplateList clubId={club.id} selectedId={templateId} onPick={(w) => setTemplateId(w.id)} />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Field label={t("Nome do treino")}>
            {(f) => <Input {...f} value={title} onChangeText={setTitle} placeholder={t("Ex.: Rodagem 40′")} maxLength={120} />}
          </Field>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="labelSm">{t("Modalidade")}</Text>
            <SportPicker value={sport} allowed={club.modalities} onChange={(x) => { setSport(x); if (x === "strength" || sport === "strength") setStructure(emptyStructure()); }} />
          </View>
          <WorkoutBuilder compact sport={sport} structure={structure} onChange={setStructure} />
          {!(title.trim() && structure.blocks.length) && <Text variant="caption" tone="muted">{t("Dê um nome e pelo menos uma etapa.")}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ stretch: { alignSelf: "stretch" } });

/**
 * Around the builder: "Descrever com IA" (W17, POST /ai/workout: a sentence → structure, what wasn't understood shown
 * as the web does) and the .FIT file for a watch (the web's FitExport, through the share sheet here).
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAiWorkout, type AiWorkout } from "@/api/ai";
import type { Sport } from "@/api/types";
import { stepText, type Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { encodeFitWorkout } from "@/lib/fit";
import { shareBinaryFile } from "@/lib/files";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, Text, Textarea, toast, type ButtonSize, type ButtonVariant } from "@/ui";
import { CircleAlert, Share2, Sparkles, Watch } from "@/ui/icons";

const AI_EXAMPLES: Partial<Record<Sport, string>> = {
  run: "15 min de aquecimento, 6 tiros de 800 m a 4:10 com 2 min de trote e 10 min de desaquecimento",
  swim: "10x100 metros com 20 s de descanso",
  bike: "15 min leve, 4x8 min a 95% do FTP com 4 min leve e 10 min de desaquecimento",
  strength: "agachamento 4x10 com 40 kg, remada curvada 3x12 e prancha 3x30",
};

export function AiDescribe({ clubId, sport, onResult }: { clubId: string; sport: Sport; onResult: (w: AiWorkout) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const ai = useAiWorkout(clubId);
  const [text, setText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const err = ai.error instanceof ApiError ? ai.error : null;
  const go = () => ai.mutate({ text, sport }, {
    onSuccess: (w) => { onResult(w); setSkipped(w.warnings ?? []); toast.success(t("Treino montado"), t("Confira as etapas e ajuste o que precisar.")); },
    onError: (e) => { setSkipped([]); if (!(e instanceof ApiError && e.status === 422)) toast.error(e); },
  });
  return (
    <Card edge="brand" style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Sparkles size={theme.size.iconMd} color={c.accent.text} aria-hidden />
        <Text variant="titleSm" accessibilityRole="header">{t("Descrever com IA")}</Text>
      </View>
      <Text variant="bodySm" tone="muted">{t("Escreva do seu jeito; a gente monta as etapas.")}</Text>
      <Textarea value={text} onChangeText={setText} accessibilityLabel={t("Descrição do treino")} placeholder={AI_EXAMPLES[sport] ?? AI_EXAMPLES.run} />
      {err?.status === 422 ? <Text variant="bodySm" color={c.danger.text} accessibilityRole="alert">{err.title}. {err.detail}</Text> : null}
      {!err && skipped.length > 0 ? (
        <View style={[styles.row, styles.top, { gap: theme.space[2] }]}>
          <CircleAlert size={theme.size.iconSm} color={c.warning.text} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
          <Text variant="bodySm" color={c.warning.text} style={styles.flex}>{t("Não entendi: {x}. O resto foi aplicado.", { x: skipped.map((w) => `“${w}”`).join(", ") })}</Text>
        </View>
      ) : null}
      <Button size="sm" icon={Sparkles} loading={ai.isPending} disabled={text.trim().length < 5} onPress={go} style={styles.end}>{t("Montar treino")}</Button>
    </Card>
  );
}

const slug = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "treino";

/** "Levar para o relógio": the workout as a .FIT file, with how to put it on a Garmin (until the Garmin sync exists). */
export function FitButton({ name, sport, structure, size = "md", variant = "secondary", label }: { name: string; sport: Sport; structure: Structure; size?: ButtonSize; variant?: ButtonVariant; label?: string }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const empty = structure.blocks.length === 0;
  const go = async () => {
    const bytes = encodeFitWorkout(name || t("Treino"), sport, structure, (s) => stepText(s, sport));
    const ok = await shareBinaryFile(`${slug(name)}.fit`, bytes, "application/vnd.ant.fit", t("Treino para o relógio"));
    if (!ok) toast.error(new ApiError(0, "share", t("Não foi possível compartilhar"), t("Este aparelho não compartilha arquivos.")));
    setOpen(false);
  };
  return (
    <>
      <Button size={size} variant={variant} icon={Watch} disabled={empty} onPress={() => setOpen(true)}>{label ?? t("Levar para o relógio")}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("Treino no relógio")} description={name || null}
        footer={<>
          <Button variant="ghost" onPress={() => setOpen(false)}>{t("Cancelar")}</Button>
          <Button icon={Share2} onPress={() => void go()}>{t("Compartilhar arquivo .FIT")}</Button>
        </>}>
        <View style={{ gap: theme.space[2] }}>
          {[t("Compartilhe o arquivo .FIT do treino (salve no Drive ou envie para o computador)."), t("Conecte o relógio Garmin ao computador pelo cabo USB."), t("Copie o arquivo para a pasta GARMIN/NewFiles do relógio."), t("Desconecte: o treino aparece em Treinos no relógio.")].map((s, i) => (
            <View key={i} style={[styles.row, styles.top, { gap: theme.space[2] }]}>
              <Text variant="labelMd" tone="muted" style={styles.tabular}>{i + 1}.</Text>
              <Text style={styles.flex}>{s}</Text>
            </View>
          ))}
          <Text variant="bodySm" tone="muted">{t("Em breve: envio direto pelo app, sem cabo.")}</Text>
        </View>
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
  end: { alignSelf: "flex-end" },
  tabular: { fontVariant: ["tabular-nums"] },
});

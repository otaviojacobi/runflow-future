/**
 * W14 · Avaliações e testes (the web's screens/staff/Assessments.tsx): pick a protocol to record a test with the
 * result computed live (and the zones it would create), apply the zones to the student, and the history with the
 * change since that student's previous test of the same kind. `?athlete=<membership id>` filters to one student
 * (from the student's page).
 */
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAssessments, useCreateAssessment, useDeleteAssessment } from "@/api/assessments";
import { useAthletes } from "@/api/staff";
import type { Assessment, AssessmentData, AssessmentKind, Club } from "@/api/types";
import { ConfirmDialog, ZoneTable } from "@/components/account/parts";
import { brToIso, isoToBr, maskClock, maskDate, parseClock } from "@/components/account/inputs";
import { ASSESSMENT_NAME as NAME, PROTOCOLS, headline, type Protocol } from "@/components/assessments";
import { ZONE_KIND, computeAssessment, zonesFrom } from "@/domain/assessments";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { has, testsFor } from "@/lib/features";
import { fullDate, number, today as todayFn } from "@/lib/format";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Screen, Select, Skeleton, Switch, Text, Textarea, toast } from "@/ui";
import { ChevronRight, Gauge, Trash2 } from "@/ui/icons";

export default function AssessmentsScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const params = useLocalSearchParams<{ athlete?: string }>();
  const [athlete, setAthlete] = useState(params.athlete ?? "");
  const [kind, setKind] = useState("");
  const [record, setRecord] = useState<AssessmentKind | null>(null);
  const [remove, setRemove] = useState<Assessment | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const athletes = useAthletes(club?.id);
  const list = useAssessments(club?.id, { membership_id: athlete || undefined, kind: kind || undefined });
  const del = useDeleteAssessment(club?.id ?? "");
  // Change vs the previous test of the same kind (and exercise) for the same athlete.
  const deltas = useMemo(() => {
    const m = new Map<string, number | null>();
    const last = new Map<string, number>();
    for (const a of [...(list.data ?? [])].reverse()) {
      const key = `${a.membership_id}|${a.kind}|${a.data.exercise ?? ""}`;
      const v = headline(a.kind, a.result, a.data).value;
      m.set(a.id, v != null && last.has(key) ? v - last.get(key)! : null);
      if (v != null) last.set(key, v);
    }
    return m;
  }, [list.data]);
  if (!club) return null;
  const refresh = async () => { setRefreshing(true); await list.refetch(); setRefreshing(false); };
  const athleteOptions = [{ value: "", label: t("Todos os alunos") }, ...(athletes.data ?? []).map((a) => ({ value: a.membership.id, label: a.user.name }))];
  // Only the tests of the club's modalities (D-052): Cooper for running, CSS for swimming, 1RM for the gym…
  const allowed = new Set(testsFor(club, PROTOCOLS.map((p) => p.kind)));
  const protocols = PROTOCOLS.filter((p) => allowed.has(p.kind));
  const kindOptions = [{ value: "", label: t("Todos os testes") }, ...protocols.map((p) => ({ value: p.kind as string, label: t(p.name) }))];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{has(club, "zones") ? t("Registre testes de campo e avaliações físicas. Os testes podem atualizar as zonas do aluno na hora.") : t("Registre testes e avaliações físicas e acompanhe a evolução de cada aluno.")}</Text>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="titleMd" accessibilityRole="header">{t("Registrar")}</Text>
        <Card style={{ padding: theme.space[1] }}>
          {protocols.map((p) => <ProtocolRow key={p.kind} p={p} onPress={() => setRecord(p.kind)} />)}
        </Card>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="titleMd" accessibilityRole="header">{t("Histórico")}</Text>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Select<string> style={styles.flex} title={t("Aluno")} accessibilityLabel={t("Aluno")} value={athlete} onChange={setAthlete} options={athleteOptions} />
          <Select<string> style={styles.flex} title={t("Tipo")} accessibilityLabel={t("Tipo")} value={kind} onChange={setKind} options={kindOptions} />
        </View>
        {list.isPending ? <Skeleton style={{ height: theme.space[20] * 2 }} /> : !list.data?.length ? (
          <Card><EmptyState icon={Gauge} title={t("Nenhuma avaliação ainda")}>{t("Escolha um protocolo acima para registrar a primeira.")}</EmptyState></Card>
        ) : (
          <Card style={{ padding: theme.space[1] }}>
            {list.data.map((a, i) => <Row key={a.id} a={a} delta={deltas.get(a.id) ?? null} divider={i > 0} onDelete={() => setRemove(a)} />)}
          </Card>
        )}
      </View>

      <RecordSheet club={club} kind={record} athleteId={athlete} onClose={() => setRecord(null)} />
      <ConfirmDialog open={!!remove} onOpenChange={(v) => { if (!v) setRemove(null); }} title={t("Apagar esta avaliação?")} confirmLabel={t("Apagar")} loading={del.isPending}
        description={remove ? `${t(NAME[remove.kind])} · ${remove.athlete.user.name} · ${fullDate(remove.date)}` : null}
        onConfirm={() => remove && del.mutate(remove.id, { onSuccess: () => { setRemove(null); toast.success(t("Avaliação apagada")); }, onError: toast.error })}>
        <Text tone="muted">{t("As zonas que este teste criou continuam valendo.")}</Text>
      </ConfirmDialog>
    </Screen>
  );
}

/** A protocol to record: icon, name, how it's done and, for tests that set zones, which ones. */
function ProtocolRow({ p, onPress }: { p: Protocol; onPress: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: pressed ? c.soft : "transparent" }]}>
      <View style={[styles.center, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.lg, backgroundColor: c.brand.subtle }]}>
        <p.icon size={theme.size.iconMd} color={c.brand.subtleFg} aria-hidden />
      </View>
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="labelMd">{t(p.name)}</Text>
        <Text variant="bodySm" tone="muted">{t(p.how)}</Text>
        {p.zones ? <Text variant="caption" color={c.brand.text} style={{ fontWeight: weight("semibold") }}>{t("Atualiza {z}", { z: t(p.zones) })}</Text> : null}
      </View>
      <ChevronRight size={theme.size.iconMd} color={c.fgSubtle} aria-hidden />
    </Pressable>
  );
}

function Row({ a, delta, divider, onDelete }: { a: Assessment; delta: number | null; divider: boolean; onDelete: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const h = headline(a.kind, a.result, a.data);
  const good = delta != null && delta !== 0 && h.better ? (h.better === "up" ? delta > 0 : delta < 0) : null;
  const fmtDelta = (d: number) => (a.kind === "css" ? `${d > 0 ? "+" : "−"}${number(Math.abs(d), 1)} s` : `${d > 0 ? "+" : "−"}${number(Math.abs(d), 1)}`);
  return (
    <View style={[styles.row, styles.top, { gap: theme.space[3], padding: theme.space[3], borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }]}>
      <Avatar name={a.athlete.user.name} src={a.athlete.user.avatar_url} size={theme.space[8]} />
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="labelMd" numberOfLines={1}>{a.athlete.user.name}</Text>
        <Text variant="caption" tone="muted">{t(NAME[a.kind])} · {fullDate(a.date)}</Text>
        <Text variant="bodySm" style={styles.tabular}>{h.text}</Text>
        {a.notes ? <Text variant="caption" tone="muted">{a.notes}</Text> : null}
        <View style={[styles.row, { gap: theme.space[2], marginTop: theme.space["0.5"] }]}>
          {a.zones && <Badge tone="success">{t("Zonas aplicadas")}</Badge>}
          {delta != null && delta !== 0 ? (
            <Text variant="labelSm" color={good === true ? c.success.text : good === false ? c.danger.text : c.fgMuted} style={[styles.tabular, { fontWeight: weight("semibold") }]}
              accessibilityLabel={t("Variação desde o teste anterior: {d}", { d: fmtDelta(delta) })}>{fmtDelta(delta)}</Text>
          ) : null}
        </View>
      </View>
      <IconButton icon={Trash2} label={t("Apagar avaliação")} onPress={onDelete} />
    </View>
  );
}

// ---------------------------------------------------------------- record
function RecordSheet({ club, kind, athleteId, onClose }: { club: Club; kind: AssessmentKind | null; athleteId: string; onClose: () => void }) {
  return kind ? <RecordBody key={kind} club={club} kind={kind} athleteId={athleteId} onClose={onClose} /> : null;
}

type FieldSpec = { key: string; label: string; placeholder?: string; hint?: string; optional?: boolean; mode: "int" | "decimal" | "text" | "clock" };
const FIELDS: Record<AssessmentKind, FieldSpec[]> = {
  body: [
    { key: "weight_kg", label: "Peso (kg)", placeholder: "68,5", mode: "decimal" }, { key: "height_cm", label: "Altura (cm)", placeholder: "172", mode: "int" },
    { key: "body_fat_pct", label: "Gordura (%)", optional: true, mode: "decimal" }, { key: "waist_cm", label: "Cintura (cm)", optional: true, mode: "decimal" },
    { key: "resting_hr", label: "FC de repouso (bpm)", optional: true, mode: "int" },
  ],
  cooper: [{ key: "distance_m", label: "Distância em 12 min (m)", placeholder: "2800", mode: "int" }],
  run_3k: [{ key: "time", label: "Tempo dos 3 km", placeholder: "12:30", mode: "clock" }],
  css: [{ key: "t400", label: "Tempo dos 400 m", placeholder: "6:20", mode: "clock" }, { key: "t200", label: "Tempo dos 200 m", placeholder: "2:58", mode: "clock" }],
  ftp: [{ key: "avg_power_w", label: "Potência média em 20 min (W)", placeholder: "240", mode: "int" }],
  one_rm: [
    { key: "exercise", label: "Exercício", placeholder: "Ex.: Agachamento livre", mode: "text" }, { key: "weight_kg", label: "Carga (kg)", mode: "decimal" },
    { key: "reps", label: "Repetições até a falha", placeholder: "5", hint: "De 1 a 15. Quanto menos repetições, mais preciso.", mode: "int" },
  ],
  hr_max: [{ key: "max_hr", label: "FC máxima (bpm)", placeholder: "186", mode: "int" }],
};

function RecordBody({ club, kind, athleteId, onClose }: { club: Club; kind: AssessmentKind; athleteId: string; onClose: () => void }) {
  const { theme } = useTheme();
  const athletes = useAthletes(club.id);
  const create = useCreateAssessment(club.id);
  const today = todayFn(club.timezone);
  const [open, setOpen] = useState(true);
  const [who, setWho] = useState(athleteId);
  const [date, setDate] = useState(isoToBr(today));
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [apply, setApply] = useState(true);
  const [notes, setNotes] = useState("");
  const protocol = PROTOCOLS.find((p) => p.kind === kind)!;
  const num = (k: string) => (raw[k] ? Number(raw[k]!.replace(",", ".")) : undefined);
  const clockOf = (k: string) => (raw[k] ? parseClock(raw[k]!) ?? undefined : undefined);
  const data: AssessmentData = {
    body: { weight_kg: num("weight_kg"), height_cm: num("height_cm"), body_fat_pct: num("body_fat_pct"), waist_cm: num("waist_cm"), resting_hr: num("resting_hr") },
    cooper: { distance_m: num("distance_m") },
    run_3k: { time_s: clockOf("time") },
    css: { t400_s: clockOf("t400"), t200_s: clockOf("t200") },
    ftp: { avg_power_w: num("avg_power_w") },
    one_rm: { exercise: raw.exercise, weight_kg: num("weight_kg"), reps: num("reps") },
    hr_max: { max_hr: num("max_hr") },
  }[kind];
  const result = computeAssessment(kind, data);
  const zoneKind = ZONE_KIND[kind];
  const preview = result ? zonesFrom(kind, result) : null;
  const iso = brToIso(date);
  const dateError = iso === null ? t("Use o formato dd/mm/aaaa, como 14/09/2026.") : iso > today ? t("A data não pode estar no futuro.") : null;
  const err = create.error instanceof ApiError ? create.error : null;
  const close = () => { setOpen(false); onClose(); };
  const submit = () => {
    if (!iso || dateError) return;
    create.mutate({ membership_id: who, kind, date: iso, data, notes: notes.trim() || undefined, apply_zones: !!zoneKind && apply }, {
      onSuccess: (a) => { toast.success(t("Avaliação registrada"), a.zones ? t("As zonas de {name} foram atualizadas.", { name: a.athlete.user.name.split(" ")[0] }) : undefined); close(); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  const input = (f: FieldSpec) => (
    <Field key={f.key} label={t(f.label)} optional={f.optional} hint={f.hint ? t(f.hint) : f.mode === "clock" ? t("min:s ou h:min:s") : null} error={err?.fieldError(`data.${f.key}`)}>
      {(a) => <Input {...a} value={raw[f.key] ?? ""} placeholder={f.placeholder ? t(f.placeholder) : undefined}
        onChangeText={(v) => setRaw((r) => ({ ...r, [f.key]: f.mode === "clock" ? maskClock(v) : v }))}
        keyboardType={f.mode === "int" || f.mode === "clock" ? "number-pad" : f.mode === "decimal" ? "decimal-pad" : "default"}
        autoCapitalize={f.mode === "text" ? "sentences" : "none"} />}
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }} title={t(protocol.name)} description={t(protocol.how)}
      footer={<>
        <Button variant="secondary" size="lg" onPress={close}>{t("Cancelar")}</Button>
        <Button size="lg" style={styles.flex} disabled={!who || !result || !!dateError} loading={create.isPending} onPress={submit}>{t("Registrar")}</Button>
      </>}>
      <View style={{ gap: theme.space[4] }}>
        <Field label={t("Aluno")} error={err?.fieldError("membership_id")}>
          {(a) => <Select<string> {...a} title={t("Aluno")} placeholder={t("Escolha…")} value={who || null} onChange={setWho}
            options={(athletes.data ?? []).map((x) => ({ value: x.membership.id, label: x.user.name }))} />}
        </Field>
        <Field label={t("Data")} hint={dateError ? null : t("dd/mm/aaaa")} error={dateError ?? err?.fieldError("date")}>
          {(a) => <Input {...a} value={date} onChangeText={(v) => setDate(maskDate(v))} placeholder="03/11/2026" keyboardType="number-pad" maxLength={10} />}
        </Field>
        {FIELDS[kind].map(input)}
        <View accessibilityLiveRegion="polite" style={{ gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.color.sunken }}>
          <Text variant="overline" tone="muted">{t("Resultado")}</Text>
          {result ? <Text variant="titleLg" style={styles.tabular}>{headline(kind, result, data).text}</Text>
            : <Text variant="bodySm" tone="muted">{t("Preencha os campos para ver o resultado.")}</Text>}
          {preview && zoneKind && <ZoneTable z={{ bounds: preview }} unit={zoneKind} />}
        </View>
        {zoneKind && <Switch checked={apply} onCheckedChange={setApply} label={t("Atualizar as zonas do aluno com este teste")} description={t("Os treinos com alvo por zona passam a usar os novos valores.")} />}
        <Field label={t("Observações")} optional>
          {(a) => <Textarea {...a} value={notes} onChangeText={setNotes} placeholder={t("Ex.: vento forte, pista molhada")} maxLength={1000} />}
        </Field>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ["tabular-nums"] },
});

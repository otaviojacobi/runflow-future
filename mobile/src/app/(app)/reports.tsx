/**
 * W16 · Relatórios (the web's screens/staff/Reports.tsx): compliance and volume per student or group for a period,
 * the weekly trend, and the per-student rows. Exports through the share sheet: CSV for spreadsheets (";", decimal
 * comma, UTF-8 BOM) and a PDF rendered on the phone (expo-print).
 */
import { tokens } from "@runflow/design/tokens";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTrainingReport } from "@/api/reports";
import { useGroups } from "@/api/staff";
import type { Club, TrainingReport } from "@/api/types";
import { brToIso, isoToBr, maskDate } from "@/components/account/inputs";
import { ComplianceTrend } from "@/components/staff/ComplianceTrend";
import { ComplianceBar, FilterChips } from "@/components/staff/workout";
import { t } from "@/i18n";
import { shareCsv } from "@/lib/csv";
import { useClub } from "@/lib/club";
import { has } from "@/lib/features";
import { addDays, duration, fullDate, km, mondayOf, today as todayFn } from "@/lib/format";
import { sharePdf } from "@/lib/pdf";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, Field, Input, Screen, Segmented, Select, Skeleton, Text, toast } from "@/ui";
import { Download, Printer, ShieldOff } from "@/ui/icons";

type Preset = "4w" | "month" | "last_month" | "3m" | "custom";
function range(p: Preset, today: string): { from: string; to: string } {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  if (p === "month") return { from: first(y, m), to: today };
  if (p === "last_month") return { from: first(y, m - 1), to: addDays(first(y, m), -1) };
  if (p === "3m") return { from: addDays(mondayOf(today), -7 * 12), to: today };
  return { from: addDays(mondayOf(today), -21), to: today };
}
const pct = (v: number | null) => (v == null ? "–" : `${v}%`);

export default function ReportsScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const today = todayFn(club?.timezone);
  const [preset, setPreset] = useState<Preset>("4w");
  const [custom, setCustom] = useState(() => { const r = range("4w", today); return { from: isoToBr(r.from), to: isoToBr(r.to) }; });
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const groups = useGroups(club?.id);
  const customIso = { from: brToIso(custom.from), to: brToIso(custom.to) };
  const customError = preset !== "custom" ? null
    : !customIso.from || !customIso.to ? t("Use o formato dd/mm/aaaa.")
    : customIso.from > customIso.to ? t("O início vem antes do fim.")
    : customIso.to > today ? t("A data não pode estar no futuro.") : null;
  const period = preset === "custom" ? (customError ? range("4w", today) : { from: customIso.from!, to: customIso.to! }) : range(preset, today);
  const f = { ...period, group_id: group || undefined };
  const training = useTrainingReport(club?.id, f);
  if (!club) return null;
  const groupName = group ? groups.data?.find((g) => g.id === group)?.name ?? "" : t("Todos os alunos");
  const r = training.data;
  const refresh = async () => { setRefreshing(true); await training.refetch(); setRefreshing(false); };
  const run = async (kind: "csv" | "pdf") => {
    if (!r) return;
    setBusy(kind);
    try {
      const ok = kind === "csv" ? await csvTraining(club, r) : await sharePdf(reportHtml(club, r, groupName), t("Relatório de treinos"));
      if (!ok) toast.info(t("Não dá para compartilhar arquivos neste aparelho."));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{fullDate(f.from)} – {fullDate(f.to)} · {groupName}</Text>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Button variant="secondary" icon={Download} style={styles.flex} loading={busy === "csv"} disabled={!r} onPress={() => void run("csv")}>{t("CSV")}</Button>
        <Button variant="secondary" icon={Printer} style={styles.flex} loading={busy === "pdf"} disabled={!r} onPress={() => void run("pdf")}>{t("PDF")}</Button>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Field label={t("Período")}>
          {(a) => <Select<Preset> {...a} title={t("Período")} value={preset} onChange={setPreset}
            options={[{ value: "4w", label: t("4 semanas") }, { value: "month", label: t("Este mês") }, { value: "last_month", label: t("Mês passado") }, { value: "3m", label: t("3 meses") }, { value: "custom", label: t("Outro período") }]} />}
        </Field>
        {preset === "custom" && (
          <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
            <Field label={t("De")} error={customError} style={styles.flex}>
              {(a) => <Input {...a} value={custom.from} onChangeText={(v) => setCustom({ ...custom, from: maskDate(v) })} placeholder="01/10/2026" keyboardType="number-pad" maxLength={10} />}
            </Field>
            <Field label={t("Até")} style={styles.flex}>
              {(a) => <Input {...a} value={custom.to} onChangeText={(v) => setCustom({ ...custom, to: maskDate(v) })} placeholder="31/10/2026" keyboardType="number-pad" maxLength={10} />}
            </Field>
          </View>
        )}
        {(groups.data?.length ?? 0) > 0 && (
          <FilterChips<string> label={t("Grupo")} value={group} onChange={setGroup} items={[{ value: "", label: t("Todos") }, ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} />
        )}
      </View>

      {r ? <Training r={r} volume={has(club, "strava")} /> : <Skeleton style={{ height: theme.space[20] * 4 }} />}
    </Screen>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { theme } = useTheme();
  return (
    <Card style={[styles.half, { padding: theme.space[3], gap: theme.space["0.5"] }]} accessible accessibilityLabel={[label, value, sub].filter(Boolean).join(", ")}>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      <Text variant="metricMd" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{value}</Text>
      {sub ? <Text variant="caption" tone="muted" numberOfLines={2}>{sub}</Text> : null}
    </Card>
  );
}

/** `volume`: time and distance from synced activities, only for clubs whose modalities sync them (D-052). */
function Training({ r, volume }: { r: TrainingReport; volume: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const rows = useMemo(() => [...r.athletes].sort((a, b) => (sort === "name" ? a.user.name.localeCompare(b.user.name) : (a.compliance_pct ?? 101) - (b.compliance_pct ?? 101))), [r.athletes, sort]);
  const T = r.totals;
  return (
    <>
      <View style={[styles.wrap, { gap: theme.space[3] }]}>
        <Kpi label={t("Aderência")} value={pct(T.compliance_pct)} sub={t("parcial conta meio treino")} />
        <Kpi label={t("Treinos feitos")} value={`${T.done + T.partial}/${T.planned}`} sub={t("{n} não realizados", { n: T.missed })} />
        {volume ? <>
          <Kpi label={t("Tempo de treino")} value={duration(T.done_s)} sub={t("planejado: {d}", { d: duration(T.planned_s) })} />
          <Kpi label={t("Distância")} value={`${km(T.distance_m)} km`} sub={t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes })} />
        </> : <Kpi label={t("Tempo planejado")} value={duration(T.planned_s)} sub={t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes })} />}
      </View>
      <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={[styles.row, styles.between, { gap: theme.space[3] }]}>
          <Text variant="titleMd" accessibilityRole="header">{t("Aderência por semana")}</Text>
          <Text variant="caption" tone="muted">{t("alunos do filtro")}</Text>
        </View>
        <ComplianceTrend data={r.weekly} />
      </Card>
      <View style={{ gap: theme.space[2] }}>
        <View style={[styles.row, styles.between, { gap: theme.space[3] }]}>
          <Text variant="titleMd" accessibilityRole="header">{t("Alunos")}</Text>
          <Segmented<"name" | "compliance"> label={t("Ordenar")} size="sm" value={sort} onChange={setSort}
            options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} />
        </View>
        <Card style={{ padding: theme.space[1] }}>
          {rows.length === 0 ? <Text tone="muted" style={{ padding: theme.space[3] }}>{t("Nenhum aluno neste filtro.")}</Text> : rows.map((a, i) => (
            <View key={a.membership_id} style={{ gap: theme.space[2], padding: theme.space[3], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.lineSubtle }}>
              <View style={[styles.row, { gap: theme.space[2] }]}>
                <Avatar name={a.user.name} src={a.user.avatar_url} size={theme.space[8]} />
                <Text variant="labelMd" numberOfLines={1} style={styles.flex}>{a.user.name}</Text>
              </View>
              <ComplianceBar pct={a.compliance_pct} />
              <View style={[styles.wrap, { columnGap: theme.space[4], rowGap: theme.space[1] }]}>
                <Text variant="caption" tone="muted" style={styles.tabular}>{t("Feitos {d}/{p}", { d: a.done, p: a.planned })}</Text>
                <Text variant="caption" tone="muted" style={styles.tabular}>{t("Parciais {n}", { n: a.partial })}</Text>
                <Text variant="caption" color={a.missed > 2 ? c.danger.text : c.fgMuted} style={styles.tabular}>{t("Faltas {n}", { n: a.missed })}</Text>
                <Text variant="caption" tone="muted" style={styles.tabular}>{t("Planejado {d}", { d: duration(a.planned_s) })}</Text>
                {!volume ? null : a.shares_data ? (
                  <Text variant="caption" tone="muted" style={styles.tabular}>{t("Treinado {d} · {k} km", { d: duration(a.done_s), k: km(a.distance_m) })}</Text>
                ) : (
                  <View style={[styles.row, { gap: theme.space[1] }]}>
                    <ShieldOff size={theme.size.iconSm - 2} color={c.fgMuted} aria-hidden />
                    <Text variant="caption" tone="muted">{t("não compartilha")}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </Card>
      </View>
    </>
  );
}

const hours = (s: number | null) => (s == null ? null : Math.round((s / 3600) * 10) / 10);
function csvTraining(club: Club, r: TrainingReport) {
  // The activity columns only where the club's modalities sync activities (D-052).
  const volume = has(club, "strava");
  return shareCsv(`${club.slug}-treinos-${r.from}-a-${r.to}.csv`,
    [t("Aluno"), t("E-mail"), t("Aderência (%)"), t("Planejados"), t("Feitos"), t("Parciais"), t("Não realizados"), t("Horas planejadas"), ...(volume ? [t("Horas treinadas"), t("Distância (km)"), t("Atividades")] : [])],
    r.athletes.map((a) => [a.user.name, a.user.email, a.compliance_pct, a.planned, a.done, a.partial, a.missed, hours(a.planned_s), ...(volume ? [hours(a.done_s), a.distance_m == null ? null : Math.round(a.distance_m / 100) / 10, a.activities] : [])]),
    t("Relatório de treinos"));
}

/** A printable page (the web prints the screen with its print stylesheet; the phone renders this HTML to a PDF). */
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
function reportHtml(club: Club, r: TrainingReport, groupName: string) {
  const T = r.totals;
  const volume = has(club, "strava"); // activity time and distance only where the modalities sync them (D-052)
  const kpi = (label: string, value: string, sub: string) => `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`;
  const rows = [...r.athletes].sort((a, b) => a.user.name.localeCompare(b.user.name)).map((a) => `<tr><td>${esc(a.user.name)}</td><td class="n">${pct(a.compliance_pct)}</td><td class="n">${a.done}/${a.planned}</td><td class="n">${a.partial}</td><td class="n">${a.missed}</td><td class="n">${esc(duration(a.planned_s))}</td>${!volume ? "" : a.shares_data ? `<td class="n">${esc(duration(a.done_s))}</td><td class="n">${esc(km(a.distance_m))} km</td>` : `<td class="n m" colspan="2">${esc(t("não compartilha"))}</td>`}</tr>`).join("");
  const weeks = r.weekly.map((w) => `<tr><td>${esc(fullDate(w.week_start))}${w.current ? ` (${esc(t("em andamento"))})` : ""}</td><td class="n">${pct(w.pct)}</td><td class="n">${w.done}/${w.planned}</td></tr>`).join("");
  // A PDF is paper: always the light theme's tokens, whatever the app's color mode.
  const L = tokens.semantic.light, sp = tokens.space, rd = tokens.radius, tx = tokens.text;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
body{font-family:${tokens.font.family.body.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(",")};color:${L.fg.default};background:${L.bg.surface};margin:${sp[8]}px;font-size:${tx.caption.size}px}h1{font-size:${tx.titleLg.size}px;margin:0}h2{font-size:${tx.titleSm.size}px;margin:${sp[6]}px 0 ${sp[2]}px}
.meta{color:${L.fg.muted};margin:${sp[1]}px 0 ${sp[4]}px}.kpis{display:flex;gap:${sp[3]}px}.kpi{flex:1;border:1px solid ${L.border.default};border-radius:${rd.md}px;padding:${sp[3]}px}.l,.s{color:${L.fg.muted};font-size:${tx.overline.size}px}.v{font-size:${tx.metricMd.size}px;font-weight:${tx.metricMd.weight}}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:${sp["1.5"]}px ${sp[2]}px;border-bottom:1px solid ${L.border.subtle}}th{color:${L.fg.muted};font-size:${tx.overline.size}px}.n{text-align:right;font-variant-numeric:tabular-nums}.m{color:${L.fg.subtle}}
</style></head><body>
<h1>${esc(t("Relatório de treinos"))} · ${esc(club.name)}</h1>
<div class="meta">${esc(fullDate(r.from))} – ${esc(fullDate(r.to))} · ${esc(groupName)}</div>
<div class="kpis">${kpi(t("Aderência"), pct(T.compliance_pct), t("parcial conta meio treino"))}${kpi(t("Treinos feitos"), `${T.done + T.partial}/${T.planned}`, t("{n} não realizados", { n: T.missed }))}${volume ? `${kpi(t("Tempo de treino"), duration(T.done_s), t("planejado: {d}", { d: duration(T.planned_s) }))}${kpi(t("Distância"), `${km(T.distance_m)} km`, t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes }))}` : kpi(t("Tempo planejado"), duration(T.planned_s), t("{n} de {t} alunos compartilham dados", { n: T.sharing, t: T.athletes }))}</div>
<h2>${esc(t("Aderência por semana"))}</h2><table><thead><tr><th>${esc(t("Semana"))}</th><th class="n">${esc(t("Aderência"))}</th><th class="n">${esc(t("Feitos"))}</th></tr></thead><tbody>${weeks}</tbody></table>
<h2>${esc(t("Alunos"))}</h2><table><thead><tr><th>${esc(t("Aluno"))}</th><th class="n">${esc(t("Aderência"))}</th><th class="n">${esc(t("Feitos"))}</th><th class="n">${esc(t("Parciais"))}</th><th class="n">${esc(t("Faltas"))}</th><th class="n">${esc(t("Planejado"))}</th>${volume ? `<th class="n">${esc(t("Treinado"))}</th><th class="n">${esc(t("Distância"))}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  between: { justifyContent: "space-between" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  half: { flexBasis: "47%", flexGrow: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
});

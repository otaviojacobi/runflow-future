/**
 * O3 · Configurações do clube (owner; the web's screens/owner/Settings.tsx): club data and timezone, modalities and
 * the trainer label, week release (D-031: immediate or week by week, with an automatic release day and time) and the
 * danger zone (closing the club, confirmed by its name). Each card saves on its own.
 */
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useCloseClub, useUpdateClub } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import type { Club, Sport } from "@/api/types";
import { SPORT_ICON, SPORT_LABEL } from "@/components/sport";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { queryClient } from "@/queryClient";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Dialog, Field, Input, Screen, Segmented, Select, Switch, Text, toast } from "@/ui";
import { CalendarCheck, Check, TriangleAlert } from "@/ui/icons";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const SPORTS: Sport[] = ["run", "swim", "bike", "strength", "mobility", "other"];
const TIMEZONES: [string, string][] = [
  ["America/Noronha", "Fernando de Noronha (UTC−2)"],
  ["America/Sao_Paulo", "Horário de Brasília (UTC−3)"],
  ["America/Manaus", "Amazonas (UTC−4)"],
  ["America/Cuiaba", "Mato Grosso (UTC−4)"],
  ["America/Campo_Grande", "Mato Grosso do Sul (UTC−4)"],
  ["America/Porto_Velho", "Rondônia (UTC−4)"],
  ["America/Boa_Vista", "Roraima (UTC−4)"],
  ["America/Rio_Branco", "Acre (UTC−5)"],
];
const WEEKDAYS: [number, string][] = [[7, "Domingo"], [1, "Segunda-feira"], [2, "Terça-feira"], [3, "Quarta-feira"], [4, "Quinta-feira"], [5, "Sexta-feira"], [6, "Sábado"]];
const apiErr = (e: unknown) => (e instanceof ApiError ? e : null);
/** "1830" → "18:30" as the person types on the number pad. */
const maskTime = (s: string) => { const d = s.replace(/\D/g, "").slice(0, 4); return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`; };

function SaveRow({ dirty, loading, onSave, onReset }: { dirty: boolean; loading: boolean; onSave: () => void; onReset: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.end, { gap: theme.space[2], paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: theme.color.lineSubtle }]}>
      {dirty && <Button variant="ghost" onPress={onReset}>{t("Descartar")}</Button>}
      <Button disabled={!dirty} loading={loading} onPress={onSave}>{t("Salvar")}</Button>
    </View>
  );
}

function Section({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="titleSm" accessibilityRole="header">{title}</Text>
        {text ? <Text variant="bodySm" tone="muted">{text}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

export default function SettingsScreen() {
  const { club, ctx } = useClub();
  if (!club || !ctx) return null;
  return (
    <Screen>
      {/* The back bar says "Configurações do clube". */}
      <Text tone="muted">{t("Dados, modalidades e liberação dos treinos do {club}.", { club: club.name })}</Text>
      <ClubData club={club} key={`d${club.id}`} />
      <Modalities club={club} key={`m${club.id}`} />
      <WeekRelease club={club} key={`r${club.id}`} />
      <DangerZone club={club} />
    </Screen>
  );
}

function ClubData({ club }: { club: Club }) {
  const { theme } = useTheme();
  const update = useUpdateClub(club.id);
  const init = { name: club.name, city: club.city ?? "", state: club.state ?? "", timezone: club.timezone };
  const [v, setV] = useState(init);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = apiErr(update.error);
  const zones = TIMEZONES.some(([z]) => z === club.timezone) ? TIMEZONES : [[club.timezone, club.timezone] as [string, string], ...TIMEZONES];
  const save = () => update.mutate({ ...v, name: v.name.trim(), city: v.city.trim() || null, state: v.state || null }, {
    onSuccess: () => toast.success(t("Dados do clube salvos")),
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  return (
    <Section title={t("Dados do clube")}>
      <Field label={t("Nome do clube")} error={err?.fieldError("name")}>
        {(a) => <Input {...a} value={v.name} onChangeText={(name) => set({ name })} maxLength={80} autoCapitalize="words" />}
      </Field>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <Field label={t("Cidade")} optional style={styles.flex}>
          {(a) => <Input {...a} value={v.city} onChangeText={(city) => set({ city })} autoCapitalize="words" />}
        </Field>
        <Field label={t("Estado")} error={err?.fieldError("state")} style={{ width: theme.space[20] + theme.space[8] }}>
          {(a) => <Select<string> {...a} title={t("Estado")} placeholder={t("Escolha…")} value={v.state || null} onChange={(state) => set({ state })} options={UF.map((u) => ({ value: u, label: u }))} />}
        </Field>
      </View>
      <Field label={t("Fuso horário")} hint={t("Define o “hoje” dos alunos e a liberação automática da semana.")}>
        {(a) => <Select<string> {...a} title={t("Fuso horário")} value={v.timezone} onChange={(timezone) => set({ timezone })} options={zones.map(([z, l]) => ({ value: z, label: t(l) }))} />}
      </Field>
      <SaveRow dirty={dirty} loading={update.isPending} onSave={save} onReset={() => setV(init)} />
    </Section>
  );
}

function Modalities({ club }: { club: Club }) {
  const { theme } = useTheme();
  const c = theme.color;
  const update = useUpdateClub(club.id);
  const [mods, setMods] = useState<Sport[]>(club.modalities);
  const [label, setLabel] = useState(club.trainer_label);
  const dirty = label !== club.trainer_label || [...mods].sort().join() !== [...club.modalities].sort().join();
  const err = apiErr(update.error);
  const toggle = (s: Sport) => setMods((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  const save = () => update.mutate({ modalities: mods, trainer_label: label }, {
    onSuccess: () => toast.success(t("Preferências salvas")),
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  return (
    <Section title={t("Modalidades e termos")} text={t("As modalidades organizam a biblioteca e os filtros. Os termos mudam como o app chama a equipe.")}>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="labelSm">{t("Modalidades do clube")}</Text>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {SPORTS.map((s) => {
            const I = SPORT_ICON[s], on = mods.includes(s);
            return (
              <Pressable key={s} onPress={() => toggle(s)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={t(SPORT_LABEL[s])}
                style={({ pressed }) => [styles.row, {
                  minHeight: theme.size.touchMin, gap: theme.space[2], paddingHorizontal: theme.space[4], borderRadius: theme.radius.full, borderWidth: on ? 2 : 1,
                  borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
                }]}>
                <I size={theme.size.iconSm} color={on ? c.brand.subtleFg : c.fgMuted} aria-hidden />
                <Text variant="labelSm" color={on ? c.brand.subtleFg : c.fgMuted} style={styles.bold}>{t(SPORT_LABEL[s])}</Text>
                {on && <Check size={theme.size.iconSm} color={c.brand.subtleFg} aria-hidden />}
              </Pressable>
            );
          })}
        </View>
        {err?.fieldError("modalities") ? <Text variant="caption" color={c.danger.text}>{err.fieldError("modalities")}</Text> : null}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="labelSm">{t("Como os alunos chamam a equipe")}</Text>
        <Segmented<Club["trainer_label"]> label={t("Termo da equipe")} value={label} onChange={setLabel} style={styles.start}
          options={[{ value: "treinador", label: t("Treinador(a)") }, { value: "professor", label: t("Professor(a)") }]} />
        <Text variant="bodySm" tone="muted">{label === "treinador" ? t("Ex.: “Seu treinador comentou no treino”, “Fale com a treinadora”.") : t("Ex.: “Seu professor comentou no treino”, “Fale com a professora”.")}</Text>
      </View>
      <SaveRow dirty={dirty} loading={update.isPending} onSave={save} onReset={() => { setMods(club.modalities); setLabel(club.trainer_label); }} />
    </Section>
  );
}

/** D-031: when students see what the trainers plan. */
function WeekRelease({ club }: { club: Club }) {
  const { theme } = useTheme();
  const c = theme.color;
  const update = useUpdateClub(club.id);
  const init = { release_mode: club.release_mode, auto: club.auto_release_weekday != null, day: club.auto_release_weekday ?? 7, time: club.auto_release_time ?? "18:00" };
  const [v, setV] = useState(init);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = apiErr(update.error);
  const weekly = v.release_mode === "weekly";
  const badTime = weekly && v.auto && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time);
  const save = () => {
    if (badTime) return;
    update.mutate(
      { release_mode: v.release_mode, ...(weekly ? { auto_release_weekday: v.auto ? v.day : null, auto_release_time: v.auto ? v.time : null } : {}) },
      { onSuccess: () => toast.success(t("Liberação dos treinos salva")), onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } },
    );
  };
  const options = [
    ["weekly", t("Semana a semana"), t("Planeje com antecedência. Os alunos veem cada semana quando ela é liberada, de uma vez, com um só aviso.")],
    ["immediate", t("Na hora"), t("Cada treino aparece para o aluno assim que é salvo, com um aviso.")],
  ] as const;
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <View style={{ gap: theme.space[1] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <CalendarCheck size={theme.size.iconMd} color={c.fg} aria-hidden />
          <Text variant="titleSm" accessibilityRole="header">{t("Liberação dos treinos")}</Text>
        </View>
        <Text variant="bodySm" tone="muted">{t("Quando os alunos passam a ver o que a equipe planejou.")}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("Liberação dos treinos")} style={{ gap: theme.space[2] }}>
        {options.map(([value, label, hint]) => {
          const on = v.release_mode === value;
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${label}. ${hint}`} onPress={() => set({ release_mode: value })}
              style={({ pressed }) => [{ gap: theme.space[1], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface }]}>
              <Text variant="labelMd" color={on ? c.brand.subtleFg : c.fg}>{label}</Text>
              <Text variant="bodySm" color={on ? c.brand.subtleFg : c.fgMuted}>{hint}</Text>
            </Pressable>
          );
        })}
      </View>
      {weekly && (
        <View style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: c.sunken }}>
          <Switch checked={v.auto} onCheckedChange={(auto) => set({ auto })} label={t("Liberar automaticamente")} description={t("A semana seguinte é liberada para todos neste dia e horário. Você ainda pode liberar antes.")} />
          {v.auto && (
            <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
              <Field label={t("Dia")} style={styles.flex}>
                {(a) => <Select<string> {...a} title={t("Dia")} value={String(v.day)} onChange={(d) => set({ day: Number(d) })} options={WEEKDAYS.map(([d, l]) => ({ value: String(d), label: t(l) }))} />}
              </Field>
              <Field label={t("Horário")} error={badTime ? t("Use o formato 18:00.") : err?.fieldError("auto_release_time")} style={{ width: theme.space[20] + theme.space[4] }}>
                {(a) => <Input {...a} value={v.time} onChangeText={(x) => set({ time: maskTime(x) })} placeholder="18:00" keyboardType="number-pad" maxLength={5} />}
              </Field>
            </View>
          )}
          <Text variant="bodySm" tone="muted">{t("A semana em andamento fica sempre visível para os alunos.")}</Text>
        </View>
      )}
      {err?.fieldError("release_mode") ? <Text variant="caption" color={c.danger.text}>{err.fieldError("release_mode")}</Text> : null}
      <SaveRow dirty={dirty} loading={update.isPending} onSave={save} onReset={() => setV(init)} />
    </Card>
  );
}

function DangerZone({ club }: { club: Club }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const close = useCloseClub(club.id);
  const err = apiErr(close.error);
  const matches = name.trim().toLowerCase() === club.name.toLowerCase();
  const submit = () => close.mutate(name.trim(), {
    onSuccess: async () => {
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
      selectClub(me.memberships[0] ?? null);
      setOpen(false);
      toast.success(t("Clube encerrado"), t("Os membros não têm mais acesso. Obrigado por usar o Runflow."));
      router.replace("/clubs");
    },
    onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
  });
  return (
    <Card edge="danger" style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <TriangleAlert size={theme.size.iconMd} color={c.danger.text} aria-hidden />
        <Text variant="titleSm" color={c.danger.text} accessibilityRole="header">{t("Zona de perigo")}</Text>
      </View>
      <Text variant="bodySm" tone="muted">{t("Encerrar o clube remove o acesso de todos os membros e cancela o plano. As atividades de cada aluno continuam na conta dele.")}</Text>
      <Button variant="danger" style={styles.start} onPress={() => setOpen(true)}>{t("Encerrar clube")}</Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); close.reset(); } }} title={t("Encerrar {club}?", { club: club.name })}
        description={t("Não dá para desfazer. Para confirmar, digite o nome do clube.")}
        footer={<>
          <Button variant="secondary" size="lg" onPress={() => setOpen(false)}>{t("Voltar")}</Button>
          <Button variant="danger" size="lg" style={styles.flex} loading={close.isPending} disabled={!matches} onPress={submit}>{t("Encerrar para sempre")}</Button>
        </>}>
        <Field label={t("Nome do clube")} error={err?.fieldError("confirm_name")}>
          {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={club.name} autoComplete="off" autoCorrect={false} />}
        </Field>
      </Dialog>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  end: { flexDirection: "row", justifyContent: "flex-end" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  bold: { fontWeight: weight("semibold") },
});

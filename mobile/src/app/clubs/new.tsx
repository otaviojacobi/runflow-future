/**
 * A5 · Criar clube (the web's screens/onboarding/CreateClub.tsx): dados → cores e logo → convite → biblioteca → pronto,
 * in under 5 minutes (root.md §2). The wizard stays in Runflow's colors (D-024); the club's colors show only in the
 * preview. Every step after the first can be skipped and done later in the club's settings.
 */
import Color from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { Image } from "expo-image";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCreateClub, useSaveBranding, useUploadAsset } from "@/api/clubs";
import { useTemplates } from "@/api/staff";
import { fetchMe, meKey } from "@/api/me";
import type { Club, Sport } from "@/api/types";
import { RunflowWordmark } from "@/components/brand";
import { ColorPicker, PRIMARY_PRESETS, SECONDARY_PRESETS } from "@/components/club/ColorPicker";
import { InviteForm } from "@/components/club/InviteForm";
import { ThemePreview } from "@/components/club/ThemePreview";
import { SPORT_ICON, SPORT_LABEL, SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout/workout";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub } from "@/lib/club";
import { duration } from "@/lib/format";
import { pickLogo } from "@/lib/logo";
import { useSession } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { weight } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Field, Input, Screen, Select, Skeleton, Text, toast } from "@/ui";
import { Check, CircleCheck, ImageUp, Library, Mail, Palette, X } from "@/ui/icons";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const SPORTS: Sport[] = ["run", "swim", "bike", "strength", "mobility", "other"];
const DEFAULTS = { brand: tokens.seeds.brand, accent: tokens.seeds.accent };
type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = ["Clube", "Cores", "Convite", "Biblioteca"];

/** After creating or rebranding: the fresh `/me`, with the new club active. */
async function activate(clubId: string) {
  const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
  selectClub(me.memberships.find((m) => m.club.id === clubId) ?? null);
}

function Progress({ step }: { step: Step }) {
  const { theme } = useTheme();
  const c = theme.color;
  const dot = theme.space[6] + theme.space[1];
  return (
    <View accessible accessibilityLabel={t("Passo {n} de {total}: {label}", { n: step, total: STEPS.length, label: t(STEPS[step - 1]!) })} style={[styles.row, { gap: theme.space[2] }]}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = step > n, now = step === n;
        return (
          <View key={label} style={[styles.row, styles.flex, { gap: theme.space[2] }]}>
            <View style={[styles.center, { width: dot, height: dot, borderRadius: theme.radius.full, backgroundColor: done ? c.brand.solid : now ? c.brand.subtle : c.soft, borderWidth: now ? 2 : 0, borderColor: c.brand.ring }]}>
              {done ? <Check size={theme.size.iconSm} color={c.brand.onSolid} aria-hidden /> : <Text variant="caption" color={now ? c.brand.subtleFg : c.fgMuted} style={styles.bold}>{n}</Text>}
            </View>
            {i < STEPS.length - 1 && <View style={[styles.flex, { height: 2, borderRadius: theme.radius.full, backgroundColor: done ? c.brand.solid : c.line }]} />}
          </View>
        );
      })}
    </View>
  );
}

function Head({ title, text }: { title: string; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="displaySm" accessibilityRole="header">{title}</Text>
      <Text tone="muted">{text}</Text>
    </View>
  );
}

export default function CreateClubScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { signedIn } = useSession();
  const [step, setStep] = useState<Step>(1);
  const [club, setClub] = useState<Club | null>(null);
  if (!signedIn) return <Redirect href={{ pathname: "/login", params: { redirect: "/clubs/new" } }} />;
  const leave = () => (club ? router.replace("/dashboard") : router.canGoBack() ? router.back() : router.replace("/clubs"));
  const header = (
    <View style={[styles.row, { paddingTop: insets.top + theme.space[2], paddingBottom: theme.space[2], paddingHorizontal: theme.space[4], borderBottomWidth: 1, borderBottomColor: theme.color.line, backgroundColor: theme.color.canvas }]}>
      <RunflowWordmark />
      <View style={styles.flex} />
      <Button variant="ghost" size="sm" icon={X} onPress={leave}>{club ? t("Terminar depois") : t("Cancelar")}</Button>
    </View>
  );
  return (
    <Screen header={header} insetBottom>
      {step < 5 && <Progress step={step} />}
      {step === 1 && <StepClub onDone={(c) => { setClub(c); setStep(2); }} />}
      {step === 2 && club && <StepColors club={club} onDone={() => setStep(3)} />}
      {step === 3 && club && <StepInvite club={club} onDone={() => setStep(4)} />}
      {step === 4 && club && <StepLibrary club={club} onDone={() => setStep(5)} />}
      {step === 5 && club && <StepDone club={club} />}
    </Screen>
  );
}

function StepClub({ onDone }: { onDone: (c: Club) => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [mods, setMods] = useState<Sport[]>(["run"]);
  const create = useCreateClub();
  const err = create.error instanceof ApiError ? create.error : null;
  const toggle = (s: Sport) => setMods((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  const submit = () =>
    create.mutate({ name: name.trim(), city: city.trim(), state, modalities: mods }, {
      onSuccess: async (r) => { await activate(r.club.id); onDone(r.club); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  return (
    <>
      <Head title={t("Vamos criar o seu clube")} text={t("Leva menos de 5 minutos. Dá para mudar tudo depois.")} />
      <Card style={{ padding: theme.space[4], gap: theme.space[5] }}>
        <Field label={t("Nome do clube")} error={err?.fieldError("name")} hint={t("Como seus alunos conhecem o clube.")}>
          {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Ex.: Pace Forte Assessoria")} autoCapitalize="words" maxLength={80} />}
        </Field>
        <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
          <Field label={t("Cidade")} optional style={styles.flex}>
            {(a) => <Input {...a} value={city} onChangeText={setCity} placeholder="São Paulo" autoComplete="postal-address-locality" autoCapitalize="words" />}
          </Field>
          <Field label={t("Estado")} style={{ width: theme.space[20] + theme.space[8] }}>
            {(a) => <Select<string> {...a} title={t("Estado")} value={state} onChange={setState} options={UF.map((u) => ({ value: u, label: u }))} />}
          </Field>
        </View>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm" accessibilityRole="header">{t("Modalidades")}</Text>
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
          <Text variant="caption" tone="muted">{t("Usamos isso para montar sua biblioteca inicial e os termos do app (treinador ou professor).")}</Text>
        </View>
      </Card>
      <Button size="lg" block loading={create.isPending} disabled={!name.trim()} onPress={submit}>{t("Criar clube")}</Button>
    </>
  );
}

function StepColors({ club, onDone }: { club: Club; onDone: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const [primary, setPrimary] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<string | null>(null);
  const [logo, setLogo] = useState<{ data_url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useUploadAsset(club.id);
  const save = useSaveBranding(club.id);
  const res = useMemo(() => Color.resolveClubColors({ primary, secondary }, DEFAULTS), [primary, secondary]);
  const whiteVariant = primary ? Color.whiteTextVariant(primary) : null;
  const pick = async () => {
    try {
      const r = await pickLogo();
      if (r) setLogo(r);
    } catch {
      toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), t("Envie uma imagem PNG, JPG ou WebP.")));
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      let logoId: string | undefined;
      if (logo) logoId = (await upload.mutateAsync({ ...logo, kind: "logo" })).id;
      await save.mutateAsync({ primary_color: primary, secondary_color: secondary, ...(logoId ? { logo_asset_id: logoId } : {}) });
      await activate(club.id);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const sourceText = { default: t("Sem cores: o app usa o padrão do Runflow."), derived: t("Uma cor: a secundária é criada automaticamente a partir dela."), club: t("Duas cores: primária para ações, secundária para destaques.") }[res.source];
  const box = theme.space[16];
  return (
    <>
      <Head title={t("As cores do {club}", { club: club.name })} text={t("Seus alunos verão o app com o logo e as cores do clube. Escolha uma, duas ou nenhuma.")} />
      <ThemePreview name={club.name} colors={{ primary, secondary }} logoUri={logo?.data_url} />
      <Card style={{ padding: theme.space[4], gap: theme.space[5] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Logo")} <Text variant="labelSm" tone="muted">({t("opcional")})</Text></Text>
          <View style={[styles.row, { gap: theme.space[4] }]}>
            <View style={[styles.center, { width: box, height: box, borderRadius: theme.radius.lg, backgroundColor: c.sunken, borderWidth: 1, borderColor: c.line, overflow: "hidden" }]}>
              {logo ? <Image source={{ uri: logo.data_url }} contentFit="contain" style={{ width: box - theme.space[2], height: box - theme.space[2] }} accessibilityIgnoresInvertColors />
                : <ImageUp size={theme.size.iconLg} color={c.fgSubtle} aria-hidden />}
            </View>
            <View style={[styles.flex, { gap: theme.space["1.5"] }]}>
              <Button variant="secondary" size="sm" icon={ImageUp} style={styles.start} onPress={() => void pick()}>{logo ? t("Trocar logo") : t("Enviar logo")}</Button>
              <Text variant="caption" tone="muted">{t("PNG ou JPG da sua galeria. Fundo transparente fica melhor.")}</Text>
            </View>
          </View>
        </View>
        <ColorPicker label={t("Cor primária: botões e destaques de ação")} value={primary} onChange={(v) => { setPrimary(v); if (!v) setSecondary(null); }} presets={PRIMARY_PRESETS} noneLabel={t("Padrão Runflow")} />
        <ColorPicker label={t("Cor secundária: recordes e conquistas")} value={secondary} onChange={setSecondary} presets={SECONDARY_PRESETS} noneLabel={t("Automática")} disabled={!primary} />
        <View style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.sunken }}>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Palette size={theme.size.iconSm} color={c.fg} aria-hidden />
            <Text variant="labelSm" style={styles.flex}>{sourceText}</Text>
          </View>
          {whiteVariant ? (
            <>
              <Text variant="bodySm" tone="muted">{t("Para manter a leitura, os botões usam texto escuro nesta cor.")}</Text>
              <Button variant="ghost" size="sm" style={styles.start} onPress={() => setPrimary(whiteVariant)}>{t("Preferir texto branco ({c})", { c: whiteVariant })}</Button>
            </>
          ) : null}
        </View>
      </Card>
      <Button size="lg" block loading={busy} onPress={() => void submit()}>{t("Salvar e continuar")}</Button>
      <Button variant="ghost" block onPress={onDone}>{t("Pular por enquanto")}</Button>
    </>
  );
}

function StepInvite({ club, onDone }: { club: Club; onDone: () => void }) {
  const { theme } = useTheme();
  const [sent, setSent] = useState(0);
  return (
    <>
      <Head title={t("Convide seus alunos")} text={t("Cada aluno recebe um convite pessoal por e-mail e entra com a conta Google ou um código, em segundos. Só entra no clube quem você convidar.")} />
      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Mail size={theme.size.iconMd} color={theme.color.brand.text} aria-hidden />
          <Text variant="titleSm" accessibilityRole="header">{t("Convites por e-mail")}</Text>
        </View>
        <InviteForm club={club} onSent={() => setSent((x) => x + 1)} />
        <Text variant="caption" tone="muted">{t("No plano Free, até 10 alunos. Treinadores não contam. Tem uma planilha? Importe depois em Membros e convites.")}</Text>
      </Card>
      <Button size="lg" block onPress={onDone}>{t("Continuar")}</Button>
      <Button variant="ghost" block onPress={onDone}>{sent ? t("Convidar mais depois") : t("Pular por enquanto")}</Button>
    </>
  );
}

function StepLibrary({ club, onDone }: { club: Club; onDone: () => void }) {
  const { theme } = useTheme();
  const tpl = useTemplates(club.id);
  const items = tpl.data ?? [];
  return (
    <>
      <Head title={t("Sua biblioteca já começa pronta")}
        text={tn(items.length, "Separamos {n} treino para as modalidades do clube. Edite à vontade ou crie os seus.", "Separamos {n} treinos para as modalidades do clube. Edite à vontade ou crie os seus.")} />
      <View style={{ gap: theme.space[3] }}>
        {tpl.isPending && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} style={{ height: theme.space[20] + theme.space[4] }} />)}
        {items.map((w) => (
          <Card key={w.id} style={{ padding: theme.space[4], gap: theme.space[2] }}>
            <View style={styles.between}>
              <SportChip sport={w.sport} size="sm" />
              <Text variant="caption" tone="muted">{w.est_duration_s ? `≈ ${duration(w.est_duration_s)}` : ""}</Text>
            </View>
            <Text variant="labelMd">{w.name}</Text>
            <IntensityProfile structure={w.structure} sport={w.sport} height={theme.space[8]} />
          </Card>
        ))}
      </View>
      <Button size="lg" block icon={Library} onPress={onDone}>{t("Concluir")}</Button>
    </>
  );
}

function StepDone({ club }: { club: Club }) {
  const { theme } = useTheme();
  const c = theme.color;
  const items = [t("Clube criado"), t("Cores e logo"), t("Convites por e-mail"), t("Biblioteca inicial")];
  const badge = theme.space[16];
  return (
    <View style={[styles.centered, { gap: theme.space[5], paddingVertical: theme.space[4] }]}>
      <View style={[styles.center, { width: badge, height: badge, borderRadius: theme.radius.full, backgroundColor: c.accent.solid }]}>
        <CircleCheck size={theme.size.iconLg + theme.space[2]} color={c.accent.onSolid} aria-hidden />
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="displaySm" accessibilityRole="header" style={styles.textCenter}>{t("Tudo pronto, {club}!", { club: club.name })}</Text>
        <Text tone="muted" style={styles.textCenter}>{t("Agora é com você: monte a primeira semana dos alunos assim que eles entrarem.")}</Text>
      </View>
      <View style={[styles.stretch, { gap: theme.space[2] }]}>
        {items.map((i) => (
          <View key={i} style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }]}>
            <Check size={theme.size.iconMd} color={c.success.text} aria-hidden />
            <Text variant="labelMd">{i}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.stretch, { gap: theme.space[2] }]}>
        <Button size="lg" block onPress={() => router.replace("/dashboard")}>{t("Ir para o painel")}</Button>
        <Button variant="secondary" size="lg" block onPress={() => router.replace("/planning")}>{t("Montar a semana")}</Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { alignItems: "center", justifyContent: "center" },
  centered: { alignItems: "center" },
  stretch: { alignSelf: "stretch" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  bold: { fontWeight: weight("bold") },
  textCenter: { textAlign: "center" },
});

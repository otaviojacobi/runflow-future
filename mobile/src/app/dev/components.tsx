/**
 * X1 · /dev/components: every UI kit component, each section in light and dark side by side (stacked on phones),
 * with a demo club theme to check the club roles. Development only (like the web's /dev pages).
 */
import { tokens } from "@runflow/design/tokens";
import { Redirect, router } from "expo-router";
import { useState, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import type { ClubColors, Mode } from "@/theme/theme";
import { ThemeScope, useTheme } from "@/theme/ThemeProvider";
import {
  Avatar, Badge, Button, ButtonLink, Card, Checkbox, Dialog, Divider, EmptyState, Field, IconButton, Input, ListItem, Menu, PageHeader,
  ProgressBar, Screen, Segmented, Select, Skeleton, Spinner, Switch, Tabs, Text, Textarea, toast, type Tone,
} from "@/ui";
import { ArrowLeft, Bell, Calendar, ChevronRight, Flag, Inbox, LogOut, Mail, Plus, Settings, Star, Trash2, User } from "@/ui/icons";

const CLUBS: { value: string; label: string; colors: ClubColors | null }[] = [
  { value: "runflow", label: "Runflow", colors: null },
  { value: "pace", label: "Pace Forte", colors: { primary: "#D62828", secondary: "#FFB703" } },
  { value: "mare", label: "Equipe Maré", colors: { primary: "#0096C7", secondary: null } },
];
const TONES: Tone[] = ["neutral", "brand", "accent", "success", "warning", "danger", "info"];
const TONE_LABEL: Record<Tone, string> = { neutral: "Neutro", brand: "Marca", accent: "Destaque", success: "Sucesso", warning: "Atenção", danger: "Perigo", info: "Info" };

/** One section, rendered once per mode. */
function Pair({ title, demo: Demo }: { title: string; demo: ComponentType }) {
  return (
    <View style={styles.section}>
      <Text variant="titleLg" accessibilityRole="header">{title}</Text>
      <View style={styles.pair}>
        {(["light", "dark"] as Mode[]).map((mode) => (
          <ThemeScope key={mode} mode={mode}>
            <Panel mode={mode}><Demo /></Panel>
          </ThemeScope>
        ))}
      </View>
    </View>
  );
}
function Panel({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.color.canvas, borderColor: theme.color.line, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[4] }]}>
      <Text variant="overline" tone="muted">{mode === "light" ? t("Claro") : t("Escuro")}</Text>
      {children}
    </View>
  );
}
const Row = ({ children }: { children: React.ReactNode }) => <View style={styles.row}>{children}</View>;

function TextDemo() {
  return (
    <View style={{ gap: tokens.space[2] }}>
      <Text variant="displayMd">{t("Hoje")}</Text>
      <Text variant="displaySm">{t("Intervalado 6×1 km")}</Text>
      <Text variant="titleLg">{t("Título grande")}</Text>
      <Text variant="titleMd">{t("Título médio")}</Text>
      <Text variant="bodyMd">{t("Texto do corpo: o treino de hoje tem aquecimento, tiros e desaquecimento.")}</Text>
      <Text variant="bodySm" tone="muted">{t("Texto secundário, para detalhes.")}</Text>
      <Text variant="caption" tone="subtle">{t("Legenda")}</Text>
      <Text variant="overline" tone="muted">{t("Sobretítulo")}</Text>
      <Row><Text variant="metricLg">10,2 km</Text><Text variant="metricLg" tone="brand">4:30 /km</Text></Row>
    </View>
  );
}

function ButtonDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: tokens.space[3] }}>
      <Row>
        <Button>{t("Salvar treino")}</Button>
        <Button variant="secondary">{t("Cancelar")}</Button>
      </Row>
      <Row>
        <Button variant="ghost">{t("Pular")}</Button>
        <Button variant="danger" icon={Trash2}>{t("Excluir")}</Button>
        <Button variant="accent" icon={Star}>{t("Recorde")}</Button>
      </Row>
      <Row>
        <Button size="sm">{t("Pequeno")}</Button>
        <Button size="md">{t("Médio")}</Button>
        <Button size="lg">{t("Grande")}</Button>
      </Row>
      <Button size="lg" block icon={Mail} loading={busy} onPress={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>{t("Receber código por e-mail")}</Button>
      <Button block disabled>{t("Desativado")}</Button>
      <Row>
        <IconButton label={t("Notificações")} icon={Bell} />
        <IconButton label={t("Adicionar")} icon={Plus} variant="primary" />
        <IconButton label={t("Configurações")} icon={Settings} variant="secondary" size="sm" />
        <ButtonLink href="/" variant="secondary" size="sm" iconRight={ChevronRight}>{t("Link")}</ButtonLink>
      </Row>
    </View>
  );
}

function FormDemo() {
  const [email, setEmail] = useState("");
  const [goal, setGoal] = useState<"10k" | "21k" | "42k" | null>(null);
  const [lgpd, setLgpd] = useState(true);
  const [push, setPush] = useState(false);
  const [view, setView] = useState<"week" | "month">("week");
  const bad = email.length > 0 && !email.includes("@");
  return (
    <View style={{ gap: tokens.space[4] }}>
      <Field label={t("E-mail")} hint={t("Enviamos um código para este e-mail.")} error={bad ? t("Digite um e-mail válido, como nome@email.com.") : null}>
        {(a) => <Input {...a} invalid={a.invalid} value={email} onChangeText={setEmail} placeholder="nome@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />}
      </Field>
      <Field label={t("Convite para")} hint={t("O convite é para este e-mail.")}>
        {(a) => <Input {...a} value="ana@email.com" readOnly />}
      </Field>
      <Field label={t("Objetivo")} optional>
        {(a) => <Select {...a} value={goal} onChange={setGoal} placeholder={t("Escolha")} options={[{ value: "10k", label: "10 km" }, { value: "21k", label: t("Meia maratona"), description: "21,1 km" }, { value: "42k", label: t("Maratona"), description: "42,2 km" }]} />}
      </Field>
      <Field label={t("Observações")} optional>
        {(a) => <Textarea {...a} placeholder={t("Algo que o treinador deve saber?")} />}
      </Field>
      <Checkbox checked={lgpd} onCheckedChange={setLgpd} label={t("Compartilhar meus treinos com o clube")} description={t("Treinadores veem seus treinos e o feedback.")} />
      <Switch checked={push} onCheckedChange={setPush} label={t("Notificações no celular")} description={t("Treino novo, comentários e mensagens.")} />
      <Switch checked disabled onCheckedChange={() => undefined} label={t("Desativado")} />
      <Segmented label={t("Visualização")} value={view} onChange={setView} options={[{ value: "week", label: t("Semana"), icon: Calendar }, { value: "month", label: t("Mês") }]} />
    </View>
  );
}

function BadgeDemo() {
  return (
    <View style={{ gap: tokens.space[3] }}>
      <Row>{TONES.map((tone) => <Badge key={tone} tone={tone}>{t(TONE_LABEL[tone])}</Badge>)}</Row>
      <Row>{TONES.map((tone) => <Badge key={tone} tone={tone} solid>{t(TONE_LABEL[tone])}</Badge>)}</Row>
      <Row><Badge tone="accent" solid icon={Star}>{t("Recorde")}</Badge><Badge tone="warning" icon={Flag}>{t("Prova")}</Badge></Row>
    </View>
  );
}

function CardDemo() {
  const p = { padding: tokens.space[4], gap: tokens.space[1] };
  return (
    <View style={{ gap: tokens.space[3] }}>
      <Card style={p}><Text variant="titleSm">{t("Cartão")}</Text><Text tone="muted">{t("Superfície padrão com borda e sombra.")}</Text></Card>
      <Card style={p} onPress={() => toast.info(t("Cartão tocado"))} accessibilityLabel={t("Cartão tocável")}><Text variant="titleSm">{t("Cartão tocável")}</Text><Text tone="muted">{t("Toque para abrir.")}</Text></Card>
      <Card tone="brand" style={p}><Text variant="titleSm">{t("Tom da marca")}</Text><Text>{t("O texto herda a cor do tom.")}</Text></Card>
      <Card tone="warning" style={p}><Text>{t("Semana ainda não liberada.")}</Text></Card>
      <Card tone="danger" style={p}><Text>{t("O último pagamento não foi aprovado.")}</Text></Card>
      <Card edge="brand" style={p}><Text>{t("Só a borda colorida.")}</Text></Card>
    </View>
  );
}

function DataDemo() {
  return (
    <View style={{ gap: tokens.space[4] }}>
      <Row><Avatar name="Ana Souza" /><Avatar name="Bruno Lima" size={tokens.space[10]} /><Avatar name="Carla" size={tokens.space[12]} /></Row>
      <View style={{ gap: tokens.space[2] }}><Skeleton style={{ width: "60%" }} /><Skeleton /><Skeleton style={{ height: tokens.space[16] }} /></View>
      <View style={{ gap: tokens.space[2] }}>
        <ProgressBar value={3} max={5} label={t("Treinos da semana")} />
        <ProgressBar value={80} tone="success" label={t("Aderência")} />
        <ProgressBar value={30} tone="accent" label={t("Sequência")} />
      </View>
      <Row><Spinner delay={0} /><Text tone="muted">{t("Carregando…")}</Text></Row>
    </View>
  );
}

function LayoutDemo() {
  const [tab, setTab] = useState<"students" | "team" | "invites">("students");
  return (
    <View style={{ gap: tokens.space[4] }}>
      <PageHeader eyebrow={t("Segunda, 3 nov")} title={t("Bom dia, Ana")} subtitle={t("Você tem 1 treino hoje.")} actions={<Button size="sm" variant="secondary" icon={Calendar}>{t("Agenda")}</Button>} />
      <Tabs label={t("Membros")} value={tab} onValueChange={setTab} items={[{ value: "students", label: t("Alunos") }, { value: "team", label: t("Equipe") }, { value: "invites", label: t("Convites") }]} />
      <Card>
        <ListItem icon={User} title={t("Perfil")} subtitle={t("Zonas, objetivo e dados")} chevron onPress={() => undefined} />
        <Divider style={{ marginVertical: 0 }} />
        <ListItem icon={Bell} title={t("Notificações")} chevron onPress={() => undefined} />
        <Divider style={{ marginVertical: 0 }} />
        <ListItem icon={LogOut} title={t("Sair")} danger onPress={() => undefined} />
      </Card>
      <Card><EmptyState icon={Inbox} title={t("Nenhum feedback por aqui")} action={<Button variant="secondary" size="sm">{t("Ver treinos")}</Button>}>{t("Quando um aluno concluir um treino, o feedback aparece aqui.")}</EmptyState></Card>
    </View>
  );
}

function OverlayDemo() {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: tokens.space[3] }}>
      <Row>
        <Button variant="secondary" onPress={() => setOpen(true)}>{t("Abrir folha")}</Button>
        <Menu title={t("Ações do treino")} items={[
          { label: t("Editar"), icon: Settings, onSelect: () => toast.info(t("Editar")) },
          { label: t("Duplicar"), icon: Plus, onSelect: () => toast.info(t("Duplicar")) },
          "separator",
          { label: t("Excluir"), icon: Trash2, danger: true, onSelect: () => toast.info(t("Excluir")) },
        ]} trigger={(o) => <Button variant="secondary" onPress={o}>{t("Abrir menu")}</Button>} />
      </Row>
      <Row>
        <Button size="sm" variant="secondary" onPress={() => toast.success(t("Treino salvo"))}>{t("Toast de sucesso")}</Button>
        <Button size="sm" variant="secondary" onPress={() => toast.info(t("Semana liberada"), t("Os alunos já veem os treinos."))}>{t("Toast de info")}</Button>
        <Button size="sm" variant="secondary" onPress={() => toast.error(new Error("x"))}>{t("Toast de erro")}</Button>
      </Row>
      <Dialog open={open} onOpenChange={setOpen} title={t("Feedback do treino")} description={t("Como foi o treino de hoje?")}
        footer={<><Button variant="secondary" onPress={() => setOpen(false)}>{t("Cancelar")}</Button><Button onPress={() => { setOpen(false); toast.success(t("Feedback enviado")); }}>{t("Enviar")}</Button></>}>
        <Field label={t("Comentário")} optional>{(a) => <Textarea {...a} placeholder={t("Conte para o treinador")} />}</Field>
      </Dialog>
    </View>
  );
}

export default function ComponentsPreview() {
  const [club, setClub] = useState("runflow");
  if (!__DEV__) return <Redirect href="/" />;
  const colors = CLUBS.find((c) => c.value === club)?.colors ?? null;
  return (
    <ThemeScope club={colors}>
      <Screen insetTop insetBottom contentStyle={{ maxWidth: tokens.size.contentMax }}>
        {router.canGoBack() && <IconButton label={t("Voltar")} icon={ArrowLeft} onPress={() => router.back()} style={{ marginLeft: -tokens.space[2] }} />}
        <PageHeader eyebrow={t("Desenvolvimento")} title={t("Componentes")} subtitle={t("O kit de interface do app: os mesmos nomes e variantes da web, só com os tokens do tema.")} />
        <Segmented label={t("Tema do clube")} value={club} onChange={setClub} options={CLUBS.map((c) => ({ value: c.value, label: c.label }))} />
        <Pair title={t("Texto")} demo={TextDemo} />
        <Pair title={t("Botões")} demo={ButtonDemo} />
        <Pair title={t("Formulário")} demo={FormDemo} />
        <Pair title={t("Selos")} demo={BadgeDemo} />
        <Pair title={t("Cartões")} demo={CardDemo} />
        <Pair title={t("Dados e carregamento")} demo={DataDemo} />
        <Pair title={t("Estrutura")} demo={LayoutDemo} />
        <Pair title={t("Sobreposições")} demo={OverlayDemo} />
      </Screen>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  section: { gap: tokens.space[3] },
  pair: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space[3] },
  panel: { flexGrow: 1, flexBasis: tokens.breakpoint.sm / 2, minWidth: 0, borderWidth: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.space[2] },
});

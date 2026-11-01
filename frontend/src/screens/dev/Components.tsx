/** DS2/DS3: the whole UI kit + domain components, live with club themes and modes. Route: /dev/componentes */
import Color from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { Bell, Copy, Filter, MoreHorizontal, Pencil, Plus, Trash2, Trophy, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { SPORTS, SportBadge, SportChip } from "@/components/sport";
import { ComplianceBar, IntensityProfile, Stat, StatusBadge, type WorkoutStatus } from "@/components/workout";
import { WeekStrip } from "@/components/week";
import type { Structure } from "@/domain/workout";
import { t } from "@/i18n";
import { addDays, mondayOf, today } from "@/lib/format";
import { applyClubTheme, getColorMode, setColorMode, type ColorMode } from "@/lib/theme";
import { Avatar, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, ProgressBar, Segmented, Select, Skeleton, Switch, Tabs, Textarea, toast } from "@/ui";

const CLUBS = [
  { name: "Runflow (padrão)", primary: null, secondary: null },
  { name: "Pace Forte Assessoria", primary: "#D62828", secondary: "#FFB703" },
  { name: "Equipe Maré Natação", primary: "#0096C7", secondary: null },
  { name: "Academia Solar", primary: "#FFC300", secondary: "#111111" },
  { name: "Noturnos Run Club", primary: "#111111", secondary: "#7CFFCB" },
];
const DEFAULTS = { brand: tokens.seeds.brand, accent: tokens.seeds.accent };
const INTERVAL: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" } } ] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "pace", zone: 1 } },
] };
const SWIM: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "distance", m: 400 }, target: { type: "open" }, stroke: "free" },
  { kind: "repeat", count: 10, steps: [{ kind: "step", intent: "active", duration: { type: "distance", m: 100 }, target: { type: "pace", min_s: 95, max_s: 100 }, stroke: "free", send_off_s: 120 }] },
  { kind: "step", intent: "cooldown", duration: { type: "distance", m: 200 }, target: { type: "open" }, stroke: "back" },
] };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8">
      <h2 className="rf-text-title-lg">{title}</h2>
      {children}
    </section>
  );
}

export function ComponentsScreen() {
  const [club, setClub] = useState(0);
  const [mode, setMode] = useState<ColorMode>(getColorMode());
  const [seg, setSeg] = useState<"semana" | "mes">("semana");
  const [sw, setSw] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const c = CLUBS[club]!;
    applyClubTheme(club === 0 ? null : Color.clubThemeCss({ primary: c.primary, secondary: c.secondary }, tokens.env, DEFAULTS));
  }, [club]);
  const monday = mondayOf(today());
  const states = { [addDays(monday, 0)]: "done", [addDays(monday, 1)]: "done", [addDays(monday, 2)]: "missed", [addDays(monday, 3)]: "planned", [addDays(monday, 5)]: "planned" } as const;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow={t("Design system · D2/D3")} title={t("Componentes")} subtitle={t("Os blocos de todas as telas, com o tema do clube e os modos claro e escuro.")}
        actions={<>
          <Select aria-label={t("Clube")} value={club} onChange={(e) => setClub(Number(e.target.value))} className="w-56">{CLUBS.map((c, i) => <option key={c.name} value={i}>{c.name}</option>)}</Select>
          <Segmented label={t("Modo de cor")} value={mode} onChange={(m) => { setMode(m); setColorMode(m); }} options={[{ value: "light", label: t("Claro") }, { value: "dark", label: t("Escuro") }, { value: "system", label: t("Sistema") }]} />
        </>} />

      <Section title={t("Botões")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Plus />}>{t("Novo treino")}</Button>
          <Button variant="secondary" icon={<Copy />}>{t("Copiar semana")}</Button>
          <Button variant="ghost" icon={<Filter />}>{t("Filtros")}</Button>
          <Button variant="accent" icon={<Trophy />}>{t("Ver recordes")}</Button>
          <Button variant="danger" icon={<Trash2 />}>{t("Excluir")}</Button>
          <Button loading>{t("Salvando")}</Button>
          <Button disabled>{t("Desativado")}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">{t("Pequeno")}</Button><Button size="md">{t("Médio")}</Button><Button size="lg">{t("Grande (mobile)")}</Button>
          <IconButton label={t("Editar")}><Pencil /></IconButton>
          <IconButton label={t("Notificações")} variant="secondary"><Bell /></IconButton>
          <Menu trigger={<IconButton label={t("Mais ações")}><MoreHorizontal /></IconButton>} items={[
            { label: t("Editar"), icon: <Pencil />, onSelect: () => toast.info(t("Editar")) },
            { label: t("Duplicar"), icon: <Copy />, onSelect: () => toast.success(t("Treino duplicado")) },
            "separator",
            { label: t("Excluir"), icon: <Trash2 />, danger: true, onSelect: () => toast.info(t("Excluído")) },
          ]} />
        </div>
      </Section>

      <Section title={t("Formulários")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Nome do clube")} hint={t("Aparece para os alunos no app.")}>{(id, d) => <Input id={id} aria-describedby={d} placeholder={t("Ex.: Pace Forte Assessoria")} />}</Field>
          <Field label={t("E-mail")} error={t("Digite um e-mail válido, como nome@email.com.")}>{(id, d) => <Input id={id} aria-describedby={d} invalid defaultValue="ana@" />}</Field>
          <Field label={t("Objetivo")}>{(id) => <Select id={id} defaultValue="10k"><option value="5k">5 km</option><option value="10k">10 km</option><option value="21k">{t("Meia maratona")}</option><option value="42k">{t("Maratona")}</option></Select>}</Field>
          <Field label={t("Recado para o aluno")} optional>{(id) => <Textarea id={id} placeholder={t("Ex.: foco nos últimos tiros")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox label={t("Compartilhar meus treinos com os treinadores do clube")} description={t("Você pode revogar quando quiser.")} defaultChecked />
          <Switch checked={sw} onCheckedChange={setSw} label={t("Lembretes de treino")} description={t("Notificação às 6h no dia do treino.")} />
        </div>
        <Segmented label={t("Visão")} value={seg} onChange={setSeg} options={[{ value: "semana", label: t("Semana") }, { value: "mes", label: t("Mês") }]} className="w-64" />
      </Section>

      <Section title={t("Exibição")}>
        <div className="flex flex-wrap gap-2">
          {(["neutral", "brand", "accent", "success", "warning", "danger", "info"] as const).map((tone) => <Badge key={tone} tone={tone}>{tone}</Badge>)}
          {(["brand", "accent", "success", "warning", "danger", "info"] as const).map((tone) => <Badge key={tone + "s"} tone={tone} solid>{tone}</Badge>)}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Ana Souza" /><Avatar name="Bruno Lima" size={40} /><Avatar name="Carla Mendes" size={48} />
          <div className="w-48"><ProgressBar value={9} max={10} tone="warning" label={t("Alunos")} /></div>
          <Skeleton className="h-4 w-40" /><Skeleton className="size-10 rounded-full" />
        </div>
        <Tabs.Root defaultValue="cal">
          <Tabs.List><Tabs.Trigger value="cal">{t("Calendário")}</Tabs.Trigger><Tabs.Trigger value="act">{t("Atividades")}</Tabs.Trigger><Tabs.Trigger value="zones">{t("Zonas")}</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="cal" className="text-fg-muted">{t("Conteúdo da aba Calendário.")}</Tabs.Content>
          <Tabs.Content value="act" className="text-fg-muted">{t("Conteúdo da aba Atividades.")}</Tabs.Content>
          <Tabs.Content value="zones" className="text-fg-muted">{t("Conteúdo da aba Zonas.")}</Tabs.Content>
        </Tabs.Root>
        <Card><EmptyState icon={<Users />} title={t("Nenhum aluno ainda")} action={<Button icon={<Plus />}>{t("Convidar alunos")}</Button>}>{t("Compartilhe o link de convite no WhatsApp e os alunos aparecem aqui.")}</EmptyState></Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>{t("Abrir diálogo")}</Button>
          <Button variant="secondary" onClick={() => toast.success(t("Treino salvo"), t("Os alunos já podem ver."))}>{t("Toast de sucesso")}</Button>
          <Button variant="secondary" onClick={() => toast.error(null)}>{t("Toast de erro")}</Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen} title={t("Atribuir treino")} description={t("Escolha os alunos e os dias.")} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t("Cancelar")}</Button><Button onClick={() => { setOpen(false); toast.success(t("Treino atribuído")); }}>{t("Atribuir")}</Button></>}>
          <p className="text-fg-muted">{t("No celular, este diálogo vira uma folha que sobe de baixo.")}</p>
        </Dialog>
      </Section>

      <Section title={t("Marca e clube")}>
        <div className="flex flex-wrap items-center gap-6">
          <RunflowWordmark />
          <span className="flex items-center gap-2"><ClubLogo club={{ name: CLUBS[club]!.name }} /> <span className="font-semibold">{CLUBS[club]!.name}</span></span>
        </div>
      </Section>

      <Section title={t("Treino")}>
        <div className="flex flex-wrap gap-2">{SPORTS.map((s) => <SportChip key={s} sport={s} />)}</div>
        <div className="flex flex-wrap gap-2">{SPORTS.map((s) => <SportBadge key={s} sport={s} />)}</div>
        <div className="flex flex-wrap gap-2">{(["planned", "completed", "partial", "missed", "skipped"] as WorkoutStatus[]).map((s) => <StatusBadge key={s} status={s} />)}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="grid gap-3 p-4"><div className="flex items-center justify-between"><SportChip sport="run" /><span className="text-xs text-fg-muted">≈ 59 min · 10,4 km</span></div><div className="rf-text-title-md">Intervalado 6×1 km</div><IntensityProfile structure={INTERVAL} sport="run" /></Card>
          <Card className="grid gap-3 p-4"><div className="flex items-center justify-between"><SportChip sport="swim" /><span className="text-xs text-fg-muted">2.000 m</span></div><div className="rf-text-title-md">Séries 10×100 m</div><IntensityProfile structure={SWIM} sport="swim" /></Card>
        </div>
        <div className="flex flex-wrap items-end gap-8">
          <Stat value="10,2" unit="km" label={t("Distância")} size="lg" /><Stat value="4:52" unit="/km" label={t("Pace médio")} /><Stat value="152" unit="bpm" label={t("FC média")} />
          <div className="w-28"><ComplianceBar pct={92} /></div><div className="w-28"><ComplianceBar pct={68} /></div><div className="w-28"><ComplianceBar pct={41} /></div>
        </div>
        <div className="max-w-sm"><WeekStrip monday={monday} states={states} /></div>
      </Section>
    </div>
  );
}

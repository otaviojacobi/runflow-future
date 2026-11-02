/** O3 · Configurações do clube: data, modalities, terminology, timezone, subdomain (Pro), venues, danger zone. Route: /club/settings */
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Globe, Lock } from "lucide-react";
import { useState } from "react";
import { useCloseClub, useUpdateClub } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import type { Club, Sport } from "@/api/types";
import { SPORTS, SPORT_ICON, SPORT_LABEL } from "@/components/sport";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { queryClient } from "@/queryClient";
import { Badge, Button, ButtonLink, Card, Dialog, Field, Input, PageHeader, Segmented, Select, cn, toast } from "@/ui";
import { VenuesCard } from "../staff/classes/SetupDialogs";

const UF = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
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
const apiErr = (e: unknown) => (e instanceof ApiError ? e : null);

function SaveRow({ dirty, loading, onReset, className }: { dirty: boolean; loading: boolean; onReset: () => void; className?: string }) {
  return (
    <div className={cn("flex justify-end gap-2 border-t border-line-subtle pt-4", className)}>
      {dirty && <Button variant="ghost" onClick={onReset}>{t("Descartar")}</Button>}
      <Button type="submit" disabled={!dirty} loading={loading}>{t("Salvar")}</Button>
    </div>
  );
}

export function SettingsScreen() {
  const { club, ctx } = useClub();
  if (!club || !ctx) return null;
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={t("Configurações do clube")} subtitle={t("Dados, modalidades, endereço e locais do {club}", { club: club.name })} />
      <ClubData club={club} key={`d${club.id}`} />
      <Modalities club={club} key={`m${club.id}`} />
      <Subdomain key={`s${club.id}`} club={club} plan={ctx.subscription?.plan ?? "free"} />
      <VenuesCard club={club} />
      <DangerZone club={club} />
    </div>
  );
}

function ClubData({ club }: { club: Club }) {
  const update = useUpdateClub(club.id);
  const init = { name: club.name, city: club.city ?? "", state: club.state ?? "", timezone: club.timezone };
  const [v, setV] = useState(init);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = apiErr(update.error);
  const zones = TIMEZONES.some(([z]) => z === club.timezone) ? TIMEZONES : [[club.timezone, club.timezone] as [string, string], ...TIMEZONES];
  return (
    <Card className="p-5 sm:p-6">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); update.mutate({ ...v, city: v.city || null, state: v.state || null }, { onSuccess: () => toast.success(t("Dados do clube salvos")) }); }}>
        <h2 className="rf-text-title-md sm:col-span-2">{t("Dados do clube")}</h2>
        <Field label={t("Nome do clube")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />}</Field>
        <Field label={t("Cidade")} optional>{(id) => <Input id={id} value={v.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
        <Field label={t("Estado")} error={err?.fieldError("state")}>{(id) => <Select id={id} value={v.state} onChange={(e) => set({ state: e.target.value })}><option value="">{t("Escolha…")}</option>{UF.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
        <Field label={t("Fuso horário")} hint={t("Define o “hoje” dos alunos e o horário das aulas. Aulas já criadas mantêm o horário.")} className="sm:col-span-2">
          {(id, d) => <Select id={id} aria-describedby={d} value={v.timezone} onChange={(e) => set({ timezone: e.target.value })}>{zones.map(([z, l]) => <option key={z} value={z}>{t(l)}</option>)}</Select>}
        </Field>
        <SaveRow dirty={dirty} loading={update.isPending} onReset={() => setV(init)} className="sm:col-span-2" />
      </form>
    </Card>
  );
}

function Modalities({ club }: { club: Club }) {
  const update = useUpdateClub(club.id);
  const [mods, setMods] = useState<Sport[]>(club.modalities);
  const [label, setLabel] = useState(club.trainer_label);
  const dirty = label !== club.trainer_label || [...mods].sort().join() !== [...club.modalities].sort().join();
  const err = apiErr(update.error);
  const toggle = (s: Sport) => setMods((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  return (
    <Card className="p-5 sm:p-6">
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); update.mutate({ modalities: mods, trainer_label: label }, { onSuccess: () => toast.success(t("Preferências salvas")) }); }}>
        <div><h2 className="rf-text-title-md">{t("Modalidades e termos")}</h2><p className="text-sm text-fg-muted">{t("As modalidades organizam a biblioteca e os filtros. Os termos mudam como o app chama a equipe.")}</p></div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 rf-text-label-sm">{t("Modalidades do clube")}</legend>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((s) => { const I = SPORT_ICON[s]; const on = mods.includes(s); return (
              <button key={s} type="button" aria-pressed={on} onClick={() => toggle(s)} className={cn("inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}><I className="size-4" />{t(SPORT_LABEL[s])}</button>
            ); })}
          </div>
          {err?.fieldError("modalities") && <p className="rf-text-caption text-danger-text">{err.fieldError("modalities")}</p>}
        </fieldset>
        <div className="grid gap-2">
          <span className="rf-text-label-sm">{t("Como os alunos chamam a equipe")}</span>
          <Segmented label={t("Termo da equipe")} value={label} onChange={setLabel} options={[{ value: "treinador", label: t("Treinador(a)") }, { value: "professor", label: t("Professor(a)") }]} className="w-fit" />
          <p className="text-sm text-fg-muted">{label === "treinador" ? t("Ex.: “Seu treinador comentou no treino”, “Fale com a treinadora”.") : t("Ex.: “Seu professor comentou no treino”, “Fale com a professora”.")}</p>
        </div>
        <SaveRow dirty={dirty} loading={update.isPending} onReset={() => { setMods(club.modalities); setLabel(club.trainer_label); }} />
      </form>
    </Card>
  );
}

function Subdomain({ club, plan }: { club: Club; plan: string }) {
  const update = useUpdateClub(club.id);
  const [sub, setSub] = useState(club.subdomain ?? "");
  const locked = plan === "free";
  const err = apiErr(update.error);
  const dirty = sub !== (club.subdomain ?? "");
  return (
    <Card className="p-5 sm:p-6">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); update.mutate({ subdomain: sub || null }, { onSuccess: () => toast.success(sub ? t("Endereço salvo") : t("Endereço removido"), sub ? `${sub}.runflow.club` : undefined), onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } }); }}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="flex items-center gap-2 rf-text-title-md"><Globe className="size-5" />{t("Endereço próprio")}</h2><p className="text-sm text-fg-muted">{t("Os alunos entram por um link com o nome do clube e já veem suas cores na tela de login.")}</p></div>
          {locked && <Badge tone="accent" icon={<Lock />}>{t("Plano Pro")}</Badge>}
        </div>
        <Field label={t("Endereço")} error={err?.fieldError("subdomain")} hint={t("De 3 a 32 letras, números ou hífens.")}>
          {(id, d) => (
            <div className="flex items-center">
              <Input id={id} aria-describedby={d} value={sub} disabled={locked} onChange={(e) => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder={club.slug} className="rounded-r-none" maxLength={32} />
              <span className="flex h-10 items-center rounded-r-md border border-l-0 border-line-strong bg-sunken px-3 text-sm text-fg-muted">.runflow.club</span>
            </div>
          )}
        </Field>
        {club.subdomain && !dirty && <a href={`https://${club.subdomain}.runflow.club`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-brand-text hover:underline">{club.subdomain}.runflow.club<ExternalLink className="size-3.5" /></a>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle pt-4">
          {locked ? <><span className="mr-auto text-sm text-fg-muted">{t("Disponível a partir do Pro, R$ 20/mês.")}</span><ButtonLink to="/club/billing" variant="secondary">{t("Ver planos")}</ButtonLink></> : <Button type="submit" disabled={!dirty} loading={update.isPending}>{t("Salvar endereço")}</Button>}
        </div>
      </form>
    </Card>
  );
}

function DangerZone({ club }: { club: Club }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const close = useCloseClub(club.id);
  const navigate = useNavigate();
  const err = apiErr(close.error);
  const submit = () => close.mutate(name, {
    onSuccess: async () => {
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
      selectClub(me.memberships[0] ?? null);
      toast.success(t("Clube encerrado"), t("Os membros não têm mais acesso. Obrigado por usar o Runflow."));
      navigate({ to: "/clubs" });
    },
  });
  return (
    <Card className="grid gap-3 border-danger-line p-5 sm:p-6">
      <h2 className="flex items-center gap-2 rf-text-title-md text-danger-text"><AlertTriangle className="size-5" />{t("Zona de perigo")}</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-fg-muted">{t("Encerrar o clube remove o acesso de todos os membros, cancela o plano e libera o endereço. As atividades de cada aluno continuam na conta dele.")}</p>
        <Button variant="danger" onClick={() => setOpen(true)}>{t("Encerrar clube")}</Button>
      </div>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setName(""); }} size="sm" title={t("Encerrar {club}?", { club: club.name })} description={t("Não dá para desfazer. Para confirmar, digite o nome do clube.")}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("Voltar")}</Button><Button variant="danger" loading={close.isPending} disabled={name.trim().toLowerCase() !== club.name.toLowerCase()} onClick={submit}>{t("Encerrar para sempre")}</Button></>}>
        <Field label={t("Nome do clube")} error={err?.fieldError("confirm_name")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={club.name} autoComplete="off" />}</Field>
      </Dialog>
    </Card>
  );
}

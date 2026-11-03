/** O3 · Configurações do clube: data, modalities, terminology, week release (D-031), timezone, danger zone. Route: /club/settings */
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CalendarCheck } from "lucide-react";
import { useState } from "react";
import { useCloseClub, useUpdateClub } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import type { Club, Sport } from "@/api/types";
import { SPORTS, SPORT_ICON, SPORT_LABEL } from "@/components/sport";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { queryClient } from "@/queryClient";
import { Button, Card, Dialog, Field, Input, PageHeader, Segmented, Select, Switch, cn, toast } from "@/ui";

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
      <PageHeader title={t("Configurações do clube")} subtitle={t("Dados, modalidades e liberação dos treinos do {club}", { club: club.name })} />
      <ClubData club={club} key={`d${club.id}`} />
      <Modalities club={club} key={`m${club.id}`} />
      <WeekReleaseSettings club={club} key={`r${club.id}`} />
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

const WEEKDAYS: [number, string][] = [[7, "Domingo"], [1, "Segunda-feira"], [2, "Terça-feira"], [3, "Quarta-feira"], [4, "Quinta-feira"], [5, "Sexta-feira"], [6, "Sábado"]];

/** D-031: when students see what the trainers plan. */
function WeekReleaseSettings({ club }: { club: Club }) {
  const update = useUpdateClub(club.id);
  const init = { release_mode: club.release_mode, auto: club.auto_release_weekday != null, day: club.auto_release_weekday ?? 7, time: club.auto_release_time ?? "18:00" };
  const [v, setV] = useState(init);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = apiErr(update.error);
  const weekly = v.release_mode === "weekly";
  const save = () => update.mutate(
    { release_mode: v.release_mode, ...(weekly ? { auto_release_weekday: v.auto ? v.day : null, auto_release_time: v.auto ? v.time : null } : {}) },
    { onSuccess: () => toast.success(t("Liberação dos treinos salva")) },
  );
  return (
    <Card className="p-5 sm:p-6">
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div><h2 className="flex items-center gap-2 rf-text-title-md"><CalendarCheck className="size-5" />{t("Liberação dos treinos")}</h2><p className="text-sm text-fg-muted">{t("Quando os alunos passam a ver o que a equipe planejou.")}</p></div>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Liberação dos treinos")}>
          {([["weekly", t("Semana a semana"), t("Planeje com antecedência. Os alunos veem cada semana quando ela é liberada, de uma vez, com um só aviso.")], ["immediate", t("Na hora"), t("Cada treino aparece para o aluno assim que é salvo, com um aviso.")]] as const).map(([value, label, hint]) => (
            <button key={value} type="button" role="radio" aria-checked={v.release_mode === value} onClick={() => set({ release_mode: value })}
              className={cn("grid gap-1 rounded-lg border p-4 text-left", v.release_mode === value ? "border-brand-ring bg-brand-soft text-on-brand-soft ring-1 ring-brand-ring" : "border-line bg-surface hover:bg-soft")}>
              <span className="font-semibold">{label}</span><span className={cn("text-sm", v.release_mode === value ? "" : "text-fg-muted")}>{hint}</span>
            </button>
          ))}
        </div>
        {weekly && (
          <div className="grid gap-3 rounded-lg bg-sunken p-4">
            <Switch checked={v.auto} onCheckedChange={(auto) => set({ auto })} label={t("Liberar automaticamente")} description={t("A semana seguinte é liberada para todos neste dia e horário. Você ainda pode liberar antes.")} />
            {v.auto && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("Dia")}>{(id) => <Select id={id} value={v.day} onChange={(e) => set({ day: Number(e.target.value) })}>{WEEKDAYS.map(([d, l]) => <option key={d} value={d}>{t(l)}</option>)}</Select>}</Field>
                <Field label={t("Horário")} error={err?.fieldError("auto_release_time")}>{(id) => <Input id={id} type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} required />}</Field>
              </div>
            )}
            <p className="text-sm text-fg-muted">{t("A semana em andamento fica sempre visível para os alunos.")}</p>
          </div>
        )}
        {err?.fieldError("release_mode") && <p className="rf-text-caption text-danger-text">{err.fieldError("release_mode")}</p>}
        <SaveRow dirty={dirty} loading={update.isPending} onReset={() => setV(init)} />
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
    <Card edge="danger" className="grid gap-3 p-5 sm:p-6">
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

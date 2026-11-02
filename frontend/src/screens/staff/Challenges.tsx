/** W15 · Desafios: create challenges, follow leaderboards, see the monthly ranking. Route: /challenges/manage */
import { Archive, MoreHorizontal, Pencil, Plus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { type ChallengeInput, useArchiveChallenge, useChallenge, useChallenges, useRanking, useSaveChallenge } from "@/api/challenges";
import { useGroups } from "@/api/members";
import type { Challenge, ChallengeMetric, Club, Sport } from "@/api/types";
import { ChallengeStatus, Leaderboard, METRIC_LABEL, challengeWhen, metricValue } from "@/components/challenges";
import { SPORTS, SPORT_LABEL } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { addDays, today as todayFn } from "@/lib/format";
import { Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Select, Skeleton, Textarea, cn, toast } from "@/ui";

const UNIT: Record<ChallengeMetric, string> = { distance: "km", duration: "horas", sessions: "treinos", elevation: "metros" };
export const monthName = (ym: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(ym + "-15T12:00:00Z"));

export function ChallengesManageScreen() {
  const { club } = useClub();
  const list = useChallenges(club?.id);
  const archive = useArchiveChallenge(club?.id ?? "");
  const [edit, setEdit] = useState<Challenge | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  if (!club) return null;
  const items = list.data ?? [];
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Desafios")} subtitle={t("Motive a equipe com metas do mês. O progresso vem das atividades de cada aluno.")} actions={<Button icon={<Plus />} onClick={() => setEdit(null)}>{t("Novo desafio")}</Button>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3" aria-label={t("Desafios")}>
          {list.isPending ? <Skeleton className="h-64" /> : items.length === 0 ? <Card><EmptyState icon={<Trophy />} title={t("Nenhum desafio ainda")} action={<Button icon={<Plus />} onClick={() => setEdit(null)}>{t("Criar desafio")}</Button>}>{t("Ex.: 100 km no mês, 12 treinos, quem sobe mais.")}</EmptyState></Card> : items.map((c) => (
            <Card key={c.id} className={cn("grid gap-3 p-4 sm:p-5", c.status === "finished" && "opacity-80")}>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-on-accent-soft"><Trophy className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{c.name}</h2><ChallengeStatus s={c.status} /></div>
                  <p className="text-sm text-fg-muted">{challengeWhen(c)} · {t(METRIC_LABEL[c.metric])}{c.sport ? ` · ${t(SPORT_LABEL[c.sport])}` : ""}{c.goal ? ` · ${t("meta {g}", { g: metricValue(c.metric, c.goal) })}` : ""}</p>
                </div>
                <Menu trigger={<IconButton size="sm" label={t("Ações de {name}", { name: c.name })}><MoreHorizontal /></IconButton>} items={[
                  { label: t("Editar"), icon: <Pencil />, onSelect: () => setEdit(c) },
                  { label: t("Arquivar"), icon: <Archive />, danger: true, onSelect: () => archive.mutate(c.id, { onSuccess: () => toast.success(t("Desafio arquivado")) }) },
                ]} />
              </div>
              {c.description && <p className="text-sm">{c.description}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted"><Users className="size-4" />{(c.participants_count ? tn(c.participants_count, "{n} participante", "{n} participantes") : t("Ninguém participando ainda"))}</span>
                <Button size="sm" variant="secondary" onClick={() => setOpen(c.id)}>{t("Ver classificação")}</Button>
              </div>
            </Card>
          ))}
        </section>
        <MonthlyRanking club={club} />
      </div>
      <ChallengeForm club={club} value={edit} onClose={() => setEdit(undefined)} />
      <BoardDialog clubId={club.id} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function MonthlyRanking({ club, meId, footer }: { club: Club; meId?: string; footer?: React.ReactNode }) {
  const month = todayFn(club.timezone).slice(0, 7);
  const r = useRanking(club.id, month);
  return (
    <Card className="grid content-start gap-3 p-4 sm:p-5">
      <div><h2 className="rf-text-title-md first-letter:uppercase">{t("Ranking de {m}", { m: monthName(month) })}</h2><p className="text-sm text-fg-muted">{t("Quilômetros correndo no mês. Só aparece quem escolheu participar.")}</p></div>
      {!r.data ? <Skeleton className="h-40" /> : r.data.items.length === 0 ? <p className="text-sm text-fg-muted">{t("Ninguém correu este mês ainda.")}</p> : <Leaderboard rows={r.data.items} metric="distance" meId={meId} />}
      {footer}
    </Card>
  );
}

function BoardDialog({ clubId, id, onClose }: { clubId: string; id: string | null; onClose: () => void }) {
  const c = useChallenge(clubId, id);
  const x = c.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={x?.name ?? t("Classificação")} description={x ? `${challengeWhen(x)} · ${t(METRIC_LABEL[x.metric])}` : undefined}>
      {!x ? <Skeleton className="h-40" /> : <Leaderboard rows={x.leaderboard ?? []} metric={x.metric} />}
    </Dialog>
  );
}

function ChallengeForm({ club, value, onClose }: { club: Club; value: Challenge | null | undefined; onClose: () => void }) {
  return <Dialog open={value !== undefined} onOpenChange={(v) => !v && onClose()} size="lg" title={value ? t("Editar desafio") : t("Novo desafio")}>{value !== undefined && <FormBody club={club} value={value} onClose={onClose} />}</Dialog>;
}
function FormBody({ club, value, onClose }: { club: Club; value: Challenge | null; onClose: () => void }) {
  const save = useSaveChallenge(club.id);
  const groups = useGroups(club.id);
  const today = todayFn(club.timezone);
  const monthEnd = addDays(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
  const [v, setV] = useState<ChallengeInput>({ name: value?.name ?? "", description: value?.description ?? "", metric: value?.metric ?? "distance", sport: value?.sport ?? "run", goal: value?.goal ?? 100, starts_on: value?.starts_on ?? today, ends_on: value?.ends_on ?? monthEnd, group_ids: value?.group_ids ?? [] });
  const set = (p: Partial<ChallengeInput>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, id: value?.id, description: v.description || null }, { onSuccess: () => { toast.success(value ? t("Desafio salvo") : t("Desafio criado"), value ? undefined : t("Os alunos já podem participar.")); onClose(); }, onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } }); }}>
      <Field label={t("Nome")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Ex.: 100 km em novembro")} autoFocus />}</Field>
      <Field label={t("O que conta")} error={err?.fieldError("metric")}>{(id) => <Select id={id} value={v.metric} onChange={(e) => set({ metric: e.target.value as ChallengeMetric })}>{(Object.keys(METRIC_LABEL) as ChallengeMetric[]).map((m) => <option key={m} value={m}>{t(METRIC_LABEL[m])}</option>)}</Select>}</Field>
      <Field label={t("Modalidade")}>{(id) => <Select id={id} value={v.sport ?? ""} onChange={(e) => set({ sport: (e.target.value || null) as Sport | null })}><option value="">{t("Qualquer uma")}</option>{SPORTS.map((s) => <option key={s} value={s}>{t(SPORT_LABEL[s])}</option>)}</Select>}</Field>
      <Field label={t("Meta por aluno ({u})", { u: t(UNIT[v.metric]) })} optional hint={t("Sem meta, vale só a classificação.")} error={err?.fieldError("goal")}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} value={v.goal ?? ""} onChange={(e) => set({ goal: e.target.value ? Number(e.target.value) : null })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Início")} error={err?.fieldError("starts_on")}>{(id) => <Input id={id} type="date" value={v.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />}</Field>
        <Field label={t("Fim")} error={err?.fieldError("ends_on")}>{(id) => <Input id={id} type="date" value={v.ends_on} onChange={(e) => set({ ends_on: e.target.value })} />}</Field>
      </div>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="mb-2 rf-text-label-sm">{t("Para quem")}</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!v.group_ids?.length} onClick={() => set({ group_ids: [] })} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", !v.group_ids?.length ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{t("Todo o clube")}</button>
          {(groups.data ?? []).map((g) => { const on = v.group_ids?.includes(g.id); return <button key={g.id} type="button" aria-pressed={on} onClick={() => set({ group_ids: on ? v.group_ids!.filter((x) => x !== g.id) : [...(v.group_ids ?? []), g.id] })} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>; })}
        </div>
      </fieldset>
      <Field label={t("Descrição")} optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder={t("Regras, prêmio, recado para a equipe")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{value ? t("Salvar") : t("Criar desafio")}</Button></div>
    </form>
  );
}


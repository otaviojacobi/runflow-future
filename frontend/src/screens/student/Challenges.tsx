/** M11 · Desafios: badges and streak, club challenges with my progress, monthly ranking (opt-in). Route: /challenges */
import { Flame, Trophy } from "lucide-react";
import { useState } from "react";
import { useChallenge, useChallenges, useJoinChallenge, useMyBadges, useRanking, useSetRankingOptIn } from "@/api/challenges";
import type { Challenge } from "@/api/types";
import { BadgeTile, ChallengeStatus, GoalBar, Leaderboard, METRIC_LABEL, challengeWhen, metricValue } from "@/components/challenges";
import { SPORT_LABEL } from "@/components/sport";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { today as todayFn } from "@/lib/format";
import { Button, Card, Dialog, EmptyState, PageHeader, Skeleton, Switch, toast } from "@/ui";
import { MonthlyRanking } from "../staff/Challenges";

export function ChallengesScreen() {
  const { club, ctx } = useClub();
  const list = useChallenges(club?.id);
  const badges = useMyBadges(club?.id);
  const join = useJoinChallenge(club?.id ?? "");
  const optIn = useSetRankingOptIn(club?.id ?? "");
  const ranking = useRanking(club?.id, todayFn(club?.timezone).slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  if (!club || !ctx) return null;
  const items = list.data ?? [];
  const toggle = (c: Challenge) => join.mutate({ id: c.id, join: !c.joined }, { onSuccess: () => toast.success(c.joined ? t("Você saiu do desafio") : t("Bora! Você está no desafio"), c.joined ? undefined : t("Seu progresso aparece na classificação.")), onError: toast.error });
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={t("Desafios")} subtitle={t("Metas da equipe, suas conquistas e o ranking do mês")} />
      <section className="grid gap-3" aria-labelledby="badges-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="badges-h" className="rf-text-title-md">{t("Suas conquistas")}</h2>
          {!!badges.data?.streak_weeks && <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-sm font-bold text-on-accent-soft ring-1 ring-inset ring-accent-line"><Flame className="size-4" />{tn(badges.data.streak_weeks, "{n} semana seguida", "{n} semanas seguidas")}</span>}
        </div>
        {!badges.data ? <Skeleton className="h-28" /> : badges.data.items.length === 0 ? <p className="rounded-lg bg-sunken px-4 py-5 text-center text-fg-muted">{t("Treine 4 semanas seguidas ou complete um desafio para ganhar a primeira.")}</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{badges.data.items.map((b) => <BadgeTile key={b.id} b={b} />)}</ul>
        )}
      </section>
      <section className="grid gap-3" aria-labelledby="ch-h">
        <h2 id="ch-h" className="rf-text-title-md">{t("Desafios do clube")}</h2>
        {list.isPending ? <Skeleton className="h-40" /> : items.length === 0 ? <Card><EmptyState icon={<Trophy />} title={t("Nenhum desafio agora")}>{t("Quando a equipe lançar um desafio, ele aparece aqui.")}</EmptyState></Card> : items.map((c) => (
          <Card key={c.id} edge={c.joined && c.status === "active" ? "brand" : undefined} className="grid gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{c.name}</h3><ChallengeStatus s={c.status} /></div><p className="text-sm text-fg-muted">{challengeWhen(c)} · {t(METRIC_LABEL[c.metric])}{c.sport ? ` · ${t(SPORT_LABEL[c.sport])}` : ""}</p></div>
              {c.status !== "finished" && <Button size="sm" variant={c.joined ? "ghost" : "primary"} loading={join.isPending && join.variables?.id === c.id} onClick={() => toggle(c)}>{c.joined ? t("Sair") : t("Participar")}</Button>}
            </div>
            {c.description && <p className="text-sm">{c.description}</p>}
            {c.joined && c.my_progress ? <GoalBar value={c.my_progress.value} goal={c.goal} metric={c.metric} /> : c.goal ? <p className="text-sm text-fg-muted">{t("Meta: {g}", { g: metricValue(c.metric, c.goal) })}</p> : null}
            <div className="flex items-center justify-between gap-2 text-sm text-fg-muted">
              <span>{c.joined && c.my_progress ? t("Você está em {r}º de {n}", { r: c.my_progress.rank, n: c.participants_count }) : (c.participants_count ? tn(c.participants_count, "{n} participante", "{n} participantes") : t("Ninguém participando ainda"))}</span>
              <button type="button" onClick={() => setOpen(c.id)} className="font-semibold text-brand-text hover:underline">{t("Classificação")}</button>
            </div>
          </Card>
        ))}
      </section>
      <MonthlyRanking club={club} meId={ctx.membership.id} footer={ranking.data && (
        <div className="border-t border-line-subtle pt-3"><Switch checked={ranking.data.me.opted_in} onCheckedChange={(v) => optIn.mutate(v, { onSuccess: () => toast.success(v ? t("Você entrou no ranking") : t("Você saiu do ranking")) })} label={t("Aparecer no ranking do clube")} description={t("Mostra seus quilômetros do mês para a equipe.")} /></div>
      )} />
      <Board clubId={club.id} id={open} meId={ctx.membership.id} onClose={() => setOpen(null)} />
    </div>
  );
}

function Board({ clubId, id, meId, onClose }: { clubId: string; id: string | null; meId: string; onClose: () => void }) {
  const c = useChallenge(clubId, id);
  const x = c.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={x?.name ?? t("Classificação")} description={x ? challengeWhen(x) : undefined}>
      {!x ? <Skeleton className="h-40" /> : <Leaderboard rows={x.leaderboard ?? []} metric={x.metric} meId={meId} />}
    </Dialog>
  );
}

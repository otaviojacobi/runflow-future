/** W2 · Alunos: search, groups, compliance, this week, last activity, Strava. Route: /students */
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, ChevronRight, Lock, Search, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useAthletes, useGroups } from "@/api/members";
import type { AthleteSummary, Goal } from "@/api/types";
import { InviteDialog } from "@/components/club/InviteDialog";
import { ComplianceBar } from "@/components/workout";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Skeleton, cn } from "@/ui";
import { GOALS } from "../onboarding/Welcome";
import { GroupsDialog } from "./GroupsDialog";

export const goalLabel = (g: Goal | null) => (g ? t(GOALS.find((x) => x.value === g)?.label ?? g) : null);

function StravaIcon({ s }: { s: AthleteSummary["strava"] }) {
  if (s === "none") return <span className="text-xs text-fg-subtle">–</span>;
  return s === "shared"
    ? <span title={t("Strava conectado e compartilhado")} className="inline-flex items-center gap-1 text-xs font-semibold text-success-text"><Activity className="size-4" />{t("Strava")}</span>
    : <span title={t("Strava conectado, mas sem compartilhar com o clube")} className="inline-flex items-center gap-1 text-xs font-semibold text-fg-muted"><Lock className="size-3.5" />{t("Privado")}</span>;
}

export function StudentsScreen() {
  const { club } = useClub();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const [invite, setInvite] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const groups = useGroups(club?.id);
  const athletes = useAthletes(club?.id, { q: q || undefined, group_id: group === "all" ? undefined : group });
  const rows = useMemo(() => {
    const list = [...(athletes.data ?? [])];
    if (sort === "compliance") list.sort((a, b) => (a.compliance_pct ?? 101) - (b.compliance_pct ?? 101));
    return list;
  }, [athletes.data, sort]);
  if (!club) return null;
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name;
  const open = (a: AthleteSummary) => navigate({ to: "/students/$id", params: { id: a.membership.id } });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Alunos")} subtitle={athletes.data ? tn(athletes.data.length, "{n} aluno ativo", "{n} alunos ativos") : " "}
        actions={<><Button variant="secondary" icon={<Users />} onClick={() => setGroupsOpen(true)}>{t("Grupos")}</Button><Button icon={<UserPlus />} onClick={() => setInvite(true)}>{t("Convidar alunos")}</Button></>} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar aluno")} placeholder={t("Buscar aluno")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por grupo")}>
          {[{ id: "all", name: t("Todos") }, ...(groups.data ?? [])].map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} aria-pressed={group === g.id}
              className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors", group === g.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>
          ))}
        </div>
        <Segmented size="sm" className="ml-auto" label={t("Ordenar")} value={sort} onChange={setSort} options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} />
      </div>

      {athletes.isPending ? (
        <Card className="grid gap-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Users />} title={q || group !== "all" ? t("Ninguém encontrado") : t("Nenhum aluno ainda")} action={!q && group === "all" && <Button icon={<UserPlus />} onClick={() => setInvite(true)}>{t("Convidar alunos")}</Button>}>
          {q || group !== "all" ? t("Tente outro nome ou grupo.") : t("Convide os alunos por e-mail. Eles aparecem aqui quando aceitarem.")}
        </EmptyState></Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">
                <tr><th className="px-4 py-3">{t("Aluno")}</th><th className="px-3 py-3">{t("Grupos")}</th><th className="w-36 px-3 py-3">{t("Aderência 28 dias")}</th><th className="px-3 py-3">{t("Semana")}</th><th className="px-3 py-3">{t("Última atividade")}</th><th className="px-3 py-3">{t("Relógio")}</th><th className="w-10" /></tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.membership.id} onClick={() => open(a)} className="cursor-pointer border-t border-line-subtle hover:bg-soft">
                    <td className="px-4 py-3"><Link to="/students/$id" params={{ id: a.membership.id }} className="flex items-center gap-3 font-semibold outline-none focus-visible:underline" onClick={(e) => e.stopPropagation()}><Avatar name={a.user.name} src={a.user.avatar_url} size={34} /><span><span className="block">{a.user.name}</span><span className="block text-xs font-normal text-fg-muted">{[goalLabel(a.goal), a.level && t({ beginner: "Iniciante", intermediate: "Intermediário", advanced: "Avançado" }[a.level])].filter(Boolean).join(" · ") || "–"}</span></span></Link></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{a.group_ids.map((g) => <Badge key={g}>{groupName(g)}</Badge>)}</div></td>
                    <td className="px-3 py-3">{a.shares_data ? <ComplianceBar pct={a.compliance_pct} /> : <span className="text-xs text-fg-subtle">{t("Sem consentimento")}</span>}</td>
                    <td className="px-3 py-3 tabular-nums">{a.week.planned ? <span><b>{a.week.done}</b><span className="text-fg-muted">/{a.week.planned}</span></span> : <span className="text-fg-subtle">{t("Sem treinos")}</span>}</td>
                    <td className="px-3 py-3 text-fg-muted">{a.last_activity_at ? ago(a.last_activity_at) : "–"}</td>
                    <td className="px-3 py-3"><StravaIcon s={a.strava} /></td>
                    <td className="pr-3"><ChevronRight className="size-4 text-fg-subtle" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ul className="grid gap-2 md:hidden">
            {rows.map((a) => (
              <li key={a.membership.id}>
                <Link to="/students/$id" params={{ id: a.membership.id }} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface p-3">
                  <Avatar name={a.user.name} size={40} />
                  <span className="min-w-0"><span className="block truncate font-semibold">{a.user.name}</span><span className="block truncate text-xs text-fg-muted">{a.week.planned ? t("{done}/{planned} na semana", { done: a.week.done, planned: a.week.planned }) : t("Sem treinos na semana")} · {a.last_activity_at ? ago(a.last_activity_at) : t("sem atividade")}</span></span>
                  <span className="w-16">{a.shares_data && <ComplianceBar pct={a.compliance_pct} />}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <InviteDialog club={club} open={invite} onOpenChange={setInvite} />
      <GroupsDialog clubId={club.id} open={groupsOpen} onOpenChange={setGroupsOpen} />
    </div>
  );
}

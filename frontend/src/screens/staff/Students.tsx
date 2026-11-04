/** W2 · Alunos: search, groups (create, edit, move students in and out), compliance, this week, last activity, Strava. Route: /students */
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, ChevronRight, FolderMinus, FolderPlus, Lock, Pencil, Plus, Search, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAthletes, useGroups, useSetGroupMembers } from "@/api/members";
import type { AthleteSummary, Goal, Group } from "@/api/types";
import { InviteDialog } from "@/components/club/InviteDialog";
import { ComplianceBar } from "@/components/workout";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { Avatar, Badge, Button, Card, EmptyState, IconButton, Input, Menu, PageHeader, Segmented, Skeleton, cn, toast, type MenuItem } from "@/ui";
import { GOALS } from "../onboarding/Welcome";
import { GroupsDialog } from "./GroupsDialog";

export const goalLabel = (g: Goal | null) => (g ? t(GOALS.find((x) => x.value === g)?.label ?? g) : null);

function StravaIcon({ s }: { s: AthleteSummary["strava"] }) {
  if (s === "none") return <span className="text-xs text-fg-subtle">–</span>;
  return s === "shared"
    ? <span title={t("Strava conectado e compartilhado")} className="inline-flex items-center gap-1 text-xs font-semibold text-success-text"><Activity className="size-4" />{t("Strava")}</span>
    : <span title={t("Strava conectado, mas sem compartilhar com o clube")} className="inline-flex items-center gap-1 text-xs font-semibold text-fg-muted"><Lock className="size-3.5 shrink-0" />{t("Não compartilha o Strava")}</span>;
}

const chip = "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand-ring";
const box = "size-[18px] shrink-0 cursor-pointer accent-brand";

export function StudentsScreen() {
  const { club } = useClub();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<"name" | "compliance">("name");
  const [invite, setInvite] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsStart, setGroupsStart] = useState<Partial<Group> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const groups = useGroups(club?.id);
  const setMembers = useSetGroupMembers(club?.id ?? "");
  const athletes = useAthletes(club?.id, { q: q || undefined, group_id: group === "all" ? undefined : group });
  const rows = useMemo(() => {
    const list = [...(athletes.data ?? [])];
    if (sort === "compliance") list.sort((a, b) => (a.compliance_pct ?? 101) - (b.compliance_pct ?? 101));
    return list;
  }, [athletes.data, sort]);
  if (!club) return null;
  const list = groups.data ?? [];
  const groupName = (id: string) => list.find((g) => g.id === id)?.name;
  const current = list.find((g) => g.id === group) ?? null;
  const open = (a: AthleteSummary) => navigate({ to: "/students/$id", params: { id: a.membership.id } });
  const openGroups = (start: Partial<Group> | null = null) => { setGroupsStart(start); setGroupsOpen(true); };
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const allOn = rows.length > 0 && rows.every((a) => selected.has(a.membership.id));
  const picked = [...selected];
  const move = (g: Group, add: boolean) => {
    const members = add ? [...new Set([...g.member_ids, ...picked])] : g.member_ids.filter((id) => !selected.has(id));
    const n = add ? members.length - g.member_ids.length : g.member_ids.length - members.length;
    setMembers.mutate({ id: g.id, member_ids: members }, {
      onSuccess: () => {
        toast.success(n === 0 ? t("Já estavam em {g}", { g: g.name }) : add ? tn(n, "{n} aluno adicionado a {g}", "{n} alunos adicionados a {g}", { g: g.name }) : tn(n, "{n} aluno saiu de {g}", "{n} alunos saíram de {g}", { g: g.name }));
        setSelected(new Set());
      },
      onError: toast.error,
    });
  };
  const addItems: MenuItem[] = [
    ...list.map((g) => ({ label: g.name, icon: <Users />, onSelect: () => move(g, true) })),
    ...(list.length ? (["separator"] as const) : []),
    { label: t("Novo grupo com eles…"), icon: <Plus />, onSelect: () => openGroups({ member_ids: picked }) },
  ];
  const leaving = list.filter((g) => g.member_ids.some((id) => selected.has(id)));
  const removeItems: MenuItem[] = leaving.map((g) => ({ label: g.name, icon: <Users />, onSelect: () => move(g, false) }));

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Alunos")} subtitle={athletes.data ? tn(athletes.data.length, "{n} aluno ativo", "{n} alunos ativos") : " "}
        actions={<><Button variant="secondary" icon={<Users />} onClick={() => openGroups()}>{t("Grupos")}</Button><Button icon={<UserPlus />} onClick={() => setInvite(true)}>{t("Convidar alunos")}</Button></>} />
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar aluno")} placeholder={t("Buscar aluno")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
          {list.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por grupo")}>
              {[{ id: "all", name: t("Todos") }, ...list].map((g) => (
                <button key={g.id} onClick={() => { setGroup(g.id); setSelected(new Set()); }} aria-pressed={group === g.id}
                  className={cn(chip, group === g.id ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>
              ))}
              <button onClick={() => openGroups({})} className={cn(chip, "border-dashed border-line-strong text-fg-muted hover:bg-soft hover:text-fg")}><Plus className="size-3.5" aria-hidden />{t("Novo grupo")}</button>
            </div>
          )}
          <Segmented size="sm" className="ml-auto" label={t("Ordenar")} value={sort} onChange={setSort} options={[{ value: "name", label: t("Nome") }, { value: "compliance", label: t("Menor aderência") }]} />
        </div>
        {groups.data && list.length === 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><Users className="size-4" /></span>
            <p className="min-w-0 flex-1 text-sm text-fg-muted">{t("Agrupe alunos para atribuir treinos e planilhas de uma vez. Ex.: Iniciantes, Maratona SP 2027, Turma das 6h.")}</p>
            <Button size="sm" icon={<Plus />} onClick={() => openGroups({})}>{t("Criar grupo")}</Button>
          </div>
        )}
        {current && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{current.name}</span>
            <span className="text-fg-muted">· {current.member_ids.length ? tn(current.member_ids.length, "{n} aluno", "{n} alunos") : t("nenhum aluno ainda")}</span>
            <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => openGroups(current)}>{t("Editar grupo")}</Button>
          </div>
        )}
        {selected.size > 0 && (
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-brand-ring bg-raised px-3 py-2 shadow-md" role="region" aria-label={t("Alunos selecionados")}>
            <span className="mr-auto text-sm font-semibold">{tn(selected.size, "{n} aluno selecionado", "{n} alunos selecionados")}</span>
            <Menu align="end" items={addItems} trigger={<Button size="sm" icon={<FolderPlus />} loading={setMembers.isPending}>{t("Adicionar ao grupo")}</Button>} />
            {removeItems.length > 0 && <Menu align="end" items={removeItems} trigger={<Button size="sm" variant="secondary" icon={<FolderMinus />}>{t("Remover do grupo")}</Button>} />}
            <IconButton label={t("Limpar seleção")} onClick={() => setSelected(new Set())}><X /></IconButton>
          </div>
        )}
      </div>

      {athletes.isPending ? (
        <Card className="grid gap-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Users />} title={q || group !== "all" ? t("Ninguém encontrado") : t("Nenhum aluno ainda")} action={!q && group === "all" ? <Button icon={<UserPlus />} onClick={() => setInvite(true)}>{t("Convidar alunos")}</Button> : current && !q ? <Button variant="secondary" icon={<Pencil />} onClick={() => openGroups(current)}>{t("Adicionar alunos ao grupo")}</Button> : undefined}>
          {q ? t("Tente outro nome.") : current ? t("Este grupo ainda não tem alunos.") : t("Convide os alunos por e-mail. Eles aparecem aqui quando aceitarem.")}
        </EmptyState></Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left text-[11px] font-bold uppercase tracking-[0.06em] text-fg-muted">
                <tr>
                  <th className="w-10 pl-4"><input type="checkbox" className={box} aria-label={t("Selecionar todos")} checked={allOn} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((a) => a.membership.id)) : new Set())} /></th>
                  <th className="px-3 py-3">{t("Aluno")}</th><th className="px-3 py-3">{t("Grupos")}</th><th className="w-36 px-3 py-3">{t("Aderência 28 dias")}</th><th className="px-3 py-3">{t("Semana")}</th><th className="px-3 py-3">{t("Última atividade")}</th><th className="px-3 py-3">{t("Relógio")}</th><th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.membership.id} onClick={() => open(a)} className={cn("cursor-pointer border-t border-line-subtle hover:bg-soft", selected.has(a.membership.id) && "bg-brand-soft/40")}>
                    <td className="pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" className={box} aria-label={t("Selecionar {name}", { name: a.user.name })} checked={selected.has(a.membership.id)} onChange={(e) => toggle(a.membership.id, e.target.checked)} /></td>
                    <td className="px-3 py-3"><Link to="/students/$id" params={{ id: a.membership.id }} className="flex items-center gap-3 font-semibold outline-none focus-visible:underline" onClick={(e) => e.stopPropagation()}><Avatar name={a.user.name} src={a.user.avatar_url} size={34} /><span><span className="block">{a.user.name}</span><span className="block text-xs font-normal text-fg-muted">{[goalLabel(a.goal), a.level && t({ beginner: "Iniciante", intermediate: "Intermediário", advanced: "Avançado" }[a.level])].filter(Boolean).join(" · ") || "–"}</span></span></Link></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{a.group_ids.map((g) => <Badge key={g}>{groupName(g)}</Badge>)}</div></td>
                    <td className="px-3 py-3">{a.shares_data ? <ComplianceBar pct={a.compliance_pct} /> : <span className="text-xs text-fg-muted">{t("Não compartilha os treinos")}</span>}</td>
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
              <li key={a.membership.id} className="flex items-center gap-2">
                <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
                  <input type="checkbox" className={box} aria-label={t("Selecionar {name}", { name: a.user.name })} checked={selected.has(a.membership.id)} onChange={(e) => toggle(a.membership.id, e.target.checked)} />
                </label>
                <Link to="/students/$id" params={{ id: a.membership.id }} className={cn("grid min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface p-3", selected.has(a.membership.id) && "border-brand-ring")}>
                  <Avatar name={a.user.name} size={40} />
                  <span className="min-w-0"><span className="block truncate font-semibold">{a.user.name}</span><span className="block truncate text-xs text-fg-muted">{a.week.planned ? t("{done}/{planned} na semana", { done: a.week.done, planned: a.week.planned }) : t("Sem treinos na semana")} · {a.last_activity_at ? ago(a.last_activity_at) : t("sem atividade")}</span>
                    {a.group_ids.length > 0 && <span className="block truncate text-xs text-fg-muted">{a.group_ids.map(groupName).filter(Boolean).join(" · ")}</span>}
                    {(!a.shares_data || a.strava === "private") && <span className="flex items-center gap-1 truncate text-xs font-semibold text-fg-muted"><Lock className="size-3.5 shrink-0" />{!a.shares_data ? t("Não compartilha os treinos") : t("Não compartilha o Strava")}</span>}</span>
                  <span className="w-16">{a.shares_data && <ComplianceBar pct={a.compliance_pct} />}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <InviteDialog club={club} open={invite} onOpenChange={setInvite} />
      <GroupsDialog clubId={club.id} open={groupsOpen} onOpenChange={setGroupsOpen} start={groupsStart} />
    </div>
  );
}

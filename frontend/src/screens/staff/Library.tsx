/** W6 · Biblioteca: workout templates by sport. Route: /biblioteca */
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, Copy, Library as LibraryIcon, MoreHorizontal, Pencil, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useArchiveTemplate, useSaveTemplate, useTemplates } from "@/api/library";
import type { Sport, WorkoutTemplate } from "@/api/types";
import { SPORT_LABEL, SportChip } from "@/components/sport";
import { IntensityProfile } from "@/components/workout";
import { t, tn } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago, distance, duration } from "@/lib/format";
import { Button, ButtonLink, Card, Dialog, EmptyState, IconButton, Input, Menu, PageHeader, Skeleton, cn, toast } from "@/ui";

export function LibraryScreen() {
  const { club } = useClub();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sport, setSport] = useState<Sport | "">("");
  const all = useTemplates(club?.id);
  const save = useSaveTemplate(club?.id ?? "");
  const archive = useArchiveTemplate(club?.id ?? "");
  const [toArchive, setToArchive] = useState<WorkoutTemplate | null>(null);
  const sports = useMemo(() => [...new Set((all.data ?? []).map((w) => w.sport))], [all.data]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all.data ?? []).filter((w) => (!sport || w.sport === sport) && (!needle || w.name.toLowerCase().includes(needle) || w.tags.some((x) => x.includes(needle))));
  }, [all.data, q, sport]);
  if (!club) return null;

  const duplicate = (w: WorkoutTemplate) =>
    save.mutate({ data: { name: t("{name} (cópia)", { name: w.name }), sport: w.sport, description: w.description, structure: w.structure, est_duration_s: w.est_duration_s, est_distance_m: w.est_distance_m, tags: w.tags } }, {
      onSuccess: (r) => { toast.success(t("Treino duplicado")); navigate({ to: "/biblioteca/$id", params: { id: r.id } }); },
      onError: toast.error,
    });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title={t("Biblioteca")} subtitle={all.data ? tn(all.data.length, "{n} treino pronto para usar", "{n} treinos prontos para usar") : " "}
        actions={<ButtonLink to="/biblioteca/novo" icon={<Plus />}>{t("Novo treino")}</ButtonLink>} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar treino")} placeholder={t("Buscar por nome ou tag")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtrar por modalidade")}>
          {(["", ...sports] as (Sport | "")[]).map((s) => (
            <button key={s || "all"} onClick={() => setSport(s)} aria-pressed={sport === s}
              className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors", sport === s ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>
              {s ? t(SPORT_LABEL[s]) : t("Todos")}
            </button>
          ))}
        </div>
      </div>
      {all.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<LibraryIcon />} title={q || sport ? t("Nada encontrado") : t("Sua biblioteca está vazia")} action={!q && !sport && <ButtonLink to="/biblioteca/novo" icon={<Plus />}>{t("Criar o primeiro treino")}</ButtonLink>}>
          {q || sport ? t("Tente outra busca ou modalidade.") : t("Monte treinos uma vez e reaproveite para todos os alunos.")}
        </EmptyState></Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((w) => (
            <li key={w.id} className="group relative">
              <Link to="/biblioteca/$id" params={{ id: w.id }} className="grid h-full gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring">
                <div className="flex items-center justify-between gap-2 pr-9"><SportChip sport={w.sport} size="sm" /><span className="text-xs text-fg-muted">{[w.est_duration_s && `≈ ${duration(w.est_duration_s)}`, w.est_distance_m && distance(w.est_distance_m, { swim: w.sport === "swim" })].filter(Boolean).join(" · ")}</span></div>
                <div className="font-semibold leading-snug">{w.name}</div>
                <IntensityProfile structure={w.structure} sport={w.sport} height={36} />
                <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
                  <span className="truncate">{w.tags.slice(0, 3).map((x) => `#${x}`).join(" ")}</span>
                  <span className="shrink-0">{t("editado {when}", { when: ago(w.updated_at) })}</span>
                </div>
              </Link>
              <div className="absolute right-2 top-2">
                <Menu trigger={<IconButton size="sm" label={t("Ações para {name}", { name: w.name })}><MoreHorizontal /></IconButton>} items={[
                  { label: t("Editar"), icon: <Pencil />, onSelect: () => navigate({ to: "/biblioteca/$id", params: { id: w.id } }) },
                  { label: t("Duplicar"), icon: <Copy />, onSelect: () => duplicate(w) },
                  "separator",
                  { label: t("Arquivar"), icon: <Archive />, danger: true, onSelect: () => setToArchive(w) },
                ]} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!toArchive} onOpenChange={(v) => !v && setToArchive(null)} size="sm" title={t("Arquivar “{name}”?", { name: toArchive?.name ?? "" })}
        description={t("Ele sai da biblioteca. Os treinos já atribuídos aos alunos não mudam.")}
        footer={<><Button variant="secondary" onClick={() => setToArchive(null)}>{t("Cancelar")}</Button><Button variant="danger" loading={archive.isPending} onClick={() => toArchive && archive.mutate(toArchive.id, { onSuccess: () => { toast.success(t("Treino arquivado")); setToArchive(null); }, onError: toast.error })}>{t("Arquivar")}</Button></>} />
    </div>
  );
}

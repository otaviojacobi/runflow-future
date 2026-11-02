/** W18 · Exercícios: Runflow catalog + club exercises, with video links and coaching cues. Route: /exercises */
import { Dumbbell, MoreHorizontal, Pencil, PlayCircle, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useArchiveExercise, useExercises, useSaveExercise } from "@/api/exercises";
import type { Club, ExerciseCategory, LibraryExercise } from "@/api/types";
import { CATEGORY_LABEL, ExerciseHowTo } from "@/components/ExerciseVideo";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { embedUrl, thumbnailUrl } from "@/lib/video";
import { Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Select, Skeleton, Textarea, cn, toast } from "@/ui";

const CATS = Object.keys(CATEGORY_LABEL) as ExerciseCategory[];

export function ExercisesScreen() {
  const { club } = useClub();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const list = useExercises(club?.id, { q: q || undefined, category: cat || undefined });
  const archive = useArchiveExercise(club?.id ?? "");
  const [edit, setEdit] = useState<{ value: LibraryExercise | null; copyFrom?: LibraryExercise } | null>(null);
  const [view, setView] = useState<LibraryExercise | null>(null);
  if (!club) return null;
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader title={t("Exercícios")} subtitle={t("Catálogo do Runflow e os exercícios do clube, com vídeo e dicas. Aparecem para o aluno nos treinos de força e mobilidade.")} actions={<Button icon={<Plus />} onClick={() => setEdit({ value: null })}>{t("Novo exercício")}</Button>} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar exercício")} placeholder={t("Buscar por nome ou músculo")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" /></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Categoria")}>
          {[["", "Todos"], ...CATS.map((c) => [c, CATEGORY_LABEL[c]])].map(([v, l]) => <button key={v} onClick={() => setCat(v!)} aria-pressed={cat === v} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", cat === v ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{t(l!)}</button>)}
        </div>
      </div>
      {list.isPending ? <Skeleton className="h-64" /> : !list.data?.length ? <Card><EmptyState icon={<Dumbbell />} title={t("Nenhum exercício encontrado")}>{t("Tente outro termo ou crie um exercício do clube.")}</EmptyState></Card> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((e) => {
            const thumb = thumbnailUrl(e.video_url);
            return (
              <li key={e.id}>
                <Card className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
                  <button type="button" onClick={() => setView(e)} aria-label={t("Ver {name}", { name: e.name })} className={cn("relative grid place-items-center bg-sunken text-fg-subtle hover:text-fg", embedUrl(e.video_url) ? "aspect-video" : "h-14")}>
                    {thumb ? <img src={thumb} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" /> : null}
                    {embedUrl(e.video_url) ? <PlayCircle className="relative size-12 drop-shadow" /> : <span className="flex items-center gap-1.5 text-sm"><Dumbbell className="size-4" />{e.cues ? t("Ver dicas") : t("Sem vídeo")}</span>}
                  </button>
                  <div className="grid content-start gap-2 p-4">
                    <div className="flex items-start gap-2">
                      <h2 className="min-w-0 flex-1 font-semibold">{e.name}</h2>
                      <Menu trigger={<IconButton size="sm" label={t("Ações de {name}", { name: e.name })}><MoreHorizontal /></IconButton>} items={e.scope === "club" ? [
                        { label: t("Editar"), icon: <Pencil />, onSelect: () => setEdit({ value: e }) },
                        { label: t("Remover"), icon: <Trash2 />, danger: true, onSelect: () => archive.mutate(e.id, { onSuccess: () => toast.success(t("Exercício removido")) }) },
                      ] : [{ label: t("Criar versão do clube"), icon: <Pencil />, onSelect: () => setEdit({ value: null, copyFrom: e }) }]} />
                    </div>
                    <div className="flex flex-wrap gap-1.5"><Badge>{t(CATEGORY_LABEL[e.category])}</Badge>{e.scope === "club" ? <Badge tone="brand">{t("Do clube")}</Badge> : <Badge tone="neutral">{t("Runflow")}</Badge>}</div>
                    {e.muscles.length > 0 && <p className="text-sm text-fg-muted">{e.muscles.join(" · ")}</p>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <ExerciseForm club={club} state={edit} onClose={() => setEdit(null)} />
      <ExerciseHowTo exercise={view} open={!!view} onOpenChange={(v) => !v && setView(null)} />
    </div>
  );
}

function ExerciseForm({ club, state, onClose }: { club: Club; state: { value: LibraryExercise | null; copyFrom?: LibraryExercise } | null; onClose: () => void }) {
  return <Dialog open={!!state} onOpenChange={(v) => !v && onClose()} size="lg" title={state?.value ? t("Editar exercício") : state?.copyFrom ? t("Versão do clube") : t("Novo exercício")} description={state?.copyFrom ? t("Substitui o exercício do catálogo para os seus alunos: use seu vídeo e suas dicas.") : undefined}>{state && <FormBody club={club} state={state} onClose={onClose} />}</Dialog>;
}
function FormBody({ club, state, onClose }: { club: Club; state: { value: LibraryExercise | null; copyFrom?: LibraryExercise }; onClose: () => void }) {
  const save = useSaveExercise(club.id);
  const base = state.value ?? state.copyFrom;
  const [v, setV] = useState({ name: base?.name ?? "", category: base?.category ?? ("strength" as ExerciseCategory), muscles: base?.muscles.join(", ") ?? "", equipment: base?.equipment.join(", ") ?? "", cues: base?.cues ?? "", video_url: base?.video_url ?? "" });
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const preview = embedUrl(v.video_url);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: state.value?.id, name: v.name, category: v.category, muscles: list(v.muscles), equipment: list(v.equipment), cues: v.cues || null, video_url: v.video_url || null }, { onSuccess: () => { toast.success(t("Exercício salvo")); onClose(); }, onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } }); }}>
      <Field label={t("Nome")} error={err?.fieldError("name")}>{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} readOnly={!!state.copyFrom} />}</Field>
      <Field label={t("Categoria")}>{(id) => <Select id={id} value={v.category} onChange={(e) => set({ category: e.target.value as ExerciseCategory })}>{CATS.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}</Select>}</Field>
      <Field label={t("Músculos")} optional hint={t("Separe por vírgula")}>{(id, d) => <Input id={id} aria-describedby={d} value={v.muscles} onChange={(e) => set({ muscles: e.target.value })} placeholder={t("glúteos, quadríceps")} />}</Field>
      <Field label={t("Equipamento")} optional hint={t("Separe por vírgula")}>{(id, d) => <Input id={id} aria-describedby={d} value={v.equipment} onChange={(e) => set({ equipment: e.target.value })} placeholder={t("halteres, banco")} />}</Field>
      <Field label={t("Link do vídeo")} optional hint={t("YouTube ou Vimeo. Dica: grave no seu estúdio e publique como não listado.")} error={err?.fieldError("video_url")} className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} type="url" value={v.video_url} onChange={(e) => set({ video_url: e.target.value })} placeholder="https://youtu.be/…" />}</Field>
      {preview && <div className="aspect-video overflow-hidden rounded-lg bg-sunken sm:col-span-2"><iframe src={preview} title={t("Prévia do vídeo")} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" /></div>}
      <Field label={t("Como fazer")} optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={v.cues} onChange={(e) => set({ cues: e.target.value })} placeholder={t("Postura, amplitude, respiração, erros comuns")} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{t("Salvar")}</Button></div>
    </form>
  );
}

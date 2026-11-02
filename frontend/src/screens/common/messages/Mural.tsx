/** Club announcements board (mural): staff publish to the club or to groups and see who read; students read. */
import { Eye, Megaphone, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useGroups } from "@/api/members";
import { type AnnouncementInput, useAnnouncementReads, useAnnouncements, useDeleteAnnouncement, useMarkAnnouncementsRead, useSaveAnnouncement } from "@/api/messages";
import type { Announcement, Club } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { ago } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, Skeleton, Switch, Textarea, cn, toast } from "@/ui";

export function Mural({ club, staff }: { club: Club; staff: boolean }) {
  const list = useAnnouncements(club.id);
  const groups = useGroups(staff ? club.id : undefined);
  const markRead = useMarkAnnouncementsRead(club.id);
  const del = useDeleteAnnouncement(club.id);
  const save = useSaveAnnouncement(club.id);
  const [edit, setEdit] = useState<Announcement | null | undefined>(undefined);
  const [reads, setReads] = useState<Announcement | null>(null);
  const items = list.data ?? [];
  const unreadIds = items.filter((a) => !a.read_at).map((a) => a.id).join(",");
  // Students: what's on screen counts as read after a moment (keeps the "Novo" badge visible on arrival).
  useEffect(() => {
    if (staff || !unreadIds) return;
    const timer = setTimeout(() => markRead.mutate(unreadIds.split(",")), 2500);
    return () => clearTimeout(timer);
  }, [unreadIds, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name ?? t("grupo");
  return (
    <div className="grid gap-3">
      {staff && <div className="flex justify-end"><Button icon={<Plus />} onClick={() => setEdit(null)}>{t("Novo aviso")}</Button></div>}
      {list.isPending ? <Skeleton className="h-40" /> : items.length === 0 ? (
        <Card><EmptyState icon={<Megaphone />} title={t("Nenhum aviso no mural")}>{staff ? t("Avisos chegam para todo o clube ou só para alguns grupos, com confirmação de leitura.") : t("Os avisos da equipe aparecem aqui.")}</EmptyState></Card>
      ) : items.map((a) => (
        <Card key={a.id} edge={a.pinned ? "brand" : undefined} className={cn("grid gap-2 p-4 sm:p-5", !staff && !a.read_at && "ring-2 ring-accent-line")}>
          <div className="flex items-start gap-3">
            <Avatar name={a.author.user.name} src={a.author.user.avatar_url} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{a.title}</h3>{a.pinned && <Badge tone="brand" icon={<Pin />}>{t("Fixado")}</Badge>}{!staff && !a.read_at && <Badge tone="accent">{t("Novo")}</Badge>}</div>
              <div className="text-xs text-fg-muted">{a.author.user.name} · {ago(a.created_at)}{a.edited_at ? ` · ${t("editado")}` : ""}{staff ? ` · ${a.group_ids.length ? a.group_ids.map(groupName).join(", ") : t("Todo o clube")}` : ""}</div>
            </div>
            {staff && <Menu trigger={<IconButton size="sm" label={t("Ações do aviso")}><MoreHorizontal /></IconButton>} items={[
              { label: t("Editar"), icon: <Pencil />, onSelect: () => setEdit(a) },
              { label: a.pinned ? t("Desafixar") : t("Fixar no topo"), icon: a.pinned ? <PinOff /> : <Pin />, onSelect: () => save.mutate({ id: a.id, pinned: !a.pinned }) },
              "separator",
              { label: t("Apagar"), icon: <Trash2 />, danger: true, onSelect: () => del.mutate(a.id, { onSuccess: () => toast.success(t("Aviso apagado")) }) },
            ]} />}
          </div>
          <p className="whitespace-pre-line text-[15px]">{a.body}</p>
          {staff && a.audience_count != null && (
            <button type="button" onClick={() => setReads(a)} className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold text-fg-muted hover:bg-soft hover:text-fg">
              <Eye className="size-4" />{t("Lido por {r} de {n}", { r: a.reads_count ?? 0, n: a.audience_count })}
            </button>
          )}
        </Card>
      ))}
      {staff && <AnnouncementDialog club={club} value={edit} onClose={() => setEdit(undefined)} />}
      {staff && <ReadsDialog club={club} a={reads} onClose={() => setReads(null)} />}
    </div>
  );
}

function AnnouncementDialog({ club, value, onClose }: { club: Club; value: Announcement | null | undefined; onClose: () => void }) {
  return <Dialog open={value !== undefined} onOpenChange={(v) => !v && onClose()} size="lg" title={value ? t("Editar aviso") : t("Novo aviso")}>{value !== undefined && <AnnouncementBody club={club} value={value} onClose={onClose} />}</Dialog>;
}
function AnnouncementBody({ club, value, onClose }: { club: Club; value: Announcement | null; onClose: () => void }) {
  const groups = useGroups(club.id);
  const save = useSaveAnnouncement(club.id);
  const [v, setV] = useState<AnnouncementInput>({ title: value?.title ?? "", body: value?.body ?? "", group_ids: value?.group_ids ?? [], pinned: value?.pinned ?? false });
  const set = (p: Partial<AnnouncementInput>) => setV((o) => ({ ...o, ...p }));
  const err = save.error instanceof ApiError ? save.error : null;
  const all = v.group_ids.length === 0;
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, id: value?.id }, { onSuccess: () => { toast.success(value ? t("Aviso atualizado") : t("Aviso publicado"), value ? undefined : t("Os alunos recebem uma notificação.")); onClose(); }, onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); } }); }}>
      <Field label={t("Título")} error={err?.fieldError("title")}>{(id) => <Input id={id} value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={t("Ex.: Treino de pista no feriado")} autoFocus />}</Field>
      <Field label={t("Aviso")} error={err?.fieldError("body")}>{(id) => <Textarea id={id} rows={5} value={v.body} onChange={(e) => set({ body: e.target.value })} maxLength={4000} />}</Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 rf-text-label-sm">{t("Para quem")}</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={all} onClick={() => set({ group_ids: [] })} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", all ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{t("Todo o clube")}</button>
          {(groups.data ?? []).map((g) => { const on = v.group_ids.includes(g.id); return <button key={g.id} type="button" aria-pressed={on} onClick={() => set({ group_ids: on ? v.group_ids.filter((x) => x !== g.id) : [...v.group_ids, g.id] })} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>; })}
        </div>
      </fieldset>
      <Switch checked={v.pinned} onCheckedChange={(pinned) => set({ pinned })} label={t("Fixar no topo do mural")} />
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" loading={save.isPending}>{value ? t("Salvar") : t("Publicar")}</Button></div>
    </form>
  );
}

function ReadsDialog({ club, a, onClose }: { club: Club; a: Announcement | null; onClose: () => void }) {
  const reads = useAnnouncementReads(club.id, a?.id ?? null);
  const list = reads.data ?? [];
  const seen = list.filter((r) => r.read_at), pending = list.filter((r) => !r.read_at);
  return (
    <Dialog open={!!a} onOpenChange={(v) => !v && onClose()} title={t("Quem leu")} description={a?.title}>
      {reads.isPending ? <Skeleton className="h-40" /> : (
        <div className="grid gap-4">
          {[{ label: t("Leram ({n})", { n: seen.length }), list: seen }, { label: t("Ainda não leram ({n})", { n: pending.length }), list: pending }].map((g) => g.list.length > 0 && (
            <section key={g.label} className="grid gap-1">
              <h3 className="rf-text-overline text-fg-muted">{g.label}</h3>
              <ul className="divide-y divide-line-subtle">{g.list.map((r) => <li key={r.membership_id} className="flex items-center gap-3 py-2"><Avatar name={r.user.name} src={r.user.avatar_url} size={28} /><span className="flex-1 text-sm font-semibold">{r.user.name}</span>{r.read_at && <span className="text-xs text-fg-muted">{ago(r.read_at)}</span>}</li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

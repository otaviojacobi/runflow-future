/** ⌘K / Ctrl+K command palette (F30): go to any screen, run common actions, find students and workouts. */
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CalendarPlus, Dumbbell, Flag, Moon, Plus, Search, Sun, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTemplates } from "@/api/library";
import { useAthletes } from "@/api/members";
import type { Role, Sport } from "@/api/types";
import { t } from "@/i18n";
import { getColorMode, setColorMode } from "@/lib/theme";
import { Avatar, cn } from "@/ui";
import { navFor } from "./nav";

interface Item { id: string; group: string; label: string; hint?: string; icon?: LucideIcon; avatar?: { name: string; src: string | null }; run: () => void }
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

export function CommandPalette({ open, onOpenChange, role, clubId, modalities }: { open: boolean; onOpenChange: (v: boolean) => void; role: Role; clubId: string; modalities: Sport[] }) {
  const navigate = useNavigate();
  const staff = role !== "student";
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const athletes = useAthletes(staff && open ? clubId : undefined);
  const templates = useTemplates(staff && open ? clubId : undefined);
  useEffect(() => { if (open) { setQ(""); setActive(0); } }, [open]);
  const go = (to: string) => () => navigate({ to });
  const items = useMemo<Item[]>(() => {
    const nav: Item[] = navFor(role, modalities).flatMap((g) => g.items).map((n) => ({ id: "nav:" + n.to, group: t("Ir para"), label: t(n.label), icon: n.icon, run: go(n.to) }));
    for (const extra of [{ id: "nav:/notifications", group: t("Ir para"), label: t("Notificações"), icon: ArrowRight, run: go("/notifications") }, { id: "nav:/account", group: t("Ir para"), label: t("Minha conta"), icon: ArrowRight, run: go("/account") }])
      if (!nav.some((n) => n.id === extra.id)) nav.push(extra);
    const dark = getColorMode() === "dark";
    const actions: Item[] = staff ? [
      { id: "a:new", group: t("Ações"), label: t("Novo treino"), icon: Plus, run: go("/library/new") },
      { id: "a:assign", group: t("Ações"), label: t("Atribuir treino"), hint: t("Planejamento"), icon: CalendarPlus, run: go("/planning") },
      { id: "a:invite", group: t("Ações"), label: t("Convidar alunos"), icon: UserPlus, run: go(role === "owner" ? "/club/members" : "/students") },
      { id: "a:race", group: t("Ações"), label: t("Nova prova no calendário"), icon: Flag, run: go("/races/manage") },
      { id: "a:exercise", group: t("Ações"), label: t("Novo exercício"), icon: Dumbbell, run: go("/exercises") },
    ] : [
      { id: "a:log", group: t("Ações"), label: t("Registrar atividade"), icon: Plus, run: go("/activities") },
    ];
    actions.push({ id: "a:theme", group: t("Ações"), label: dark ? t("Usar tema claro") : t("Usar tema escuro"), icon: dark ? Sun : Moon, run: () => setColorMode(dark ? "light" : "dark") });
    const people: Item[] = (athletes.data ?? []).map((a) => ({ id: "s:" + a.membership.id, group: t("Alunos"), label: a.user.name, avatar: { name: a.user.name, src: a.user.avatar_url }, run: go(`/students/${a.membership.id}`) }));
    const workouts: Item[] = (templates.data ?? []).map((w) => ({ id: "w:" + w.id, group: t("Biblioteca"), label: w.name, icon: Users, run: go(`/library/${w.id}`) }));
    const query = fold(q.trim());
    const all = [...actions, ...nav, ...people, ...workouts];
    if (!query) return [...actions, ...nav];
    return all.filter((i) => fold(i.label).includes(query) || (i.hint && fold(i.hint).includes(query))).slice(0, 30);
  }, [q, role, staff, athletes.data, templates.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const run = (i: Item | undefined) => { if (!i) return; onOpenChange(false); i.run(); };
  let lastGroup = "";
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_120ms_ease-out]" />
        <RDialog.Content aria-describedby={undefined} className="fixed inset-x-3 top-[10vh] z-50 mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-raised text-fg shadow-lg focus:outline-none data-[state=open]:animate-[fade-in_120ms_ease-out]">
          <RDialog.Title className="sr-only">{t("Buscar no Runflow")}</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-5 shrink-0 text-fg-subtle" aria-hidden />
            <input autoFocus role="combobox" aria-expanded aria-controls="cmdk-list" aria-activedescendant={items[active] ? `cmdk-${active}` : undefined} aria-label={t("Buscar telas, ações, alunos e treinos")}
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={staff ? t("Buscar telas, ações, alunos e treinos…") : t("Buscar telas e ações…")}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); run(items[active]); }
              }}
              className="h-14 flex-1 bg-transparent text-[16px] placeholder:text-fg-subtle focus:outline-none" />
            <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-fg-muted sm:block">Esc</kbd>
          </div>
          <ul id="cmdk-list" role="listbox" ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">{t("Nada encontrado para “{q}”.", { q })}</li>}
            {items.map((i, idx) => {
              const header = i.group !== lastGroup ? (lastGroup = i.group) : null;
              const I = i.icon;
              return (
                <li key={i.id} role="presentation">
                  {header && <div className="px-3 pb-1 pt-2 rf-text-overline text-fg-subtle">{header}</div>}
                  <div id={`cmdk-${idx}`} data-index={idx} role="option" aria-selected={idx === active} onMouseMove={() => setActive(idx)} onClick={() => run(i)}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[15px]", idx === active ? "bg-brand-soft text-on-brand-soft" : "text-fg")}>
                    {i.avatar ? <Avatar name={i.avatar.name} src={i.avatar.src} size={24} /> : I ? <I className="size-[18px] shrink-0 opacity-80" aria-hidden /> : null}
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {i.hint && <span className="text-xs text-fg-muted">{i.hint}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-4 border-t border-line-subtle px-4 py-2 text-xs text-fg-muted"><span>↑↓ {t("navegar")}</span><span>↵ {t("abrir")}</span><span>? {t("atalhos")}</span></div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

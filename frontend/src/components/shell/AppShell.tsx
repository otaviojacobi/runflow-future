import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, Bell, Check, ChevronsUpDown, CreditCard, LogOut, Menu as MenuIcon, Monitor, Moon, Plus, Search, Snowflake, Sun, User, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { signOut } from "@/api/auth";
import type { MembershipContext, Subscription } from "@/api/types";
import { ClubLogo } from "@/components/brand";
import { t, tn } from "@/i18n";
import { ROLE_LABEL, homeFor, selectClub, useClub } from "@/lib/club";
import { fullDate, localDate } from "@/lib/format";
import { useOnline } from "@/lib/pwa";
import { applyClubTheme, getColorMode, setColorMode, type ColorMode } from "@/lib/theme";
import { Avatar, ButtonLink, Dialog, cn } from "@/ui";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { moreFor, navFor, tabsFor, type NavItem } from "./nav";

/** What waits in a club's Mensagens (`/me` memberships[].unread). */
export const unreadOf = (m: MembershipContext | null | undefined) => (m?.unread?.messages ?? 0) + (m?.unread?.announcements ?? 0);
const capped = (n: number) => (n > 9 ? "9+" : String(n));

/** A small count on a nav item (hidden from screen readers: `CountText` says it after the label). */
function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return <span aria-hidden className={cn("grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-[18px] text-on-danger", className)}>{capped(n)}</span>;
}
/** The count read out with the label: "Mensagens, 3 novas". */
function CountText({ n }: { n: number }) {
  return n > 0 ? <span className="sr-only">{tn(n, ", {n} nova", ", {n} novas")}</span> : null;
}
function Count({ n, className }: { n: number; className?: string }) {
  return <><Badge n={n} className={className} /><CountText n={n} /></>;
}

function useIsActive() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => path === to || path.startsWith(to + "/");
}

function ClubSwitcher({ compact }: { compact?: boolean }) {
  const { me, ctx } = useClub();
  const navigate = useNavigate();
  if (!ctx || !me) return null;
  const pick = (m: MembershipContext) => { selectClub(m); navigate({ to: homeFor(m.membership.role) }); };
  // Something waiting in another club's Mensagens: a dot on the switcher, the count next to that club.
  const elsewhere = me.memberships.some((m) => m.club.id !== ctx.club.id && unreadOf(m) > 0);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cn("flex min-w-0 items-center gap-3 rounded-md text-left outline-none transition-colors hover:bg-soft focus-visible:ring-2 focus-visible:ring-brand-ring", compact ? "p-1" : "w-full p-2")}>
        <ClubLogo club={ctx.club} branding={ctx.branding} size={compact ? 32 : 38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-tight">{ctx.club.name}</span>
          {!compact && <span className="block truncate text-xs text-fg-muted">{t(ROLE_LABEL[ctx.membership.role])}</span>}
        </span>
        {elsewhere && <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />}
        {elsewhere && <span className="sr-only">{t("Mensagens novas em outro clube")}</span>}
        <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 w-72 rounded-md border border-line-subtle bg-raised p-1 text-fg shadow-md">
          <DropdownMenu.Label className="px-2.5 py-1.5 rf-text-overline text-fg-muted">{t("Seus clubes")}</DropdownMenu.Label>
          {me.memberships.map((m) => (
            <DropdownMenu.Item key={m.club.id} onSelect={() => pick(m)} className="flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 outline-none data-[highlighted]:bg-soft">
              <ClubLogo club={m.club} branding={m.branding} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.club.name}</span><span className="block text-xs text-fg-muted">{t(ROLE_LABEL[m.membership.role])}</span></span>
              {m.club.id === ctx.club.id ? <Check className="size-4 text-brand-text" /> : <Count n={unreadOf(m)} />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
          <DropdownMenu.Item onSelect={() => navigate({ to: "/clubs/new" })} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm outline-none data-[highlighted]:bg-soft"><Plus className="size-4" />{t("Criar novo clube")}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountMenu() {
  const { me } = useClub();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ColorMode>(getColorMode());
  if (!me) return null;
  const item = "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm px-2.5 text-sm outline-none data-[highlighted]:bg-soft [&_svg]:size-4";
  const modes: { value: ColorMode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("Claro"), icon: <Sun /> }, { value: "dark", label: t("Escuro"), icon: <Moon /> }, { value: "system", label: t("Sistema"), icon: <Monitor /> },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-3 rounded-md p-2 text-left outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-brand-ring">
        <Avatar name={me.user.name} src={me.user.avatar_url} size={32} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{me.user.name}</span><span className="block truncate text-xs text-fg-muted">{me.user.email}</span></span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className="z-50 w-60 rounded-md border border-line-subtle bg-raised p-1 text-fg shadow-md">
          <DropdownMenu.Item className={item} onSelect={() => navigate({ to: "/account" })}><User />{t("Minha conta")}</DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
          <DropdownMenu.Label className="px-2.5 py-1 rf-text-overline text-fg-muted">{t("Aparência")}</DropdownMenu.Label>
          {modes.map((m) => (
            <DropdownMenu.Item key={m.value} className={item} onSelect={(e) => { e.preventDefault(); setMode(m.value); setColorMode(m.value); }}>
              {m.icon}{m.label}{mode === m.value && <Check className="ml-auto text-brand-text" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
          <DropdownMenu.Item className={item} onSelect={async () => { await signOut(); navigate({ to: "/login" }); }}><LogOut />{t("Sair")}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NavLink({ item, count = 0, onClick }: { item: NavItem; count?: number; onClick?: () => void }) {
  const isActive = useIsActive();
  const active = isActive(item.to);
  const I = item.icon;
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  return (
    <Link ref={ref} to={item.to} onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("relative flex h-9 items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors [&_svg]:size-[18px]", active ? "bg-brand-soft font-semibold text-on-brand-soft" : "text-fg-muted hover:bg-soft hover:text-fg")}>
      <I aria-hidden />{t(item.label)}<Count n={count} className="ml-auto" />
    </Link>
  );
}

function Bell_({ unread, className }: { unread: number; className?: string }) {
  return (
    <Link to="/notifications" aria-label={unread ? t("Notificações: {n} novas", { n: unread }) : t("Notificações")}
      className={cn("relative grid size-10 place-items-center rounded-full text-fg hover:bg-soft", className)}>
      <Bell className="size-5" aria-hidden />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-[18px] text-on-danger ring-2 ring-canvas">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}

/** "?" opens the keyboard shortcuts sheet (anywhere outside text fields). */
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows: [string, [string, string][]][] = [
    [t("Geral"), [["⌘ K / Ctrl K", t("Buscar telas, ações, alunos e treinos")], ["?", t("Mostrar estes atalhos")]]],
    [t("Planejamento"), [["← →", t("Semana anterior / próxima")], ["T", t("Voltar para esta semana")], ["A", t("Atribuir treino")], ["C", t("Copiar semana")], ["/", t("Buscar aluno")], ["P", t("Imprimir a semana")]]],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Atalhos do teclado")}>
      <div className="grid gap-4">
        {rows.map(([title, list]) => (
          <section key={title}><h3 className="mb-1.5 rf-text-overline text-fg-muted">{title}</h3>
            <ul className="divide-y divide-line-subtle">{list.map(([k, d]) => <li key={k} className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>{d}</span><kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-xs">{k}</kbd></li>)}</ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
export const isTyping = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog]")); };

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div role="status" data-print="hide" className="mx-auto mb-4 flex max-w-6xl items-center gap-2 rounded-lg bg-warning-soft px-4 py-2.5 text-sm text-on-warning-soft"><WifiOff className="size-4 shrink-0" />{t("Sem internet. Mostrando o que ficou salvo no aparelho; mudanças precisam de conexão.")}</div>;
}

/** Owner-only: a payment failed (grace period) or the club hit its student limit. Never shown to students. */
function BillingBanner({ sub }: { sub: Subscription | null }) {
  const isActive = useIsActive();
  if (!sub || sub.frozen || isActive("/club/billing")) return null;
  const pastDue = sub.status === "past_due";
  const full = sub.student_limit !== null && sub.active_students >= sub.student_limit;
  if (!pastDue && !full) return null;
  return (
    <div role="status" className={cn("mx-auto mb-5 flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm", pastDue ? "border-danger-line bg-danger-soft text-on-danger-soft" : "border-warning-line bg-warning-soft text-on-warning-soft")}>
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{pastDue
        ? sub.grace_until ? t("O último pagamento do plano não foi aprovado. Atualize o cartão até {d} para o clube não ser congelado.", { d: fullDate(localDate(sub.grace_until)) }) : t("O último pagamento do plano não foi aprovado. Atualize o cartão para manter o plano.")
        : t("Limite de {n} alunos do plano atingido. Novos alunos não conseguem entrar; ninguém é removido.", { n: sub.student_limit ?? 0 })}</span>
      <Link to="/club/billing" className="font-semibold underline underline-offset-2">{pastDue ? t("Resolver pagamento") : t("Ver planos")}</Link>
    </div>
  );
}

/** Frozen club (D-043), staff only: an icy layer over the screen and one way out, paying (owner) or asking the
 * owner (trainers). Writes answer 423 anyway; students never see it. The owner lands on Plano e cobrança once. */
function FrozenLayer({ role, clubId }: { role: "owner" | "trainer"; clubId: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (role !== "owner") return;
    const key = `rf.frozen-redirect.${clubId}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage unavailable: redirect anyway */ }
    navigate({ to: "/club/billing" });
  }, [role, clubId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-print="hide" className="fixed inset-0 z-20 grid place-items-center bg-gradient-to-b from-info-soft/80 via-canvas/70 to-info-soft/80 p-4 backdrop-blur-[3px] lg:left-[248px]">
      <div role="alertdialog" aria-labelledby="frozen-h" aria-describedby="frozen-d" className="grid max-w-md justify-items-center gap-3 rounded-2xl border border-info-line bg-surface p-6 text-center shadow-lg">
        <span className="grid size-14 place-items-center rounded-full bg-info-soft text-on-info-soft"><Snowflake className="size-7" aria-hidden /></span>
        <h2 id="frozen-h" className="rf-text-title-lg">{t("Clube congelado")}</h2>
        <p id="frozen-d" className="text-fg-muted">{role === "owner"
          ? t("O pagamento do plano está pendente. Regularize em Plano e cobrança para voltar a usar o clube. Os alunos continuam usando normalmente.")
          : t("O pagamento do plano está pendente. Peça ao responsável pelo clube para regularizar; até lá, nada pode ser alterado.")}</p>
        {role === "owner" && <ButtonLink to="/club/billing" icon={<CreditCard />}>{t("Regularizar pagamento")}</ButtonLink>}
      </div>
    </div>
  );
}

export function AppShell() {
  const { me, ctx, role } = useClub();
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useCommandPalette();
  const [keys, setKeys] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "?" && !isTyping(e)) { e.preventDefault(); setKeys(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isActive = useIsActive();
  useEffect(() => { if (ctx) applyClubTheme(ctx.branding?.theme_css ?? null); }, [ctx?.club.id, ctx?.branding?.theme_rev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx || !role || !me) return null;
  const modalities = ctx.club.modalities;
  const groups = navFor(role, modalities).map((g) => ({ ...g, items: g.items.filter((i) => i.sidebar !== false) }));
  const tabs = tabsFor(role, modalities);
  const extra = moreFor(role, modalities);
  // Frozen (D-043): staff only, and Plano e cobrança stays usable (the way out).
  const frozen = role !== "student" && !!ctx.subscription?.frozen && !isActive("/club/billing");
  const counts: Record<string, number> = { "/messages": unreadOf(ctx) };
  const extraCount = extra.reduce((n, it) => n + (counts[it.to] ?? 0), 0);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)] print:block">
      <a data-print="hide" href="#conteudo" className="sr-only-focusable fixed left-2 top-2 z-[70] rounded-md bg-brand px-3 py-2 text-on-brand">{t("Pular para o conteúdo")}</a>
      {/* desktop sidebar */}
      <aside data-print="hide" className="sticky top-0 hidden h-dvh flex-col gap-4 border-r border-line bg-surface p-3 lg:flex">
        <ClubSwitcher />
        <button type="button" onClick={() => setPalette(true)} className="flex h-9 items-center gap-2 rounded-md border border-line bg-sunken px-3 text-sm text-fg-muted hover:text-fg">
          <Search className="size-4" aria-hidden /><span className="flex-1 text-left">{t("Buscar…")}</span><kbd className="rounded border border-line px-1 text-[11px]">⌘K</kbd>
        </button>
        <nav aria-label={t("Navegação principal")} className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {groups.map((g, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {g.title && <div className="px-3 pb-1 rf-text-overline text-fg-subtle">{t(g.title)}</div>}
              {g.items.map((it) => <NavLink key={it.to} item={it} count={counts[it.to]} />)}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t border-line-subtle pt-3">
          <div className="min-w-0 flex-1"><AccountMenu /></div>
          <Bell_ unread={me.unread_notifications} />
        </div>
      </aside>

      {/* mobile top bar */}
      <header data-print="hide" className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-canvas/90 px-3 py-2 backdrop-blur-md lg:hidden">
        <div className="min-w-0 flex-1"><ClubSwitcher compact /></div>
        <button type="button" onClick={() => setPalette(true)} aria-label={t("Buscar")} className="grid size-10 place-items-center rounded-full text-fg hover:bg-soft"><Search className="size-5" /></button>
        <Bell_ unread={me.unread_notifications} />
      </header>

      <main id="conteudo" className="min-w-0 overflow-x-clip px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <OfflineBanner />
        {role === "owner" && <BillingBanner sub={ctx.subscription} />}
        {frozen ? <div inert><Outlet /></div> : <Outlet />}
      </main>
      {frozen && <FrozenLayer role={role as "owner" | "trainer"} clubId={ctx.club.id} />}
      <CommandPalette open={palette} onOpenChange={setPalette} role={role} clubId={ctx.club.id} modalities={modalities} />
      <ShortcutsDialog open={keys} onOpenChange={setKeys} />

      {/* mobile bottom tabs */}
      <nav data-print="hide" aria-label={t("Navegação principal")} className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length + (extra.length ? 1 : 0)}, minmax(0, 1fr))` }}>
        {tabs.map((it) => {
          const I = it.icon;
          const active = isActive(it.to);
          return (
            <Link key={it.to} to={it.to} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", active ? "text-fg" : "text-fg-muted")}>
              <span className={cn("relative grid h-7 w-12 place-items-center rounded-full", active && "bg-brand-soft text-on-brand-soft")}><I className="size-5" aria-hidden /><Badge n={counts[it.to] ?? 0} className="absolute -right-0.5 -top-1 ring-2 ring-surface" /></span>
              {t(it.label)}<CountText n={counts[it.to] ?? 0} />
            </Link>
          );
        })}
        {extra.length > 0 && (
          <button onClick={() => setMore(true)} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", extra.some((e) => isActive(e.to)) ? "text-fg" : "text-fg-muted")}>
            <span className="relative grid h-7 w-12 place-items-center rounded-full"><MenuIcon className="size-5" aria-hidden />{extraCount > 0 && <span aria-hidden className="absolute right-2 top-0.5 size-2 rounded-full bg-danger ring-2 ring-surface" />}</span>{t("Mais")}
            {extraCount > 0 && <span className="sr-only">{tn(extraCount, ", {n} mensagem nova", ", {n} mensagens novas")}</span>}
          </button>
        )}
      </nav>
      <Dialog open={more} onOpenChange={setMore} title={t("Mais")}>
        <div className="grid gap-0.5 pb-2">
          {extra.map((it) => <NavLink key={it.to} item={it} count={counts[it.to]} onClick={() => setMore(false)} />)}
          <div className="my-2 h-px bg-line-subtle" />
          <AccountMenu />
        </div>
      </Dialog>
    </div>
  );
}

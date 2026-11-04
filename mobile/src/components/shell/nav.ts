/**
 * The club's navigation per role: a copy of the web's components/shell/nav.ts (keep them in sync), with `app` marking
 * what has a screen in the app. The rest (desktop tools: library, planilhas, Club Studio…) opens the web app.
 *
 * `tab`: in the bottom bar (students: 4, D-035, plus Aulas where the club has classes, D-052; staff: 4 + "Mais"). `inProfile`: reached from Perfil.
 * `feature`: only for clubs whose modalities use it (D-052, lib/features.ts).
 */
import type { Href } from "expo-router";
import type { MembershipContext, Role, Sport } from "@/api/types";
import { anyClubHas, has, type Feature } from "@/lib/features";
import {
  Activity, BarChart3, Calendar, CalendarClock, CalendarRange, ClipboardList, CreditCard, Dumbbell, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, User, UserCog, Users, type Icon,
} from "@/ui/icons";

export interface NavItem { to: string; label: string; icon: Icon; tab?: boolean; inProfile?: boolean; feature?: Feature; app?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF_MAIN: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, tab: true, app: true },
  { to: "/students", label: "Alunos", icon: Users, tab: true, app: true },
  { to: "/planning", label: "Planejamento", icon: CalendarRange, tab: true, app: true },
  { to: "/feedback", label: "Feedbacks", icon: MessageSquare, tab: true, app: true },
  { to: "/classes/manage", label: "Aulas", icon: CalendarClock, feature: "classes", app: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle, app: true },
];
const STAFF_TRAINING: NavItem[] = [
  { to: "/library", label: "Biblioteca", icon: Library, app: true },
  { to: "/plans", label: "Planilhas", icon: ClipboardList, app: true },
  { to: "/exercises", label: "Exercícios", icon: Dumbbell, feature: "exercises", app: true },
  { to: "/assessments", label: "Avaliações", icon: Gauge, app: true },
  { to: "/reports", label: "Relatórios", icon: BarChart3, app: true },
];
const STAFF_TEAM: NavItem[] = [
  { to: "/races/manage", label: "Provas", icon: Flag, feature: "races", app: true },
];
const OWNER: NavItem[] = [
  { to: "/club/studio", label: "Club Studio", icon: Palette, app: true },
  { to: "/club/members", label: "Membros", icon: UserCog, app: true },
  { to: "/club/settings", label: "Configurações", icon: Settings, app: true },
  { to: "/club/billing", label: "Plano e cobrança", icon: CreditCard, app: true },
];
const STUDENT: NavItem[] = [
  { to: "/today", label: "Hoje", icon: Sun, tab: true, app: true },
  { to: "/schedule", label: "Agenda", icon: Calendar, tab: true, app: true },
  // Booking classes is a gym student's daily action: a tab of its own, only where the club has classes (D-052).
  { to: "/classes", label: "Aulas", icon: CalendarClock, tab: true, feature: "classes", app: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle, tab: true, app: true },
  { to: "/races", label: "Provas", icon: Flag, inProfile: true, feature: "races", app: true },
  { to: "/activities", label: "Atividades", icon: Activity, inProfile: true, feature: "strava", app: true },
  { to: "/account", label: "Perfil", icon: User, tab: true, app: true },
];

const groupsFor = (role: Role): NavGroup[] =>
  role === "student" ? [{ items: STUDENT }]
    : [{ items: STAFF_MAIN }, { title: "Treinos", items: STAFF_TRAINING }, { title: "Equipe", items: STAFF_TEAM }, ...(role === "owner" ? [{ title: "Clube", items: OWNER }] : [])];

/** The club's navigation for a role: only what the club's modalities use (D-052); empty groups dropped. */
export function navFor(role: Role, modalities: Sport[] = []): NavGroup[] {
  const keep = (g: NavGroup): NavGroup => ({ ...g, items: g.items.filter((i) => !i.feature || has({ modalities }, i.feature)) });
  return groupsFor(role).map(keep).filter((g) => g.items.length > 0);
}
const flat = (role: Role, modalities?: Sport[]) => navFor(role, modalities).flatMap((g) => g.items);
export const tabsFor = (role: Role, modalities?: Sport[]) => flat(role, modalities).filter((i) => i.tab);
/** The "Mais" screen: everything else, grouped, except what Perfil links to. */
export const moreFor = (role: Role, modalities?: Sport[]): NavGroup[] =>
  navFor(role, modalities).map((g) => ({ ...g, items: g.items.filter((i) => !i.tab && !i.inProfile) })).filter((g) => g.items.length > 0);
/**
 * What Perfil links to (students: Provas, Atividades). Perfil is the person's, not one club's: a link shows when any
 * club they're active in uses it. Without memberships, every link (routing only).
 */
export const profileLinksFor = (role: Role, memberships?: readonly MembershipContext[]) =>
  groupsFor(role).flatMap((g) => g.items).filter((i) => i.inProfile && (!memberships || !i.feature || anyClubHas(memberships, i.feature)));
/** Every "Mais" route of a role, whatever the modalities: for routing (back buttons, the focused tab), never for showing. */
export const moreRoutesFor = (role: Role) => groupsFor(role).flatMap((g) => g.items).filter((i) => !i.tab && !i.inProfile);
/** An in-app nav path as a route. */
export const hrefOf = (to: string) => to as Href;

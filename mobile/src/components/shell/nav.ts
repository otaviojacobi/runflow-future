/**
 * The club's navigation per role: a copy of the web's components/shell/nav.ts (keep them in sync), with `app` marking
 * what has a screen in the app. The rest (desktop tools: library, planilhas, Club Studio…) opens the web app.
 *
 * `tab`: in the bottom bar (students: exactly 4, D-035; staff: 4 + "Mais"). `inProfile`: reached from Perfil.
 * `gym`: only for clubs that teach musculação (D-035).
 */
import type { Href } from "expo-router";
import type { Role, Sport } from "@/api/types";
import {
  Activity, BarChart3, Calendar, CalendarRange, ClipboardList, CreditCard, Dumbbell, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, User, UserCog, Users, type Icon,
} from "@/ui/icons";

export interface NavItem { to: string; label: string; icon: Icon; tab?: boolean; inProfile?: boolean; gym?: boolean; app?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF_MAIN: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, tab: true, app: true },
  { to: "/students", label: "Alunos", icon: Users, tab: true, app: true },
  { to: "/planning", label: "Planejamento", icon: CalendarRange, tab: true, app: true },
  { to: "/feedback", label: "Feedbacks", icon: MessageSquare, tab: true, app: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle, app: true },
];
const STAFF_TRAINING: NavItem[] = [
  { to: "/library", label: "Biblioteca", icon: Library, app: true },
  { to: "/plans", label: "Planilhas", icon: ClipboardList, app: true },
  { to: "/exercises", label: "Exercícios", icon: Dumbbell, gym: true, app: true },
  { to: "/assessments", label: "Avaliações", icon: Gauge, app: true },
  { to: "/reports", label: "Relatórios", icon: BarChart3, app: true },
];
const STAFF_TEAM: NavItem[] = [
  { to: "/races/manage", label: "Provas", icon: Flag, app: true },
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
  { to: "/messages", label: "Mensagens", icon: MessageCircle, tab: true, app: true },
  { to: "/races", label: "Provas", icon: Flag, inProfile: true, app: true },
  { to: "/activities", label: "Atividades", icon: Activity, inProfile: true, app: true },
  { to: "/account", label: "Perfil", icon: User, tab: true, app: true },
];

/** The club's navigation for a role; gym tools only when the club teaches musculação (D-035). */
export function navFor(role: Role, modalities: Sport[] = []): NavGroup[] {
  const gym = modalities.includes("strength");
  const keep = (g: NavGroup): NavGroup => ({ ...g, items: g.items.filter((i) => gym || !i.gym) });
  if (role === "student") return [{ items: STUDENT }];
  const staff: NavGroup[] = [{ items: STAFF_MAIN }, { title: "Treinos", items: STAFF_TRAINING }, { title: "Equipe", items: STAFF_TEAM }];
  return (role === "owner" ? [...staff, { title: "Clube", items: OWNER }] : staff).map(keep);
}
const flat = (role: Role, modalities?: Sport[]) => navFor(role, modalities).flatMap((g) => g.items);
export const tabsFor = (role: Role, modalities?: Sport[]) => flat(role, modalities).filter((i) => i.tab);
/** The "Mais" screen: everything else, grouped, except what Perfil links to. */
export const moreFor = (role: Role, modalities?: Sport[]): NavGroup[] =>
  navFor(role, modalities).map((g) => ({ ...g, items: g.items.filter((i) => !i.tab && !i.inProfile) })).filter((g) => g.items.length > 0);
/** What Perfil links to (students: Provas, Atividades). */
export const profileLinksFor = (role: Role) => flat(role).filter((i) => i.inProfile);
/** An in-app nav path as a route. */
export const hrefOf = (to: string) => to as Href;

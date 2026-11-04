import {
  Activity, BarChart3, Calendar, CalendarClock, CalendarRange, ClipboardList, CreditCard, Dumbbell, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, User, UserCog, Users, type LucideIcon,
} from "lucide-react";
import type { MembershipContext, Role, Sport } from "@/api/types";
import { anyClubHas, has, type Feature } from "@/lib/features";

/**
 * `tab`: in the mobile bottom bar (students: exactly 4, D-035). `inProfile`: on mobile, reached from Perfil instead of
 * the "Mais" sheet. `sidebar: false`: not in the desktop sidebar either (still in the command palette).
 * `feature`: only for clubs whose modalities use it (D-052, lib/features.ts).
 */
export interface NavItem { to: string; label: string; icon: LucideIcon; tab?: boolean; inProfile?: boolean; sidebar?: false; feature?: Feature }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF_MAIN: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, tab: true },
  { to: "/students", label: "Alunos", icon: Users, tab: true },
  { to: "/planning", label: "Planejamento", icon: CalendarRange, tab: true },
  { to: "/classes/manage", label: "Aulas", icon: CalendarClock, feature: "classes" },
  { to: "/feedback", label: "Feedbacks", icon: MessageSquare, tab: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle },
];
const STAFF_TRAINING: NavItem[] = [
  { to: "/library", label: "Biblioteca", icon: Library },
  { to: "/plans", label: "Planilhas", icon: ClipboardList },
  { to: "/exercises", label: "Exercícios", icon: Dumbbell, feature: "exercises" },
  { to: "/assessments", label: "Avaliações", icon: Gauge },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
];
const STAFF_TEAM: NavItem[] = [
  { to: "/races/manage", label: "Provas", icon: Flag, feature: "races" },
];
const OWNER: NavItem[] = [
  { to: "/club/studio", label: "Club Studio", icon: Palette },
  { to: "/club/members", label: "Membros", icon: UserCog },
  { to: "/club/settings", label: "Configurações", icon: Settings },
  { to: "/club/billing", label: "Plano e cobrança", icon: CreditCard },
];
const STUDENT: NavItem[] = [
  { to: "/today", label: "Hoje", icon: Sun, tab: true },
  { to: "/schedule", label: "Agenda", icon: Calendar, tab: true },
  { to: "/classes", label: "Aulas", icon: CalendarClock, inProfile: true, feature: "classes" },
  { to: "/messages", label: "Mensagens", icon: MessageCircle, tab: true },
  { to: "/races", label: "Provas", icon: Flag, inProfile: true, feature: "races" },
  { to: "/activities", label: "Atividades", icon: Activity, inProfile: true, sidebar: false, feature: "strava" },
  { to: "/account", label: "Perfil", icon: User, tab: true },
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
/** The mobile "Mais" sheet: everything else, except what Perfil links to. */
export const moreFor = (role: Role, modalities?: Sport[]) => flat(role, modalities).filter((i) => !i.tab && !i.inProfile);
/**
 * What Perfil links to (students: Provas, Atividades). Perfil is the person's, not one club's: a link shows when any
 * club they're active in uses it. Without memberships, every link (routing only).
 */
export const profileLinksFor = (role: Role, memberships?: readonly MembershipContext[]) =>
  groupsFor(role).flatMap((g) => g.items).filter((i) => i.inProfile && (!memberships || !i.feature || anyClubHas(memberships, i.feature)));

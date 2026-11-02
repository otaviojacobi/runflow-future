import {
  Activity, BarChart3, Calendar, CalendarRange, ClipboardList, CreditCard, Dumbbell, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, User, UserCog, Users, type LucideIcon,
} from "lucide-react";
import type { Role, Sport } from "@/api/types";

/**
 * `tab`: in the mobile bottom bar (students: exactly 4, D-035). `inProfile`: on mobile, reached from Perfil instead of
 * the "Mais" sheet. `sidebar: false`: not in the desktop sidebar either (still in the command palette).
 * `gym`: only for clubs that teach musculação.
 */
export interface NavItem { to: string; label: string; icon: LucideIcon; tab?: boolean; inProfile?: boolean; sidebar?: false; gym?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF_MAIN: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, tab: true },
  { to: "/students", label: "Alunos", icon: Users, tab: true },
  { to: "/planning", label: "Planejamento", icon: CalendarRange, tab: true },
  { to: "/feedback", label: "Feedbacks", icon: MessageSquare, tab: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle },
];
const STAFF_TRAINING: NavItem[] = [
  { to: "/library", label: "Biblioteca", icon: Library },
  { to: "/plans", label: "Planilhas", icon: ClipboardList },
  { to: "/exercises", label: "Exercícios", icon: Dumbbell, gym: true },
  { to: "/assessments", label: "Avaliações", icon: Gauge },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
];
const STAFF_TEAM: NavItem[] = [
  { to: "/races/manage", label: "Provas", icon: Flag },
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
  { to: "/messages", label: "Mensagens", icon: MessageCircle, tab: true },
  { to: "/races", label: "Provas", icon: Flag, inProfile: true },
  { to: "/activities", label: "Atividades", icon: Activity, inProfile: true, sidebar: false },
  { to: "/account", label: "Perfil", icon: User, tab: true },
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
/** The mobile "Mais" sheet: everything else, except what Perfil links to. */
export const moreFor = (role: Role, modalities?: Sport[]) => flat(role, modalities).filter((i) => !i.tab && !i.inProfile);
/** What Perfil links to on mobile (students: Provas, Atividades). */
export const profileLinksFor = (role: Role) => flat(role).filter((i) => i.inProfile);

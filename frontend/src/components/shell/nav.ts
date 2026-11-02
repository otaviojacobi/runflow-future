import {
  Activity, BarChart3, Calendar, CalendarClock, CalendarRange, ClipboardList, CreditCard, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, Trophy, User, UserCog, Users, Wallet, Waves, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/api/types";

export interface NavItem { to: string; label: string; icon: LucideIcon; tab?: boolean }
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
  { to: "/assessments", label: "Avaliações", icon: Gauge },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
];
const STAFF_TEAM: NavItem[] = [
  { to: "/classes/manage", label: "Aulas", icon: CalendarClock },
  { to: "/races/manage", label: "Provas", icon: Flag },
  { to: "/challenges/manage", label: "Desafios", icon: Trophy },
];
const OWNER: NavItem[] = [
  { to: "/club/studio", label: "Club Studio", icon: Palette },
  { to: "/club/members", label: "Membros", icon: UserCog },
  { to: "/club/settings", label: "Configurações", icon: Settings },
  { to: "/club/finances", label: "Financeiro", icon: Wallet },
  { to: "/club/billing", label: "Plano e cobrança", icon: CreditCard },
];
const STUDENT: NavItem[] = [
  { to: "/today", label: "Hoje", icon: Sun, tab: true },
  { to: "/schedule", label: "Agenda", icon: Calendar, tab: true },
  { to: "/activities", label: "Atividades", icon: Activity, tab: true },
  { to: "/classes", label: "Aulas", icon: Waves, tab: true },
  { to: "/races", label: "Provas", icon: Flag },
  { to: "/challenges", label: "Desafios", icon: Trophy },
  { to: "/payments", label: "Pagamentos", icon: Wallet },
  { to: "/messages", label: "Mensagens", icon: MessageCircle },
  { to: "/account", label: "Perfil", icon: User, tab: true },
];

export function navFor(role: Role): NavGroup[] {
  if (role === "student") return [{ items: STUDENT }];
  const staff: NavGroup[] = [{ items: STAFF_MAIN }, { title: "Treinos", items: STAFF_TRAINING }, { title: "Equipe", items: STAFF_TEAM }];
  return role === "owner" ? [...staff, { title: "Clube", items: OWNER }] : staff;
}
export const tabsFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => i.tab);
export const moreFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => !i.tab);

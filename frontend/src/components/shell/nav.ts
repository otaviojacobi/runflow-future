import {
  Activity, BarChart3, Calendar, CalendarClock, CalendarRange, ClipboardList, CreditCard, Flag, Gauge, LayoutDashboard, Library, MessageCircle, MessageSquare,
  Palette, Settings, Sun, Trophy, User, UserCog, Users, Waves, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/api/types";

export interface NavItem { to: string; label: string; icon: LucideIcon; tab?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, tab: true },
  { to: "/students", label: "Alunos", icon: Users, tab: true },
  { to: "/planning", label: "Planejamento", icon: CalendarRange, tab: true },
  { to: "/feedback", label: "Feedbacks", icon: MessageSquare, tab: true },
  { to: "/messages", label: "Mensagens", icon: MessageCircle },
  { to: "/library", label: "Biblioteca", icon: Library },
  { to: "/plans", label: "Planilhas", icon: ClipboardList },
  { to: "/classes/manage", label: "Aulas", icon: CalendarClock },
  { to: "/races/manage", label: "Provas", icon: Flag },
  { to: "/assessments", label: "Avaliações", icon: Gauge },
  { to: "/challenges/manage", label: "Desafios", icon: Trophy },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
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
  { to: "/activities", label: "Atividades", icon: Activity, tab: true },
  { to: "/classes", label: "Aulas", icon: Waves, tab: true },
  { to: "/races", label: "Provas", icon: Flag },
  { to: "/challenges", label: "Desafios", icon: Trophy },
  { to: "/messages", label: "Mensagens", icon: MessageCircle },
  { to: "/account", label: "Perfil", icon: User, tab: true },
];

export function navFor(role: Role): NavGroup[] {
  if (role === "student") return [{ items: STUDENT }];
  return role === "owner" ? [{ items: STAFF }, { title: "Clube", items: OWNER }] : [{ items: STAFF }];
}
export const tabsFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => i.tab);
export const moreFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => !i.tab);

import {
  Activity, Calendar, CalendarClock, CalendarRange, ClipboardList, CreditCard, LayoutDashboard, Library, MessageSquare,
  Palette, Settings, Sun, User, UserCog, Users, Waves, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/api/types";

export interface NavItem { to: string; label: string; icon: LucideIcon; tab?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

const STAFF: NavItem[] = [
  { to: "/painel", label: "Painel", icon: LayoutDashboard, tab: true },
  { to: "/alunos", label: "Alunos", icon: Users, tab: true },
  { to: "/planejamento", label: "Planejamento", icon: CalendarRange, tab: true },
  { to: "/feedbacks", label: "Feedbacks", icon: MessageSquare, tab: true },
  { to: "/biblioteca", label: "Biblioteca", icon: Library },
  { to: "/planilhas", label: "Planilhas", icon: ClipboardList },
  { to: "/aulas/gestao", label: "Aulas", icon: CalendarClock },
];
const OWNER: NavItem[] = [
  { to: "/clube/estudio", label: "Club Studio", icon: Palette },
  { to: "/clube/membros", label: "Membros", icon: UserCog },
  { to: "/clube/configuracoes", label: "Configurações", icon: Settings },
  { to: "/clube/plano", label: "Plano e cobrança", icon: CreditCard },
];
const STUDENT: NavItem[] = [
  { to: "/hoje", label: "Hoje", icon: Sun, tab: true },
  { to: "/agenda", label: "Agenda", icon: Calendar, tab: true },
  { to: "/atividades", label: "Atividades", icon: Activity, tab: true },
  { to: "/aulas", label: "Aulas", icon: Waves, tab: true },
  { to: "/conta", label: "Perfil", icon: User, tab: true },
];

export function navFor(role: Role): NavGroup[] {
  if (role === "student") return [{ items: STUDENT }];
  return role === "owner" ? [{ items: STAFF }, { title: "Clube", items: OWNER }] : [{ items: STAFF }];
}
export const tabsFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => i.tab);
export const moreFor = (role: Role) => navFor(role).flatMap((g) => g.items).filter((i) => !i.tab);

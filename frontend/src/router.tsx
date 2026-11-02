import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { fetchMe, meKey } from "./api/me";
import type { Role } from "./api/types";
import { AppShell } from "./components/shell/AppShell";
import { t } from "./i18n";
import { setUnauthorizedHandler } from "./lib/api";
import { activeMembership, homeFor } from "./lib/club";
import { session } from "./lib/session";
import { queryClient } from "./queryClient";
import { SignInScreen } from "./screens/auth/SignIn";
import { ClubsScreen } from "./screens/clubs/Clubs";
import { ComponentsScreen } from "./screens/dev/Components";
import { StatusScreen } from "./screens/dev/Status";
import { CreateClubScreen } from "./screens/onboarding/CreateClub";
import { InviteScreen } from "./screens/onboarding/Invite";
import { WelcomeScreen } from "./screens/onboarding/Welcome";
import { Placeholder } from "./screens/Placeholder";
import { StudentsScreen } from "./screens/staff/Students";
import { MembersScreen } from "./screens/owner/Members";
import { LibraryScreen } from "./screens/staff/Library";
import { Toaster } from "./ui";

/**
 * Route tree (code-based). Screen IDs and steps: docs/build-plan.md. Routes are English; all visible text is pt-BR.
 * Placeholders mark screens whose step isn't built yet; each step swaps in the real component.
 */
const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: () => (<><Outlet /><Toaster /></>) });
const ensureMe = (qc: QueryClient) => qc.ensureQueryData({ queryKey: meKey, queryFn: fetchMe });
const todo = (title: string, step: string) => () => <Placeholder title={t(title)} step={step} />;
const r = <P extends string>(parent: Parameters<typeof createRoute>[0]["getParentRoute"], path: P, component: unknown) =>
  createRoute({ getParentRoute: parent, path, component } as never);

// ---------------------------------------------------------------- public
const index = createRoute({ getParentRoute: () => root, path: "/", component: lazyRouteComponent(() => import("./screens/public/Landing"), "LandingScreen") });
/** /app: "open the app" — sends a signed-in user to their role's home. */
const appHome = createRoute({
  getParentRoute: () => root, path: "/app",
  beforeLoad: async ({ context }) => {
    if (!session.isSignedIn()) throw redirect({ to: "/login" });
    throw redirect({ to: homeFor(activeMembership(await ensureMe(context.queryClient))?.membership.role) });
  },
});
const signIn = createRoute({
  getParentRoute: () => root, path: "/login", component: SignInScreen,
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
  beforeLoad: () => { if (session.isSignedIn()) throw redirect({ to: "/app" }); },
});
const invite = createRoute({ getParentRoute: () => root, path: "/invite/$token", component: InviteScreen });
const devComponents = createRoute({ getParentRoute: () => root, path: "/dev/components", component: ComponentsScreen });
const devStatus = createRoute({ getParentRoute: () => root, path: "/dev/status", component: StatusScreen });
const devStripe = createRoute({ getParentRoute: () => root, path: "/dev/stripe/$kind", component: todo("Stripe (simulado)", "F17") });

// ---------------------------------------------------------------- signed in, outside the shell
const authed = createRoute({
  getParentRoute: () => root, id: "authed", component: () => <Outlet />,
  beforeLoad: ({ location }) => { if (!session.isSignedIn()) throw redirect({ to: "/login", search: { redirect: location.href } }); },
});
const clubs = createRoute({ getParentRoute: () => authed, path: "/clubs", component: ClubsScreen, loader: ({ context }) => ensureMe(context.queryClient) });
const createClub = createRoute({ getParentRoute: () => authed, path: "/clubs/new", component: CreateClubScreen });
const welcome = createRoute({ getParentRoute: () => authed, path: "/welcome", component: WelcomeScreen, loader: ({ context }) => ensureMe(context.queryClient) });

// ---------------------------------------------------------------- the club shell (role-gated groups)
const shell = createRoute({
  getParentRoute: () => authed, id: "shell", component: AppShell,
  beforeLoad: async ({ context }) => {
    const m = activeMembership(await ensureMe(context.queryClient));
    if (!m) throw redirect({ to: "/clubs" });
    return { role: m.membership.role };
  },
});
const gate = (id: string, allowed: Role[]) =>
  createRoute({
    getParentRoute: () => shell, id, component: () => <Outlet />,
    beforeLoad: ({ context }) => { const role = (context as { role: Role }).role; if (!allowed.includes(role)) throw redirect({ to: homeFor(role) }); },
  });
const staff = gate("staff", ["owner", "trainer"]);
const owner = gate("owner", ["owner"]);
const student = gate("student", ["student"]);
const S = () => staff, O = () => owner, St = () => student, Sh = () => shell;

const staffRoutes = [
  r(S, "/dashboard", todo("Painel", "F13")),
  r(S, "/students", StudentsScreen),
  r(S, "/students/$id", todo("Aluno", "F11")),
  r(S, "/planning", todo("Planejamento", "F9")),
  r(S, "/library", LibraryScreen),
  r(S, "/library/new", lazyRouteComponent(() => import("./screens/staff/Builder"), "BuilderScreen")),
  r(S, "/library/$id", lazyRouteComponent(() => import("./screens/staff/Builder"), "BuilderScreen")),
  r(S, "/plans", todo("Planilhas", "F14")),
  r(S, "/plans/$id", todo("Planilha", "F14")),
  r(S, "/feedback", todo("Feedbacks", "F12")),
  r(S, "/classes/manage", todo("Gestão de aulas", "F15")),
];
const ownerRoutes = [
  r(O, "/club/studio", todo("Club Studio", "F16")),
  r(O, "/club/members", MembersScreen),
  r(O, "/club/settings", todo("Configurações do clube", "F16")),
  r(O, "/club/billing", todo("Plano e cobrança", "F17")),
];
const studentRoutes = [
  r(St, "/today", todo("Hoje", "F10")),
  r(St, "/schedule", todo("Agenda", "F10")),
  r(St, "/workouts/$id", todo("Treino", "F10")),
  r(St, "/activities", todo("Atividades", "F11")),
  r(St, "/activities/$id", todo("Atividade", "F11")),
  r(St, "/classes", todo("Aulas", "F15")),
];
const commonRoutes = [
  r(Sh, "/notifications", todo("Notificações", "F18")),
  r(Sh, "/account", todo("Minha conta", "F18")),
  r(Sh, "/account/profile", todo("Perfil", "F18")),
];

const routeTree = root.addChildren([
  index, appHome, signIn, invite, devComponents, devStatus, devStripe,
  authed.addChildren([
    clubs, createClub, welcome,
    shell.addChildren([staff.addChildren(staffRoutes), owner.addChildren(ownerRoutes), student.addChildren(studentRoutes), ...commonRoutes]),
  ]),
]);
export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });
setUnauthorizedHandler(() => router.navigate({ to: "/login", search: { redirect: router.state.location.href } }));

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { fetchMe, meKey } from "./api/me";
import { setUnauthorizedHandler } from "./lib/api";
import { activeMembership, homeFor } from "./lib/club";
import { session } from "./lib/session";
import { queryClient } from "./queryClient";
import { SignInScreen } from "./screens/auth/SignIn";
import { ClubsScreen } from "./screens/clubs/Clubs";
import { ComponentsScreen } from "./screens/dev/Components";
import { Placeholder } from "./screens/Placeholder";
import { t } from "./i18n";
import { Toaster } from "./ui";

/** Route tree (code-based). Screens live in src/screens/<area>/; routes are pt-BR (docs/build-plan.md). */
const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (<><Outlet /><Toaster /></>),
});

const requireAuth = ({ location }: { location: { href: string } }) => {
  if (!session.isSignedIn()) throw redirect({ to: "/entrar", search: { redirect: location.href } });
};
const ensureMe = (qc: QueryClient) => qc.ensureQueryData({ queryKey: meKey, queryFn: fetchMe });

// ---- public
const index = createRoute({
  getParentRoute: () => root, path: "/",
  beforeLoad: async ({ context }) => {
    if (!session.isSignedIn()) throw redirect({ to: "/entrar" });
    const m = activeMembership(await ensureMe(context.queryClient));
    throw redirect({ to: homeFor(m?.membership.role) });
  },
});
const signIn = createRoute({
  getParentRoute: () => root, path: "/entrar", component: SignInScreen,
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
  beforeLoad: () => { if (session.isSignedIn()) throw redirect({ to: "/" }); },
});
const invite = createRoute({ getParentRoute: () => root, path: "/convite/$token", component: () => <Placeholder title={t("Convite")} step="F5" /> });
const devComponents = createRoute({ getParentRoute: () => root, path: "/dev/componentes", component: ComponentsScreen });

// ---- signed in, outside the club shell
const authed = createRoute({ getParentRoute: () => root, id: "authed", beforeLoad: requireAuth, component: () => <Outlet /> });
const clubs = createRoute({ getParentRoute: () => authed, path: "/clubes", component: ClubsScreen, loader: ({ context }) => ensureMe(context.queryClient) });
const createClub = createRoute({ getParentRoute: () => authed, path: "/criar-clube", component: () => <Placeholder title={t("Criar clube")} step="F4" /> });

// ---- signed in, inside a club (shell arrives in F3)
const app = createRoute({
  getParentRoute: () => authed, id: "app",
  beforeLoad: async ({ context }) => {
    if (!activeMembership(await ensureMe(context.queryClient))) throw redirect({ to: "/clubes" });
  },
  component: () => <Outlet />,
});
const painel = createRoute({ getParentRoute: () => app, path: "/painel", component: () => <Placeholder title={t("Painel")} step="F13" /> });
const hoje = createRoute({ getParentRoute: () => app, path: "/hoje", component: () => <Placeholder title={t("Hoje")} step="F10" /> });

const routeTree = root.addChildren([index, signIn, invite, devComponents, authed.addChildren([clubs, createClub, app.addChildren([painel, hoje])])]);
export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });
setUnauthorizedHandler(() => router.navigate({ to: "/entrar", search: { redirect: router.state.location.href } }));

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { fetchMe, meKey } from "./api/me";
import type { Role } from "./api/types";
import { AppShell } from "./components/shell/AppShell";
import { setUnauthorizedHandler } from "./lib/api";
import { activeMembership, homeFor } from "./lib/club";
import { session } from "./lib/session";
import { syncClubTheme } from "./lib/theme";
import { queryClient } from "./queryClient";
import { SignInScreen } from "./screens/auth/SignIn";
import { ErrorScreen, NotFoundScreen } from "./screens/Fallbacks";
import { Toaster } from "./ui";

/**
 * Route tree (code-based). Screen IDs and steps: docs/build-plan.md. Routes are English; all visible text is pt-BR.
 */
/** Club colors only inside the signed-in app; public pages keep Runflow's brand (lib/theme RUNFLOW_BRANDED). */
function Root() {
  const path = useRouterState({ select: (st) => st.location.pathname });
  useEffect(() => { syncClubTheme(path); }, [path]);
  return <><Outlet /><Toaster /></>;
}
const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Root });
const ensureMe = (qc: QueryClient) => qc.ensureQueryData({ queryKey: meKey, queryFn: fetchMe });
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
  // `email`: from an invite (pre-filled and locked: only the invited address can accept it, D-023).
  validateSearch: (s: Record<string, unknown>): { redirect?: string; email?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined, email: typeof s.email === "string" ? s.email : undefined }),
  beforeLoad: () => { if (session.isSignedIn()) throw redirect({ to: "/app" }); },
});
const invite = createRoute({ getParentRoute: () => root, path: "/invite/$token", component: lazyRouteComponent(() => import("./screens/onboarding/Invite"), "InviteScreen") });
const devComponents = createRoute({ getParentRoute: () => root, path: "/dev/components", component: lazyRouteComponent(() => import("./screens/dev/Components"), "ComponentsScreen") });
const devLogo = createRoute({ getParentRoute: () => root, path: "/dev/logo", component: lazyRouteComponent(() => import("./screens/dev/Logo"), "LogoScreen") });
const devStatus = createRoute({ getParentRoute: () => root, path: "/dev/status", component: lazyRouteComponent(() => import("./screens/dev/Status"), "StatusScreen") });
const devOutbox = createRoute({ getParentRoute: () => root, path: "/dev/outbox", component: lazyRouteComponent(() => import("./screens/dev/Outbox"), "OutboxScreen") });
const devStripe = createRoute({ getParentRoute: () => root, path: "/dev/stripe/$kind", component: lazyRouteComponent(() => import("./screens/dev/StripeMock"), "StripeMockScreen") });

// ---------------------------------------------------------------- signed in, outside the shell
const authed = createRoute({
  getParentRoute: () => root, id: "authed", component: () => <Outlet />,
  beforeLoad: ({ location }) => { if (!session.isSignedIn()) throw redirect({ to: "/login", search: { redirect: location.href } }); },
});
const clubs = createRoute({ getParentRoute: () => authed, path: "/clubs", component: lazyRouteComponent(() => import("./screens/clubs/Clubs"), "ClubsScreen"), loader: ({ context }) => ensureMe(context.queryClient) });
const createClub = createRoute({ getParentRoute: () => authed, path: "/clubs/new", component: lazyRouteComponent(() => import("./screens/onboarding/CreateClub"), "CreateClubScreen") });
const welcome = createRoute({ getParentRoute: () => authed, path: "/welcome", component: lazyRouteComponent(() => import("./screens/onboarding/Welcome"), "WelcomeScreen"), loader: ({ context }) => ensureMe(context.queryClient) });

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
  r(S, "/dashboard", lazyRouteComponent(() => import("./screens/staff/Dashboard"), "DashboardScreen")),
  r(S, "/students", lazyRouteComponent(() => import("./screens/staff/Students"), "StudentsScreen")),
  r(S, "/students/$id", lazyRouteComponent(() => import("./screens/staff/Student"), "StudentScreen")),
  r(S, "/planning", lazyRouteComponent(() => import("./screens/staff/planning/Planning"), "PlanningScreen")),
  r(S, "/library", lazyRouteComponent(() => import("./screens/staff/Library"), "LibraryScreen")),
  r(S, "/library/new", lazyRouteComponent(() => import("./screens/staff/Builder"), "BuilderScreen")),
  r(S, "/library/$id", lazyRouteComponent(() => import("./screens/staff/Builder"), "BuilderScreen")),
  r(S, "/exercises", lazyRouteComponent(() => import("./screens/staff/Exercises"), "ExercisesScreen")),
  r(S, "/plans", lazyRouteComponent(() => import("./screens/staff/plans/Plans"), "PlansScreen")),
  r(S, "/plans/$id", lazyRouteComponent(() => import("./screens/staff/plans/PlanEditor"), "PlanEditorScreen")),
  r(S, "/feedback", lazyRouteComponent(() => import("./screens/staff/Feedback"), "FeedbackScreen")),
  r(S, "/reports", lazyRouteComponent(() => import("./screens/staff/Reports"), "ReportsScreen")),
  r(S, "/assessments", lazyRouteComponent(() => import("./screens/staff/Assessments"), "AssessmentsScreen")),
  r(S, "/races/manage", lazyRouteComponent(() => import("./screens/staff/Races"), "RacesManageScreen")),
];
const ownerRoutes = [
  r(O, "/club/studio", lazyRouteComponent(() => import("./screens/owner/Studio"), "StudioScreen")),
  r(O, "/club/members", lazyRouteComponent(() => import("./screens/owner/Members"), "MembersScreen")),
  r(O, "/club/settings", lazyRouteComponent(() => import("./screens/owner/Settings"), "SettingsScreen")),
  r(O, "/club/billing", lazyRouteComponent(() => import("./screens/owner/Billing"), "BillingScreen")),
];
const studentRoutes = [
  r(St, "/today", lazyRouteComponent(() => import("./screens/student/Today"), "TodayScreen")),
  r(St, "/schedule", lazyRouteComponent(() => import("./screens/student/Schedule"), "ScheduleScreen")),
  r(St, "/workouts/$id", lazyRouteComponent(() => import("./screens/student/Workout"), "WorkoutScreen")),
  r(St, "/activities", lazyRouteComponent(() => import("./screens/student/Activities"), "ActivitiesScreen")),
  r(St, "/activities/$id", lazyRouteComponent(() => import("./screens/student/ActivityDetail"), "ActivityDetailScreen")),
  r(St, "/races", lazyRouteComponent(() => import("./screens/student/Races"), "RacesScreen")),
  r(St, "/account/profile", lazyRouteComponent(() => import("./screens/student/Profile"), "ProfileScreen")),
];
const commonRoutes = [
  r(Sh, "/messages", lazyRouteComponent(() => import("./screens/common/messages/Messages"), "MessagesScreen")),
  r(Sh, "/notifications", lazyRouteComponent(() => import("./screens/common/Notifications"), "NotificationsScreen")),
  r(Sh, "/account", lazyRouteComponent(() => import("./screens/common/Account"), "AccountScreen")),
];

const routeTree = root.addChildren([
  index, appHome, signIn, invite, devComponents, devStatus, devLogo, devStripe, devOutbox,
  authed.addChildren([
    clubs, createClub, welcome,
    shell.addChildren([staff.addChildren(staffRoutes), owner.addChildren(ownerRoutes), student.addChildren(studentRoutes), ...commonRoutes]),
  ]),
]);
export const router = createRouter({
  routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true,
  defaultNotFoundComponent: NotFoundScreen,
  defaultErrorComponent: ({ error, reset }) => <ErrorScreen error={error} reset={reset} />,
});
setUnauthorizedHandler(() => router.navigate({ to: "/login", search: { redirect: router.state.location.href } }));

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

import { createRootRouteWithContext, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { Scaffold } from "./screens/Scaffold";
import { ComponentsScreen } from "./screens/dev/Components";
import { Toaster } from "./ui";

/** Route tree (code-based). Screens live in src/screens/<area>/; routes are pt-BR (docs/build-plan.md). */
const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: () => (<><Outlet /><Toaster /></>) });
const index = createRoute({ getParentRoute: () => root, path: "/", component: Scaffold });
const devComponents = createRoute({ getParentRoute: () => root, path: "/dev/componentes", component: ComponentsScreen });

export const router = createRouter({ routeTree: root.addChildren([index, devComponents]), context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

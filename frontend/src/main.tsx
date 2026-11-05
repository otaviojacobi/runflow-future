import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@runflow/design/fonts.css";
import "@runflow/design/tokens.css";
import "./styles.css";
import { queryClient } from "./queryClient";
import { router } from "./router";
import { setupPwa } from "./lib/pwa";
import { installPrintTheme, promoteClubTheme } from "./lib/theme";
import { publicConfigQuery } from "./api/auth";
import { startSentry } from "./lib/sentry";
import { startAnalytics, trackPageView } from "./lib/analytics";

// Dev injects CSS at runtime; make sure the cached club theme still comes last (§7.8).
promoteClubTheme();
installPrintTheme();
setupPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Errors to Sentry (S12) and page views to Umami (D-054) when the API turns them on: after the first render, never in
// the initial bundle. Page views follow the router (one per resolved route, URLs masked in lib/analytics).
queryClient.fetchQuery(publicConfigQuery).then((c) => {
  if (c.sentry) void startSentry(c.sentry);
  if (c.analytics) startAnalytics(c.analytics, () => {
    trackPageView();
    router.subscribe("onResolved", trackPageView);
  });
}).catch(() => undefined);

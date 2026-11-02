import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@runflow/design/fonts.css";
import "@runflow/design/tokens.css";
import "./styles.css";
import { queryClient } from "./queryClient";
import { router } from "./router";
import { promoteClubTheme } from "./lib/theme";

// Dev injects CSS at runtime; make sure the cached club theme still comes last (§7.8).
promoteClubTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

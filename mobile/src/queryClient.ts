/**
 * TanStack Query, as on the web. Coming back to the foreground counts as "focus", so stale data (incl. `/me`, which
 * carries every club's theme) revalidates on launch and on resume (root.md §7.8 step 3).
 */
import { QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { ApiError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (404, 403…) won't change on retry; network trouble and 5xx get one more try.
      retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
});

if (Platform.OS !== "web") {
  focusManager.setEventListener((onFocus) => {
    const sub = AppState.addEventListener("change", (s) => onFocus(s === "active"));
    return () => sub.remove();
  });
}

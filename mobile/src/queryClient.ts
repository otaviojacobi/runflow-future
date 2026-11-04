/**
 * TanStack Query, as on the web. Coming back to the foreground counts as "focus", so stale data (incl. `/me`, which
 * carries every club's theme) revalidates on launch and on resume (root.md §7.8 step 3). Reconnecting (the OS's network
 * state, expo-network) refetches stale queries too; the API's own reachability is lib/offline.ts's job.
 */
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { AppState, Platform } from "react-native";
import { ApiError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Always try (never "paused"): with nothing saved on the device, an offline start shows why and a retry.
      networkMode: "always",
      // A request that got no answer (status 0) is worth a few more tries (1 s, 2 s, 4 s); client errors (404, 403…)
      // won't change on retry; 5xx get one more try.
      retry: (count, err) => {
        if (!(err instanceof ApiError)) return count < 1;
        if (err.status === 0) return count < 3;
        return err.status >= 500 && count < 1;
      },
    },
    // Changes fail at once without a connection ("Sem conexão" toast) instead of waiting silently.
    mutations: { networkMode: "always" },
  },
});

if (Platform.OS !== "web") {
  focusManager.setEventListener((onFocus) => {
    const sub = AppState.addEventListener("change", (s) => onFocus(s === "active"));
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false));
    Network.getNetworkStateAsync().then((s) => setOnline(s.isConnected !== false)).catch(() => undefined);
    return () => sub.remove();
  });
}

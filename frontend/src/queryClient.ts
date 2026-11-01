import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => (err instanceof ApiError ? (err.status === 0 || err.status >= 500) && count < 2 : count < 2),
    },
    mutations: { retry: false },
  },
});

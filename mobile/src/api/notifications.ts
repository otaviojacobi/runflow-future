/**
 * W11 · Notificações and the push control (D-045, N1; api/endpoints.md § Notifications): the center (newest first,
 * keyset pages, read marks) and, per kind, whether it also arrives as a push on the person's devices, plus "Pausar
 * tudo". Same keys as the web. Writes are optimistic: a tap shows at once, a failure puts the old value back and says why.
 */
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { toast } from "@/ui";
import { meKey } from "./me";
import type { AppNotification, Me, NotificationKind, NotificationPrefs, Page as WirePage, PrefsPatch } from "./types";

export const notificationKeys = { all: ["me", "notifications"] as const, prefs: ["me", "prefs"] as const };

// ---------- push per kind (C1)
export const usePrefs = () => useQuery({ queryKey: notificationKeys.prefs, queryFn: () => api.get<NotificationPrefs>("/me/prefs") });

/** What PATCH /me/prefs will answer, applied locally (kinds merge per kind). */
export function applyPrefs(p: NotificationPrefs, v: PrefsPatch): NotificationPrefs {
  const kinds = { ...p.kinds };
  for (const k of Object.keys(v.kinds ?? {}) as NotificationKind[]) kinds[k] = { ...kinds[k], ...v.kinds![k] };
  return { kinds, paused: v.paused ?? p.paused };
}
export const useUpdatePrefs = () =>
  useMutation({
    mutationFn: (v: PrefsPatch) => api.patch<NotificationPrefs>("/me/prefs", v),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.prefs });
      const before = queryClient.getQueryData<NotificationPrefs>(notificationKeys.prefs);
      if (before) queryClient.setQueryData(notificationKeys.prefs, applyPrefs(before, v));
      return { before };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(notificationKeys.prefs, ctx.before);
      toast.error(err);
    },
    onSuccess: (p) => queryClient.setQueryData(notificationKeys.prefs, p),
  });

// ---------- the center (W11)
type Page = WirePage<AppNotification>;
export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: notificationKeys.all, initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<Page>(`/me/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next_cursor || undefined,
  });

/** Mark some (or, without ids, all) as read: the dots and the bell's count clear at once. */
export const useMarkNotificationsRead = () =>
  useMutation({
    mutationFn: (ids?: string[]) => api.post("/me/notifications/read", ids ? { ids } : {}),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const list = queryClient.getQueryData<InfiniteData<Page>>(notificationKeys.all);
      const me = queryClient.getQueryData<Me>(meKey);
      const now = new Date().toISOString();
      const hit = (n: AppNotification) => !n.read_at && (!ids || ids.includes(n.id));
      if (list) {
        queryClient.setQueryData<InfiniteData<Page>>(notificationKeys.all, {
          ...list, pages: list.pages.map((p) => ({ ...p, items: p.items.map((n) => (hit(n) ? { ...n, read_at: now } : n)) })),
        });
      }
      if (me) queryClient.setQueryData<Me>(meKey, { ...me, unread_notifications: ids ? Math.max(0, me.unread_notifications - ids.length) : 0 });
      return { list, me };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.list) queryClient.setQueryData(notificationKeys.all, ctx.list);
      if (ctx?.me) queryClient.setQueryData(meKey, ctx.me);
      toast.error(err);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });

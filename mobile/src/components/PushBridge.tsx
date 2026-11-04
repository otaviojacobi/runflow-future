/**
 * Phone push, app side (X10): sets how pushes show while the app is open, keeps this phone registered while signed
 * in, mirrors the unread count on the app icon, and opens a tapped push: it switches to the push's club first, then
 * opens its link in the app (or on the web when no screen matches) and marks it read. Renders nothing.
 */
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { meKey } from "@/api/me";
import { api } from "@/lib/api";
import { selectClub } from "@/lib/club";
import { useAppLink } from "@/lib/links";
import { configurePush, refreshPush, setBadge } from "@/lib/push";
import { session, useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";
import { queryClient } from "@/queryClient";

configurePush();

export function PushBridge() {
  const { signedIn, me } = useSession();
  const appLink = useAppLink();
  const opened = useRef(new Set<string>());

  useEffect(() => { if (signedIn) void refreshPush(); }, [signedIn]);
  const unread = me?.unread_notifications ?? 0;
  useEffect(() => { setBadge(signedIn ? unread : 0); }, [signedIn, unread]);

  useEffect(() => {
    if (!signedIn) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = (r.notification.request.content.data ?? {}) as { id?: unknown; link?: unknown; club_id?: unknown };
      const id = typeof data.id === "string" ? data.id : r.notification.request.identifier;
      if (opened.current.has(id)) return;
      opened.current.add(id);
      const link = typeof data.link === "string" ? data.link : null;
      const m = typeof data.club_id === "string" ? session.me()?.memberships.find((x) => x.club.id === data.club_id) : undefined;
      if (m) selectClub(m);
      const target = appLink(link);
      if (target) router.push(target);
      else if (link) void openOnWeb(link);
      else router.push("/notifications");
      if (typeof data.id === "string") {
        void api.post("/me/notifications/read", { ids: [data.id] }).then(() => queryClient.invalidateQueries({ queryKey: meKey })).catch(() => undefined);
      }
    };
    // A tap that launched the app, then taps while it runs.
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    // A push that arrives while the app is open: refresh the bell, the student's cards and, at once, an open
    // conversation on that workout (it also polls every 10 s, lib/live).
    const received = Notifications.addNotificationReceivedListener((n) => {
      const link = n.request.content.data?.link;
      const workout = typeof link === "string" ? /(?:workouts\/|[?&]workout=)([\w-]+)/.exec(link)?.[1] : undefined;
      void queryClient.invalidateQueries({ queryKey: meKey });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("my") || (q.queryKey.includes("thread") && (!workout || q.queryKey.includes(workout))) });
    });
    return () => { sub.remove(); received.remove(); };
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

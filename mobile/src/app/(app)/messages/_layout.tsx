/**
 * Mensagens is a stack inside its tab: the list (index), then a conversation, an announcement or the composer pushed
 * on top, so back pops them and they stop polling once closed. The tab's own header is off (each screen draws its
 * bar), and pushed screens hide the tab bar, like a native push (a chat needs the room and the keyboard).
 */
import { Stack, useNavigation, useSegments } from "expo-router";
import { useLayoutEffect } from "react";
import { useTheme } from "@/theme/ThemeProvider";

// A link straight to a conversation (a notification) still has the list under it.
export const unstable_settings = { anchor: "index" };

export default function MessagesLayout() {
  const { theme } = useTheme();
  const tab = useNavigation();
  // [(app), messages] is the list; anything deeper (…/[id], …/compose, …/mural/[id]) is pushed.
  const segments = useSegments() as string[];
  const at = segments.indexOf("messages");
  const pushed = at >= 0 && at < segments.length - 1;
  useLayoutEffect(() => {
    tab.setOptions({ headerShown: false, tabBarStyle: pushed ? { display: "none" } : undefined });
  }, [tab, pushed]);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.canvas } }} />;
}

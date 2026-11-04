/**
 * Root: Runflow's splash stays up until the session token is read from the keychain (milliseconds); the cached `/me`
 * (club theme, role) is already in memory from the synchronous store, so the first frame is final (root.md §7.8).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { endSession } from "@/api/auth";
import { PushBridge } from "@/components/PushBridge";
import { setUnauthorizedHandler } from "@/lib/api";
import { session } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { SystemBarStrip, Toaster, toast } from "@/ui";
import { t } from "@/i18n";

SplashScreen.preventAutoHideAsync();

function Shell() {
  const { theme } = useTheme();
  useEffect(() => {
    // The session expired or was revoked elsewhere (Perfil → sessões on the web): start over at sign-in.
    setUnauthorizedHandler(() => {
      void endSession().then(() => {
        toast.info(t("Sua sessão terminou"), t("Entre de novo para continuar."));
        router.replace("/login");
      });
    });
  }, []);
  // The window behind every screen follows the theme (it kept the splash's brand color, which showed as a purple bar
  // behind Android's navigation buttons); the buttons themselves sit on SystemBarStrip's black.
  useEffect(() => { void SystemUI.setBackgroundColorAsync(theme.color.canvas).catch(() => undefined); }, [theme.color.canvas]);
  // White buttons on that black, in every window (sheets too). expo-navigation-bar's "light" = light buttons (its
  // native code; the docs word it the other way round), also set at build time by app.json's plugin options.
  useEffect(() => { if (Platform.OS === "android") try { NavigationBar.setStyle("light"); } catch { /* older Android: nothing to style */ } }, []);
  return (
    <>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.canvas } }} />
      <SystemBarStrip />
      <PushBridge />
      <Toaster />
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { session.load().finally(() => setReady(true)); }, []);
  useEffect(() => { if (ready) SplashScreen.hide(); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

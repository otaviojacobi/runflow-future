/**
 * Root: Runflow's splash stays up until the session token is read from the keychain (milliseconds); the cached `/me`
 * (club theme, role) is already in memory from the synchronous store, so the first frame is final (root.md §7.8).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { endSession } from "@/api/auth";
import { setUnauthorizedHandler } from "@/lib/api";
import { session } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { Toaster, toast } from "@/ui";
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
  return (
    <>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.canvas } }} />
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

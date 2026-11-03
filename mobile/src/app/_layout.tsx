/** Root: keeps Runflow's splash up until the session token is read; the club theme is already cached (sync). */
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { session } from "@/lib/api";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { Toaster } from "@/ui";

SplashScreen.preventAutoHideAsync();

function Shell() {
  const { theme } = useTheme();
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
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

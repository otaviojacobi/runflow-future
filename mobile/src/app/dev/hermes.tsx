/** Dev only: runs lib/diagnostics on this device's JS engine and logs `RF_DIAG {...}` (compare with scripts/diagnostics.mjs). */
import { Redirect } from "expo-router";
import { useEffect, useMemo } from "react";
import { runDiagnostics } from "@/lib/diagnostics";
import { Screen, Text } from "@/ui";

export default function HermesDiagnostics() {
  const result = useMemo(() => {
    if (!__DEV__) return null;
    // Every route module evaluated here, as a release build does at start: a module that throws on load is a crash.
    const ctx = (require as unknown as { context: (dir: string, deep: boolean, re: RegExp) => { keys(): string[]; (k: string): unknown } }).context("..", true, /\.tsx$/);
    const errors: string[] = [];
    for (const k of ctx.keys()) { try { ctx(k); } catch (e) { errors.push(`${k}: ${(e as Error)?.message ?? String(e)}`); } }
    return { ...runDiagnostics(), routes: { loaded: ctx.keys().length, errors } };
  }, []);
  useEffect(() => { if (result) console.log("RF_DIAG " + JSON.stringify(result)); }, [result]);
  if (!__DEV__ || !result) return <Redirect href="/" />;
  return (
    <Screen insetTop insetBottom>
      <Text variant="bodySm" selectable>{JSON.stringify(result, null, 1)}</Text>
    </Screen>
  );
}

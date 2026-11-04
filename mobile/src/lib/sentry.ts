/**
 * Error reporting (Sentry, errors only: founder's rule, free features). Initialized at import, before the first
 * render, so even a crash while the app starts is reported (the release APK's Intl.PluralRules crash took a cable and
 * adb to find). The DSN is a build setting (eas.json, EXPO_PUBLIC_SENTRY_DSN; public by design): without it (local dev,
 * Expo Go) nothing is sent. Reports carry the user's id, never the e-mail. `.web.ts` = the web preview, no-ops.
 */
import * as Sentry from "@sentry/react-native";
import type { ComponentType } from "react";
import { session } from "./session";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "qa",
    sendDefaultPii: false,
    // Errors only: no tracing, profiling, replay or logs.
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
  });
  let last: string | null = null;
  const follow = () => {
    const id = session.me()?.user.id ?? null;
    if (id === last) return;
    last = id;
    Sentry.setUser(id ? { id } : null);
  };
  follow();
  session.subscribe(follow);
}

/** Wraps the root component (error boundary + touch breadcrumbs); a plain pass-through without a DSN. */
export const withErrorReporting = (C: ComponentType): ComponentType =>
  dsn ? (Sentry.wrap(C as ComponentType<Record<string, unknown>>) as ComponentType) : C;

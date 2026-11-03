/**
 * Rewrites links that open the app before Expo Router matches them. Strava sends the phone back to
 * `runflow://<web host>/connect/strava?code&state&scope` (api/endpoints.md § Providers): the host isn't a route here,
 * so any path ending in `connect/strava` goes to the /connect/strava screen with its query. Everything else is kept.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const m = /connect\/strava\/?(\?.*)?$/.exec(path);
    return m ? `/connect/strava${m[1] ?? ""}` : path;
  } catch {
    return path;
  }
}

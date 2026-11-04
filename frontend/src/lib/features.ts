/**
 * What a club sees, from its modalities (D-052): every role (owners and trainers too) sees only the features of the
 * modalities the club has; the owner turns modalities on and off in Configurações and everything follows. This file
 * is the whole rule: the web (frontend/src/lib/features.ts) and the app (mobile/src/lib/features.ts) keep identical
 * copies (`node scripts/check-copies.mjs` in `npm run check`). Screens ask `has(club, feature)`; nothing else checks
 * `modalities` for visibility. The API stays available whatever the modalities (UI only).
 */
import type { MembershipContext, Sport } from "@/api/types";

export type Feature = "classes" | "exercises" | "races" | "strava" | "zones";

/** Feature → the modalities that use it. A club with any of them sees the feature. */
export const FEATURES: Readonly<Record<Feature, readonly Sport[]>> = {
  classes: ["mobility", "strength", "swim"], // Aulas: schedules, bookings, waitlist, check-in (G4/G5)
  exercises: ["mobility", "strength"], // Exercícios: the exercise library and its videos
  races: ["run", "swim", "bike"], // Provas
  strava: ["run", "swim", "bike"], // Strava, Relógios e apps, Atividades, activity matching, "Powered by Strava"
  zones: ["run", "swim", "bike"], // pace / HR / swim zones and the tests that make them
};

/** Avaliações: each test belongs to modalities ("always" = every club, e.g. the physical assessment). */
export type TestKind = "body" | "cooper" | "run_3k" | "css" | "ftp" | "one_rm" | "hr_max";
export const TESTS: Readonly<Record<TestKind, readonly Sport[] | "always">> = {
  body: "always",
  cooper: ["run"],
  run_3k: ["run"],
  css: ["swim"],
  ftp: ["bike"],
  hr_max: ["run", "swim", "bike"],
  one_rm: ["mobility", "strength"],
};

type WithModalities = { modalities: readonly Sport[] } | null | undefined;

/** The club uses the feature (one of its modalities is in the feature's list). */
export const has = (club: WithModalities, feature: Feature): boolean =>
  !!club && club.modalities.some((s) => FEATURES[feature].includes(s));

/** Account-level surfaces (Perfil, Relógios e apps): any club the person is active in uses the feature. */
export const anyClubHas = (memberships: readonly Pick<MembershipContext, "membership" | "club">[] | null | undefined, feature: Feature): boolean =>
  (memberships ?? []).some((m) => m.membership.status === "active" && has(m.club, feature));

/** The tests the club can record (Avaliações), in the given order. */
export const testsFor = <K extends TestKind>(club: WithModalities, kinds: readonly K[]): K[] =>
  kinds.filter((k) => {
    const sports = TESTS[k];
    return sports === "always" || (!!club && club.modalities.some((s) => sports.includes(s)));
  });

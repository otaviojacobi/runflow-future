# mobile/: CLAUDE.md

The Runflow app for Android and iOS: Expo SDK 58 (React Native 0.88, new architecture) + TypeScript + Expo Router. One app for every role (D-005). Read `../root.md` (§7.5, §7.8) and `../docs/build-plan.md` (Phase 3) first, and `AGENTS.md` (Expo's own guidance: check the versioned docs, never trust memory for Expo APIs). Future standalone repo: `runflow-mobile`.

## Commands

| From the repo root | What |
|---|---|
| `npm run dev:mobile` | Expo dev server with the web preview on **:8082** (`r` reload, `a` Android emulator, QR for Expo Go). Needs the mock API (`npm run dev`) |
| `npm run check -w @runflow/mobile` | Typecheck (part of `npm run check`; it first writes the typed routes with `scripts/typed-routes.mjs`, so no dev server is needed) + the quick-text golden examples (`scripts/check-workout-text.mjs`, plain Node: it strips the types itself) |
| `cd mobile && npx expo install <pkg>` | Add a dependency with the SDK-compatible version. Never plain `npm i` for Expo/RN packages |
| `cd mobile && npx expo export --platform android` | Bundle check without a device |
| `npm run apk` | An installable Android APK pointed at QA, built on Expo's servers (EAS, `eas.json` profile `preview`; project `@otaviorunflows-team/runflow`); prints the install link and QR. Needs `EXPO_TOKEN` in the root `.env` |
| `npm run eas -- <args>` | Any EAS CLI command with that token (`build:list`, `credentials`, …) |

On a physical phone, point the app at your computer: `EXPO_PUBLIC_API_URL=http://<your-ip>:8787/v1 npm run dev:mobile`.
`EXPO_PUBLIC_WEB_URL` is the web app, opened for what has no screen in the app yet; without it the app derives it from
the API URL (the local mock :8787 → :8080; a same-origin `<web>/api/v1`), else those links say "Disponível no computador".

## Layout

```
src/
  app/        Expo Router routes only (_layout.tsx = splash + providers + the 401 handler): login (A2: "Sou aluno" /
              "Sou treinador" via `?perfil=`, remembered on the device; Google + e-mail code), invite/[token]
              (A3), clubs (A6/A7) and clubs/new (A5, the create-club wizard) in Runflow's theme; welcome (A4, the
              student's first steps, in the club's colors); connect/strava (Strava's answer as a link); +native-intent
              (rewrites `runflow://<host>/connect/strava` to that route); (app)/ = the signed-in app: _layout guards (session + club),
              applies the club theme and declares the role's tabs (Tabs.Protected per role); one file per web path
              (today, schedule, messages, account, dashboard, students, planning, feedback, more, notifications…);
              dev/components = the UI kit preview
  api/        TanStack Query hooks per area + types.ts (wire types, identical to the contract), like the web's src/api
  domain/     pure logic copied from the web's src/domain (keep in sync): workout.ts = the workout structure types,
              zones, intensity segments, step texts, estimates; assessments.ts = test formulas and the zones they make;
              quicktext.ts + tags.ts = verbatim copies of the web's
              free-text grammar and hashtag rules (scripts/check-workout-text.mjs checks them against
              api/workout-text-examples.json in `npm run check`); builder.ts = editing helpers (new blocks, ranges, moves)
  components/ domain components shared by screens (brand: Runflow mark/wordmark + ClubLogo; sport chips; ComingSoon;
              workout/ = intensity profile, steps, status, week strip, month grid, workout card, feedback sheet, thread
              and its message bubbles; staff/ = the trainer's pieces: workout row, compliance, filter chips,
              the workout sheet (detail, move, edit, remove, thread), assign, copy week, week release, groups,
              pickers (library list, students with group shortcuts), WorkoutPicker (library or build now → a draft);
              plans.tsx = the planilhas' weekly volume bars (a week switcher in the editor);
              account/ = C1/M7 sections, confirm sheet, stepper, zones table, notification settings, pt-BR labels;
              messages/ = conversation rows, the chat thread and composer, announcement cards, the stack's top bar;
              activity.tsx = an activity row; matching.tsx = activity matching (D-049): "Qual treino foi esta
              atividade?" (MatchQuestion, PendingMatches on Hoje) and the "Trocar/Escolher treino" sheet (MatchSheet);
              connections/StravaConnect = the connect panel (the sharing statement it requires, D-011, + the hook and
              the mock sheet) and `disconnectsStrava` for the warnings; strava.tsx = Strava's brand: the official
              button, "Powered by Strava", "View on Strava" (docs/strava-brand.md; artwork in assets/strava);
              club/ = color picker, theme preview (a phone in a club's colors), the one-by-one invite form,
              contrast report, the spreadsheet import; billing/ = plan copy (copy of the web's plans.ts), seat meters,
              the mock's Stripe checkout and portal sheets; shell/FrozenLayer = the frozen club's icy layer, D-043;
              builder/ = the workout builder (quick text, block list, step/series/exercise sheets, summary, tags,
              "Descrever com IA", .FIT) and the template editor;
              races.tsx = race labels, distances, countdown, date tile, entry badge;
              assessments.ts = the test protocols, names and result headlines);
              shell/ = nav.ts (copy of the web's nav per role, `app` = has a screen here, the rest opens the web) and
              Shell.tsx (top bar with the club switcher and bell, back bar, bottom tab bar)
  lib/        api (ApiError, WEB_URL), session (token in the keychain + cached `/me` and active club in the sync store,
              one snapshot for useSession()), club (active club, homeFor, clubColors, invite links), web (openOnWeb),
              format (copy of the web's), storage (sync kv: native kv-store / web localStorage), secure (token),
              offline (the student's week saved on the device for the person signed in + the connection state:
              the OS's network AND the API answering; it probes /health with backoff while the API doesn't answer),
              reachability (whether the API last answered; lib/api.ts reports every request),
              links (a notification's web path → the app's route when a screen matches), avatar (photo library →
              ≤ 512 px JPEG data URL), files (a text or binary file through the share sheet; `.web.ts` downloads
              it), fit (the .FIT workout encoder, a copy of the web's),
              strava (connect: auth session or the deep link, the callback posted once per code), google (native
              Google sign-in, X16: `@react-native-google-signin/google-signin` loaded only when its native module is in
              the build, never in Expo Go; the web client id from `/public/config` → an ID token for POST /auth/google;
              `.web.ts` = unavailable; Android needs the founder's Android OAuth client, iOS the plugin's
              `iosUrlScheme`), logo (photo
              library → ≤ 512 px PNG data URL), push (this phone's push: permission, Expo token, register/forget,
              badge; `.web.ts` no-ops), csv (";", decimal comma, BOM → share sheet; `parseCsv` reads one in), pdf
              (HTML → PDF with expo-print → share sheet; `.web.ts` prints), video (YouTube/Vimeo links, thumbnails),
              textfile (pick a text file: the document picker; `.web.ts` reads the browser's File);
              components/PushBridge = opens a tapped push in its club
  theme/      theme.ts (tokens → RN theme, club roles via @runflow/design/color), ThemeProvider (Runflow's theme,
              color mode) + ThemeScope (re-theme a subtree: a club's colors, forced light/dark)
  ui/         the UI kit: same names/variants as frontend/src/ui (index.ts lists them); icons.ts = Lucide icons, one
              import per icon (add new ones there, never import the lucide-react-native barrel); keyboard.tsx =
              KeyboardAvoid, useFocusedInputVisible, KeyboardScrollView (see the keyboard rule below)
  queryClient.ts  TanStack Query; returning to the foreground counts as focus (revalidates `/me` and themes);
              reconnecting refetches (onlineManager ← expo-network); no-answer errors retry 3×, mutations never wait
  i18n.ts     t()/tn(), same contract as the web app
```

Routes mirror the web's paths, so links work in both: invite e-mails link to `<PUBLIC_APP_URL>/invite/<token>`, which
the app opens as `runflow://invite/<token>` (dev build), `exp://<ip>:8081/--/invite/<token>` (Expo Go) or, once the
hosts serve the App Links / Universal Links files, the https link itself.

Module state read during render must come from a hook snapshot (`useSession()`, queries): the React Compiler
memoizes render output, so a plain `session.me()` call in render can go stale.

UI kit notes: components read `useTheme().theme` (colors, space, radius, size, motion, shadow); `Text` takes a token
`variant` and a `tone`; `Field` hands its control `accessibilityLabel`/`accessibilityHint`/`invalid` (render prop);
`Dialog` is a bottom sheet and `Menu` an action sheet; `toast.error(err)` shows the API's pt-BR title/detail.
Preview every change at `/dev/components` (light and dark side by side, demo club themes).

## Rules

- Same product rules as the web app: pt-BR text through `t()`, tokens only (`useTheme().theme`), contract-first API (`api/endpoints.md`), no AI attribution.
- **Club colors only when signed in (D-024):** sign-in, invite and onboarding-before-joining screens use Runflow's theme; apply the cached club theme only inside the signed-in app.
- **First frame is themed (§7.8):** the club colors are read synchronously from `storage` before render; the splash stays until the session token is loaded. Never fetch the theme before showing the first screen.
- Platform splits use `.web.ts` files (the web preview only; the product is Android/iOS).
- Everything except phone push must keep working in Expo Go. Push needs a development build (`expo-dev-client`;
  `cd mobile && eas build -p android --profile development`, profiles in `eas.json` point at QA) and the founder's
  Expo project and credentials (`docs/ops/push-notifications.md`); in Expo Go the device card says so.
- Accessibility: `accessibilityRole`/`accessibilityState` on touchables, 44 pt touch targets, visible text = accessible name.
- **The keyboard never covers an input.** Android is edge-to-edge (SDK 54+): the window no longer resizes for the
  keyboard, so `KeyboardAvoidingView behavior={ios ? "padding" : undefined}` does nothing there (the founder's phone
  hid the workout conversation's composer). Use ui's `KeyboardAvoid` (padding on both platforms, offset measured from
  where it starts in the window, since React Native measures the view relative to its parent) and scroll with
  `useFocusedInputVisible` / `KeyboardScrollView`. `Screen` and `Dialog` already do both. Plain React Native on purpose:
  react-native-keyboard-controller isn't in Expo Go.
- **"Sem internet" comes from the global connection state, never from one query's error.** `useOnline()` = the OS is
  connected AND the API answered last time (`lib/reachability`); after a request gets no answer the app probes
  `/health` (2, 5, 10, 20, 30, 60 s) and refetches on the first answer, so the banner clears by itself. A thrown
  fetch logs `[api] network error <method> <path> <error>` (logcat `ReactNativeJS`).
- **Phones run Hermes, not a browser:** the web preview hides engine gaps. Hermes has no `Intl.PluralRules` (`i18n.ts`
  writes the pt-BR rule out) and React Native's `URLSearchParams` is partial (use `lib/query.ts`). Before a release
  build, open `/dev/hermes` on a phone in Expo Go (`npx expo start`, `adb reverse tcp:8081 tcp:8081`): it loads every
  route module and logs `RF_DIAG {...}`, to compare with `node scripts/diagnostics.mjs` (Node's answers).

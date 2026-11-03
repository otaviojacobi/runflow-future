# mobile/: CLAUDE.md

The Runflow app for Android and iOS: Expo SDK 58 (React Native 0.88, new architecture) + TypeScript + Expo Router. One app for every role (D-005). Read `../root.md` (§7.5, §7.8) and `../docs/build-plan.md` (Phase 3) first, and `AGENTS.md` (Expo's own guidance: check the versioned docs, never trust memory for Expo APIs). Future standalone repo: `runflow-mobile`.

## Commands

| From the repo root | What |
|---|---|
| `npm run dev:mobile` | Expo dev server with the web preview on **:8082** (`r` reload, `a` Android emulator, QR for Expo Go). Needs the mock API (`npm run dev`) |
| `npm run check -w @runflow/mobile` | Typecheck (part of `npm run check`) |
| `cd mobile && npx expo install <pkg>` | Add a dependency with the SDK-compatible version. Never plain `npm i` for Expo/RN packages |
| `cd mobile && npx expo export --platform android` | Bundle check without a device |

On a physical phone, point the app at your computer: `EXPO_PUBLIC_API_URL=http://<your-ip>:8787/v1 npm run dev:mobile`.

## Layout

```
src/
  app/        Expo Router routes only (_layout.tsx = splash + providers + the 401 handler): login (A2), invite/[token]
              (A3), clubs (A6/A7); dev/components = the UI kit preview
  api/        TanStack Query hooks per area + types.ts (wire types, identical to the contract), like the web's src/api
  components/ domain components shared by screens (brand: Runflow mark/wordmark + ClubLogo; sport chips)
  lib/        api (ApiError, WEB_URL), session (token in the keychain + cached `/me` and active club in the sync store,
              one snapshot for useSession()), club (active club, homeFor, invite links), format (copy of the web's),
              storage (sync kv: native kv-store / web localStorage), secure (token)
  theme/      theme.ts (tokens → RN theme, club roles via @runflow/design/color), ThemeProvider (Runflow's theme,
              color mode) + ThemeScope (re-theme a subtree: a club's colors, forced light/dark)
  ui/         the UI kit: same names/variants as frontend/src/ui (index.ts lists them); icons.ts = Lucide icons, one
              import per icon (add new ones there, never import the lucide-react-native barrel)
  queryClient.ts  TanStack Query; returning to the foreground counts as focus (revalidates `/me` and themes)
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
- Native modules must exist in Expo Go until we move to development builds (X10: push, widgets, health data).
- Accessibility: `accessibilityRole`/`accessibilityState` on touchables, 44 pt touch targets, visible text = accessible name.

# Push notifications on phones (iOS and Android)

How Runflow's phone app gets device push (X10, N1/D-045). Notifications always land in the app's center; device
push is what each person turns on or off per kind (Perfil → Notificações). E-mail is never used for notifications
(D-045): only sign-in codes, account setup and invites.

## How it works

```
API / worker ──▶ Expo push service (exp.host) ──▶ APNs (Apple) ──▶ iPhone
                                              └─▶ FCM (Google) ──▶ Android
```

- The app (Expo, `mobile/`) asks for permission with `expo-notifications`, gets an **Expo push token**
  (`ExponentPushToken[…]`) and registers it: `POST /v1/me/push-tokens {platform: "ios" | "android", token}`.
- The worker sends each pending push to Expo's service (`backend/crates/integrations/src/expo_push.rs`), which
  forwards it to Apple or Google. Tokens of uninstalled apps are forgotten automatically.
- The server needs nothing to start. `EXPO_ACCESS_TOKEN` is only needed if the Expo project turns on "enhanced push
  security" (recommended for production).
- **Apple and Google credentials live in the Expo project (EAS)**, not in our servers. They're needed for real
  builds (TestFlight, Play internal testing, the stores). Expo Go during development uses Expo's own credentials.

App identifiers (`mobile/app.json`): iOS bundle id and Android package **`club.runflow.app`**, scheme `runflow`.

## One-time setup (founder)

### 0. Expo account and project
1. Create an account at expo.dev (an organization `runflow` is handy) and install the CLI: `npm i -g eas-cli`,
   `eas login`.
2. In `mobile/`: `eas init` links the app to an Expo project (writes `extra.eas.projectId` into `app.json`; commit it).
3. *(Production)* Expo dashboard → Project → Credentials → **Enhanced push security** on, then create an access
   token (Account settings → Access tokens) and put it in the server's env as `EXPO_ACCESS_TOKEN`.

### 1. Apple (iOS)
Needs the **Apple Developer Program** (US$ 99/year; as a company you also need a D-U-N-S number, which takes days).
1. developer.apple.com → Certificates, IDs & Profiles → **Identifiers** → register the App ID `club.runflow.app`
   with the **Push Notifications** capability (Associated Domains too, for the invite links).
2. **Keys** → create a key with **Apple Push Notifications service (APNs)** → download the `.p8` (only once) and note
   the Key ID and your Team ID.
3. Give it to EAS: `eas credentials` → iOS → Push Notifications → upload the `.p8` (or let `eas build -p ios` create
   and manage one for you: answer yes when it asks about push).
4. One APNs key serves development and production and every app of the team. Keep the `.p8` in the password manager,
   never in the repo.

### 2. Google (Android)
1. console.firebase.google.com → create a project (e.g. "Runflow") → **Add app → Android**, package
   `club.runflow.app` → download **`google-services.json`**.
2. Put it at `mobile/google-services.json` and set `"android": { "googleServicesFile": "./google-services.json" }` in
   `app.json`. (It identifies the app; it isn't a secret, but keep it out of public repos if you prefer: EAS can
   provide it as a file secret.)
3. Firebase → Project settings → **Service accounts** → generate a private key (JSON) for **FCM HTTP v1**.
4. Give it to EAS: `eas credentials` → Android → **Google Service Account Key for FCM V1** → upload the JSON. Keep the
   JSON in the password manager, never in the repo.

### 3. Check it end to end
1. Build a development client: `eas build -p ios --profile development` / `-p android` (or a TestFlight / internal
   testing build).
2. Sign in, accept the permission prompt, then in the app Perfil → Notificações check that the device shows as on.
3. Trigger something that notifies (e.g. a trainer assigns a workout) and the phone should buzz within seconds.
   Expo's push tool (expo.dev/notifications) can also send a test to an `ExponentPushToken[…]`.
4. If nothing arrives: the worker logs `expo push` results (Grafana → API logs on QA); `DeviceNotRegistered` means the
   token is stale (the app re-registers on launch); credential errors show in the Expo dashboard's push receipts.

## Defaults (D-045)
Quiet for staff on purpose: feedback and new-member pushes start **off** for trainers and owners; workout, week,
comment, message, announcement and billing pushes start on. Everyone can change each kind, or pause all of them, in
Perfil → Notificações; the in-app center always gets everything.

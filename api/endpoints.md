# Runflow API v1: endpoint catalog (contract)

The **contract** between the apps and the backend. `api/mock/server.mjs` implements it against
`api/mock/db.json`. `backend/` (Rust) will implement the same contract on `api/schema.sql`.
Screen IDs (A*, M*, W*, O*, C*) refer to `docs/build-plan.md`.

## Conventions

- **Base path** `/v1`. The web app calls it same-origin as `/api/v1/...` (dev proxy → mock on `:8787`). Mobile calls `https://api.runflow.club/v1`.
- **Auth**: `Authorization: Bearer <token>`, or the HttpOnly `rf_session` cookie that sign-in sets for web clients (same token, §7.3). Apps send `X-Client: mobile` to get a mobile session (no cookie). Sessions last 60 days after their last use and can be revoked. Mock tokens start with `mock_`; in the mock, the e-mail code is always `000000`.
- **JSON** is `snake_case`, identical to the column names in `schema.sql`. Dates are `YYYY-MM-DD` (club-local); timestamps are ISO 8601 UTC.
- **Lists** return `{ "items": [...], "next_cursor": string | null }`. Query: `?cursor=&limit=` (default 50).
- **Errors** are RFC 9457 `application/problem+json`. `title` and `detail` are **pt-BR** for people; `code` is stable English for code (D-013):
  `{ "type": "about:blank", "status": 404, "code": "workout.not_found", "title": "Treino não encontrado", "detail": "Ele pode ter sido removido pelo treinador." }`
  Validation errors add `errors: [{ "field": "name", "message": "Informe o nome do clube." }]`.
- **Authorization**: club routes check the caller's membership. `owner` ⊇ `trainer` (D-017: trainers see all students). Students only reach `/my/*` and their own data.
- **Club context**: club-scoped routes live under `/v1/clubs/{club_id}`. Clubs have no sites or domains of their own (D-042): everyone uses Runflow's app, in the club's colors.

## Workout structure (`structure` jsonb, v1)

```jsonc
{ "v": 1, "blocks": [
  { "kind": "step", "intent": "warmup", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "hr", "zone": 2 } },
  { "kind": "repeat", "count": 6, "steps": [
    { "kind": "step", "intent": "active",   "duration": { "type": "distance", "m": 1000 }, "target": { "type": "pace", "min_s": 265, "max_s": 275 } },
    { "kind": "step", "intent": "recovery", "duration": { "type": "time", "s": 120 },     "target": { "type": "open" }, "note": "trote" } ] },
  { "kind": "step", "intent": "cooldown", "duration": { "type": "time", "s": 600 }, "target": { "type": "zone", "metric": "hr", "zone": 1 } }
] }
```

| Field | Values |
|---|---|
| `intent` | `warmup` `active` `recovery` `rest` `cooldown` `other` |
| `duration` | `{type:"time",s,max_s?}` · `{type:"distance",m,max_m?}` · `{type:"open"}` (lap button). `max_s`/`max_m`: a range the athlete picks by feel ("60–80 m", `max` ≥ the lower amount) |
| `target` | `{type:"open"}` · `{type:"zone",metric:"hr"\|"pace"\|"power",zone:1-5}` · `{type:"pace",min_s,max_s}` (s/km; swim s/100 m) · `{type:"hr",min,max}` · `{type:"power",min,max}` · `{type:"rpe",value:1-10,label?}`: PSE; `label` is the coach's word for it ("forte" → 8), shown as "PSE forte (8)". Intensity words become PSE, never zones (scale: `docs/workout-text.md` § PSE) |
| repeat block | `{kind:"repeat", count:1-200, max_count?, note?, steps}`. `max_count`: "15–20×" (`count` ≤ `max_count` ≤ 200, the athlete picks); `note`: the block's name ("Fartlek", "Bloco do sábado"). Estimates, the intensity profile and Garmin/FIT export use the lower bounds (`count`, `s`, `m`) |
| swim extras (on a step) | `stroke`: `free` `back` `breast` `fly` `im` `choice` `kick` `drill` · `equipment`: [`pullbuoy` `kickboard` `fins` `paddles` `snorkel`] · `send_off_s` |
| strength block | `{kind:"exercise", name, sets, reps:"8-10", load:{type:"kg"\|"pct_1rm"\|"bodyweight"\|"rpe", value}, rest_s, tempo?, note?, exercise_id?}`. Without `exercise_id`, apps match the library by name (case-insensitive) |

Blocks can carry `note`. Free text becomes this structure through one pt-BR grammar (coaching shorthand and plain sentences), shared by the web builder's quick text and `POST /ai/workout` in the mock and the backend; `api/workout-text-examples.json` holds the golden examples every implementation must match (rules: `docs/workout-text.md`). Garmin/FIT export maps from it.

The backend validates every stored structure against these types (unknown extra fields are kept, wrong shapes or out-of-range values → `422`, field `structure`: "Não entendemos a estrutura do treino. Revise as etapas."; no blocks → "Adicione pelo menos uma etapa."). `est_duration_s` / `est_distance_m` come from the app (non-negative integers or null); the mock and the backend estimate `/ai/workout` the same way (a PSE target counts as its zone's pace: 1–2 → Z1, 3–4 → Z2, 5–6 → Z3, 7–8 → Z4, 9–10 → Z5).

## Tags (workout hashtags)

Templates carry `tags: text[]`, shown as `#tag`. Every implementation normalizes on write, so stored tags are always clean:
strip leading `#`, trim, lowercase (pt-BR), whitespace → `-`, keep only letters (accents included), digits, `-` and `_`, collapse repeated `-`, trim `-`, cut at 30 chars; drop empties and duplicates (order kept). **At most 8** per template (`422`, field `tags`, "Use até 8 tags."). Quick text and import lines may carry `#tags` anywhere; the apps pull them out before parsing steps.

## Week release (D-031)

Trainers plan ahead in private and release a week (Monday–Sunday) when it's ready.
- `release_mode`: `immediate` (students see a workout as soon as it's saved) or `weekly` (default for new clubs).
- In `weekly` mode a workout is **visible** to its student when its week has started (club time), when the week was released to everyone, or when it was released to that student. Otherwise it's a **draft**.
- Drafts never reach the student. They are left out of `/my/*` (including the summary) and notifications, and auto-matching skips them. The student's own detail, completion and comment routes answer `404 workout.not_found`.
- **Automatic release.** `auto_release_weekday` (1 = Monday … 7 = Sunday) + `auto_release_time` (`"HH:MM"`, club time) releases the *following* week to everyone. The default is Sunday 18:00; both `null` turns it off. Setting one without the other → `422`.
- **Notifications.** A release sends one `week_released` notification to each newly released student who has workouts that week. Workouts added to a visible week notify as usual (`workout_assigned`).
- **Switching modes.** Going from `immediate` to `weekly` releases every future week that already has workouts, so nothing students saw disappears.

## Strava sharing (D-011)

The Strava connection exists for the student's trainers (Runflow's Strava athlete seats are limited, so a sync nobody can see isn't kept):
- **Connecting requires it.** Only an active student of a club can connect (`409 strava.no_club` otherwise, staff included), and the callback shares Strava with every club where the person is an active student: it grants `share_strava` and, when missing, `share_training_data` (current text version), in the same transaction. The apps show the statement "Compartilhar as atividades do Strava com os treinadores do {club}" checked and can't connect with it unchecked.
- **Stopping per club** is allowed (a warning first; the club's dashboard gets `sharing_off`). A student already connected who joins another club shares Strava with it at the end of that club's welcome.
- **No sync without sharing.** Whenever a change leaves a connected person with no active student membership (in a club that isn't closed) holding both `share_training_data` and `share_strava`, Strava is disconnected exactly like `DELETE /me/connections/strava`: deauthorized at Strava, its activities deleted, the connection and its sharing consents revoked. The changes that can do this: revoking either consent, leaving a club, being suspended or removed by the owner, the club being closed. The apps' warnings say so when it will happen.

## Activity matching (D-049)

Activities are matched to planned workouts by an engine (rules: `docs/activity-matching.md`; golden examples: `api/activity-match-examples.json`) whenever a student's activities or nearby workouts change: imports, webhooks, manual logs and deletes, disconnects, and planning changes up to 2 days ahead. It links each activity to the likeliest visible workout within 2 days (same sport, or both gym sports) by day and size, and creates or completes that workout's completion; when two workouts are about equally likely it asks the student instead.
- `activities.match_state`: `open` (the engine may link it; linked or not), `pending` (waiting for the student; `match_options` lists the choices), `dismissed` (the student said it wasn't a planned workout).
- Activity JSON (`/me/activities`, the trainer's views): `matched_workout` `{id, title, date, club_id, compliance_pct, est_distance_m, est_duration_s, matched_by}` or null, and `match_options` `[{id, title, date, club_id, sport, est_distance_m, est_duration_s}]`. In lists `match_options` is filled only for `pending` activities; the student's activity detail always fills it (the pending choices, else the student's visible workouts of a compatible sport within 3 days, nearest first) for "Trocar treino".
- Completion JSON gains `matched_by` (`auto` = the engine, `student` = chosen by the student, null without an activity) and `reported_at` (when the student sent feedback; null while only matched automatically). A completion made by the engine has the status from compliance (`completed` at ≥ 80%, else `partial`) and no PSE, feeling or comment.
- One activity completes at most one workout. A link the student made is never changed by the engine.
- **Consent (D-011).** The engine links an activity (or offers it as a question) only to workouts of clubs the student shares it with: `share_training_data` for that club and, for a synced activity, that provider too (`share_strava`). The completion route's same-day pick follows the same rule; the student's own choices (`PUT /me/activities/{id}/match`, `activity_id` on the completion) don't, since they're the student's report. Granting or revoking a sharing consent, or leaving a club, matches the last 30 days again, so automatic links follow the consent.

## Notifications (D-045)

Every notification lands in the app: the notification center (W11) and the unread count on the bell (on the app icon too, on phones). What a person controls is only whether it **also arrives as a push** on their devices (the installed web app, S7b; the phone app with X10): one on/off switch per **kind**, plus `paused`, which stops every push until it's switched off again. There are **no notification e-mails** (no instant notices, no daily summary): e-mail is only for what's strictly necessary, i.e. sign-in codes, account setup and invites. Without a saved choice a kind uses its default:

| Kind | Who gets it | Push by default |
|---|---|---|
| `workout_changed` · `week_released` | student | on |
| `workout_assigned` | student | off (the week's release announces it) |
| `comment` · `message` · `announcement` | both | off (Mensagens shows the unread count, § `/me`) |
| `feedback` · `member_joined` | staff | on |

`feedback` is everything a student says about a workout: a report ("Concluir" / "Conte como foi") and a message in a workout's conversation, on any workout date (an upcoming one included). Its link is `/feedback?workout=<id>`, which opens that workout's conversation in the inbox (W8). `comment` is the staff's reply in that conversation, to the student (link `/workouts/<id>`).
| `billing` | owner | on |

Defaults set by the founder on 2026-11-04: students hear about the week's release and changed workouts; staff about feedback, new members and billing.

- The switches are read when the notification is created: it is pushed (`push_at` set, the push queued) only when its kind is on, push isn't paused and the person has a registered device.
- Push reaches every device the person registered (`/me/push-tokens`) right away; one read in the app before it went out is skipped. A device the push service no longer knows is forgotten. The payload is `{title, body, link, id, club_id}` (`club_id` null for account-wide notices: the apps switch to that club before opening `link`).

## Endpoints

### Operations

| Method | Path | What | Screens |
|---|---|---|---|
| GET | `/public/config` | What the web app needs before sign-in: `{google_client_id, strava, push_public_key, sentry}` (`push_public_key`: the VAPID public key for Web Push, base64url, or null when push is off; `sentry`: `{dsn, environment, release}` for the web app's error reports, or null when off) (the web OAuth client id, or null when Google sign-in is off; whether Strava is configured). Mock: `google_client_id`, `push_public_key` and `sentry` null | A2 |
| GET | `/health` | `{ok, version, database: {ok, latency_ms}}`; `503 health.database_unavailable` when the database is down. The mock adds `anchor_date` and `routes` | — |
| GET / POST | `/webhooks/strava` | Strava webhook: GET answers the subscription handshake (`hub.verify_token` = `STRAVA_WEBHOOK_VERIFY_TOKEN`); POST events are recorded once and applied by the worker (activity create/update fetched from Strava, delete, athlete deauthorization = disconnect). Backend only | — |

### Auth and account
| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/auth/email/start` `{email}` | E-mail a 6-digit code, valid 10 min → `{sent, expires_in_s, dev_code?}`. A new code replaces the previous one. Limits: one code per 30 s (`429 auth.code_cooldown`, `Retry-After`) and 5 per hour (`429 auth.too_many_codes`) per address; `503 email.unavailable` if sending fails. `dev_code` only in development with e-mails in the log (mock: always `000000`, no limits) | A2 |
| POST | `/auth/email/verify` `{email, code}` | → `{token, user, is_new}`. Spaces in the code are ignored. `400 auth.code_expired` (none pending), `400 auth.invalid_code`, `429 auth.too_many_attempts` (after 5 tries; ask for a new code) | A2 |
| POST | `/auth/google` `{id_token}` | Google ID token (web: Google Identity Services; mobile: native SDK), verified against Google's keys and our client ids → `{token, user, is_new}`. Accounts match by Google id, then by e-mail (so e-mail and Google sign-in share one account). `400 auth.google_failed`, `503 auth.google_unavailable` (not configured). Mock: `id_token` = an e-mail | A2 |
| POST | `/auth/logout` | Revoke the session and clear the cookie → `204` | shell |
| GET | `/me` | `{user, memberships:[{membership, club, branding, subscription, unread}], prefs, unread_notifications}` (`prefs` as in `/me/prefs`). `unread {messages, announcements}` is what waits in that club's Mensagens: messages from others after the person's last read (a student's own conversation; every active student's conversation for staff, as the list's `unread_count`) and, for students only, announcements they can see and haven't read (staff write the mural). The apps badge Mensagens with the sum, since those kinds don't push by default (§ Notifications). `unread.feedback` (staff; 0 for students) is the inbox's `needs_reply` count (W8, same window and rule); the apps badge Feedbacks with it | all |
| PATCH | `/me` `{name, phone, birth_date, sex, avatar_url}` | Update profile. `avatar_url` only accepts `null` or one of our `/v1/assets/{id}` paths | A4, C1 |
| DELETE | `/me` | Delete account (LGPD; App Store): name/e-mail/phone anonymized, every club left, sessions and provider links revoked, sign-in identities removed (the same e-mail can start over). `409 account.owns_club` | C1 |
| GET | `/me/export` | All my data as JSON (LGPD portability) | C1 |
| GET / PATCH | `/me/prefs` | Push control (§ Notifications): `{kinds: {<kind>: {push}}, paused}`. GET resolves every kind with its default. PATCH takes either part: `kinds` merges per kind (`{"comment": {"push": false}}`); an unknown kind or a `push` that isn't true/false → `422` (field `kinds`), a `paused` that isn't true/false → `422` (field `paused`) | C1 |
| POST | `/me/push-tokens` `{platform, token, keys?}` | Register this device for push (S7b): `web` = the Web Push subscription (`token` its endpoint: https on a browser push service, i.e. FCM, Mozilla, Apple or Windows; `keys` `{p256dh, auth}`, both required), `ios`/`android` = the phone app's Expo push token (`ExponentPushToken[…]`, X10; the worker sends through Expo's push service). A token already registered moves to the caller. `204`; `422` on a bad platform, token or keys | C1 |
| DELETE | `/me/push-tokens` `{token}` | Forget this device (turning push off here, signing out). `204` even when unknown | C1 |
| GET | `/me/consents` · POST `/me/consents` `{club_id?, kind, text_version}` · DELETE `/me/consents/{id}` | Consents (grant / revoke; granting an active one returns it). Revoking `share_training_data` or `share_strava` so that no club can see the Strava sync disconnects Strava (§ Strava sharing) | A4, C1 |
| GET | `/me/notifications?cursor` · POST `/me/notifications/read` `{ids?}` | Notification center, newest first (every notification lands here, D-045). Kinds: `workout_assigned` `workout_changed` `week_released` `comment` `feedback` `member_joined` `billing` `message` `announcement`. `link` is an in-app path; `club_id` tells the app which club to switch to | W11 |
| GET | `/me/sessions` · DELETE `/me/sessions/{id}` · POST `/me/sessions/revoke-others` | Signed-in devices `{id, kind, user_agent, created_at, last_seen_at, current}` | C1 |
| POST / DELETE | `/me/avatar` `{data_url, width, height}` | Upload (PNG/JPG/WebP ≤ 5 MB, no SVG) or remove the profile photo → `/me` payload; `avatar_url` is an `/assets/{id}` path | C1 |

### Providers and activities (user-owned)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/me/connections` | `{items: [{provider, available, connection}]}` (Garmin: `available: false` until the program is approved) | A4, C1 |
| POST | `/me/connections/strava/start` `{client?: web \| app}` | → `{authorize_url, state, redirect_uri}`; Strava sends the person back to `redirect_uri` with `?code&state&scope`: the web app's `{app}/connect/strava`, or for the phone app (`client: app`, Strava's mobile page that opens the Strava app) `runflow://<host of the web app>/connect/strava`, which the app hands to the callback below. Mock: the apps show their own fake consent and call the callback with `mock-code`. `409 strava.no_club` ("Entre em um clube para conectar o Strava") for a person who isn't an active student of any club (§ Strava sharing), `422` on another client, `503 strava.unavailable` when not configured | A4, C1, X5 |
| POST | `/me/connections/strava/callback` `{code, state, scope}` | Finish OAuth (state is signed, per person, 15 min): tokens stored encrypted, Strava shared with every club where the person is an active student (`share_strava` + `share_training_data` when missing, same transaction; § Strava sharing), the last 30 days are imported in the background. `409 strava.no_club` as in start. `400 strava.denied` / `strava.state_invalid` / `strava.scope` (activities not granted), `409 strava.taken` (that Strava account is linked to another person). Mock: imports sample activities | A4, C1 |
| DELETE | `/me/connections/{provider}` | Disconnect and delete that provider's data (§5) | C1 |
| GET | `/me/activities?from&to&cursor&match` | My activities, newest first (`from`/`to` are club-time days); each has `matched_workout`, `match_state` and `match_options` (§ Activity matching). `match=pending`: only the activities waiting for my choice, from the last 7 days (Hoje) | M4, M1 |
| GET | `/me/activities/{id}` | Activity detail with laps, `matched_workout` and `match_options` (always filled, for "Trocar treino") | M4 |
| PUT | `/me/activities/{id}/match` `{planned_workout_id}` | The student says which workout this was (`matched_by: student`, never changed by the engine): any of my visible workouts within 7 days of the activity, else `422` (field `planned_workout_id`). The activity leaves the workout it completed (that completion goes away if it was only automatic), the chosen workout's previous activity is matched again, and the days around are matched again. `null` = none of them: `match_state: dismissed`, unlinked. → the activity detail | M4, M1 |
| POST | `/me/activities` `{sport, name, started_at, duration_s, distance_m?, avg_hr?}` | Log a manual activity; it is matched right away → `201` with the detail | M4 |
| DELETE | `/me/activities/{id}` | Remove a manual activity (synced ones are removed at the source); a workout it completed automatically is open again | M4 |

### Clubs, branding, invites, members
| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/clubs` `{name, city, state, modalities}` | Create club → `{club, membership, branding, subscription}`. Caller becomes owner (free plan); a starter library for the chosen modalities are created | A5 |
| GET / PATCH | `/clubs/{club_id}` | Club settings (name, city, state, timezone, modalities, trainer_label, `release_mode`, `auto_release_weekday`, `auto_release_time`); PATCH is owner-only. Week release fields: § Week release. `timezone` ∈ `America/Noronha` `America/Sao_Paulo` `America/Manaus` `America/Cuiaba` `America/Campo_Grande` `America/Porto_Velho` `America/Boa_Vista` `America/Rio_Branco`. | O3 |
| DELETE | `/clubs/{club_id}` `{confirm_name}` | Close the club (owner): soft delete, subscription canceled, invites revoked. Members lose access; their own activities stay in their accounts, except that a student left with no club seeing their Strava sync is disconnected from Strava (§ Strava sharing) | O3 |
| GET | `/clubs/{club_id}/branding` | `{primary_color, secondary_color, logo_url, theme_rev, theme}` | O1 |
| PUT | `/clubs/{club_id}/branding` `{primary_color?, secondary_color?, logo_asset_id?}` | Owner. Colors as `#RRGGBB`; only a secondary is promoted to primary; `logo_asset_id` absent = keep, `null` = remove, else one of this club's logos. The server runs the color engine (golden fixtures) and stores `theme` + `theme_css`; `theme_rev` bumps on every save | A5, O1 |
| POST | `/clubs/{club_id}/assets` `{data_url, width?, height?}` | Owner: upload a logo (≤ 5 MB; PNG, JPG, WebP, or SVG without scripts/handlers/external refs) → `201 {id, url}`. The declared type must match the file. `415 asset.unsupported`, `413 asset.too_large` | A5, O1 |
| GET | `/assets/{id}` | The image, public: immutable cache, `ETag` (sha256), `Content-Security-Policy: … sandbox`, `nosniff` | all |
| GET | `/public/clubs/{slug}` | Public name + theme (invite pages) | A3 |
| GET | `/public/invites/{token}` | Branded invite page data: `{club, branding, role, valid, reason, invited_by, name, email, email_hint (masked), expires_at, members, already_member, email_matches}`. `email` is the invited address while the invite is valid (the token only reached that mailbox), else null; the sign-in page pre-fills it (reason: `expired` `revoked` `accepted` `club_full`; `email_matches` is null when signed out). Unknown or rotated token → 404 | A3 |
| POST | `/invites/{token}/accept` | Join the club. Only the account whose e-mail is the invited one: otherwise `403 invite.email_mismatch`. Single use (`accepted_at`); joins the invite's groups | A3 |
| GET / POST | `/clubs/{club_id}/invites` `{email, role, name?, group_ids?}` | **Personal invites only (D-023).** POST creates one invite for one e-mail (trainer invites: owner only), valid **7 days**, and e-mails the link through the background worker (development: `/mock/outbox`). `409 invite.exists` (open invite for that e-mail: use resend) or `invite.already_member`. GET lists them with `status: pending \| expired \| accepted` and `url` | A5, O2 |
| POST | `/clubs/{club_id}/invites/{id}/resend` | Send again: new token (the old link stops working), another 7 days | O2 |
| POST | `/clubs/{club_id}/invites/bulk` `{rows: [{name?, email, groups?}]}` | CSV import (≤ 500 rows): one personal invite per e-mail (same rules as POST; an open invite is resent), joining the named groups on accept → `{created, items[] (with url, resent), skipped[] {row, email, reason: invalid_email \| duplicate \| already_member}, over_limit}` | O2 |
| DELETE | `/clubs/{club_id}/invites/{id}` | Cancel (the link stops working) | O2 |
| GET | `/mock/outbox?to` | **Development only** (mock, and the backend with `RUNFLOW_ENV=development` + e-mails in the log): e-mails that would be sent (subject, text, action link), newest first | — |
| GET | `/clubs/{club_id}/members?role&q&status` | Staff. `{membership, user, group_ids}`; owners, then trainers, then students, each by name (accents ignored); `q` matches name or e-mail; default excludes `left`; up to 500 per page (role may be a list: `trainer,owner`) | O2 |
| PATCH / DELETE | `/clubs/{club_id}/members/{membership_id}` | Owner: change `role` / `status` (`active` \| `suspended`) or remove (→ `left`, out of groups). Not yourself (`409 member.self`); reactivating a student over the plan limit → `409 plan.limit_reached`. Suspending or removing a student who is left with no club seeing their Strava sync disconnects their Strava (§ Strava sharing) | O2 |
| GET / POST | `/clubs/{club_id}/groups` · PATCH / DELETE `/groups/{id}` · PUT `/groups/{id}/members` `{membership_ids}` | Groups | W2 |
| POST | `/clubs/{club_id}/leave` | Leave a club: membership → `left`, out of its groups, that club's sharing consents revoked; if no other club then sees the Strava sync, Strava is disconnected (§ Strava sharing). `409 member.last_owner` for the only owner | C1 |

### Athletes (trainer view) and dashboard
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/dashboard?date` | `{date, students, today: {planned, done, items}, week: {planned, done, compliance_pct, duration_s, distance_m}, compliance_trend[8], feedback[] (up to 6, latest activity first: unread conversations with activity in the last 7 days on any workout date, and completion comments of the last 7 days that no staff member answered), alerts[] (missed_streak, high_rpe, no_sync, birthday, new_member, plan_limit, sharing_off; pt-BR text + link; `sharing_off`: the student turned off `share_training_data` or `share_strava` for this club in the last 14 days and it's still off, "Ana Souza parou de compartilhar o Strava" / "…os treinos", training data said first), onboarding{logo, colors, students, workouts, groups, strava}, subscription}` | W1 |
| GET | `/clubs/{club_id}/athletes?q&group_id` | `{membership, user, group_ids, goal, level, compliance_pct (28 d, partial = ½), week: {planned, done}, last_activity_at (only with consent), strava: none\|private\|shared, shares_data}` | W2, W4 |
| GET | `/clubs/{club_id}/athletes/{membership_id}` | Summary + `profile` (with trainer notes), latest `zones` (pace, hr), `consents {training_data, strava}`, `weekly[12] {week_start, planned_s, done_s, distance_m, sessions}`, `recent_activities` (consent-aware), `groups` | W3 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/profile` | Goal, level, physiology, trainer notes | W3 |
| GET / PUT | `/clubs/{club_id}/my/profile` | Student's own profile: goal, goal_note (free text ≤ 120, used for goal `other`), goal_date, level, weekly_sessions (0–14), recent_race, HR (max 100–240, resting 25–120 bpm); a race result estimates the threshold pace (Riegel to 10 km) when none is set. Response adds `zones` (latest pace + HR, set by the trainer; read-only here) | A4, M7 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/zones` `{kind: pace, threshold_pace_s_per_km \| race{distance_m,time_s}}` or `{kind: hr, max_hr}` | Recalculate zones (5 zones; race → threshold via Riegel) | W3, M7 |
| GET | `/clubs/{club_id}/athletes/{membership_id}/activities` | Activities shared by consent | W3 |

### Workouts, library, planilhas
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET / POST | `/clubs/{club_id}/templates?sport&q&tag` | Library. `q` matches name or tag (`#limiar` matches tags only); `tag` filters by one exact tag. Body `tags` is normalized (§ Tags); more than 8 → `422` | W6, W5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/templates/{id}` | Template CRUD (delete = archive) | W5, W6 |
| GET | `/clubs/{club_id}/planned-workouts?from&to&athlete_id&group_id` | Calendar data: rows + `completion` + `comments_count` + `unread_count` (for the caller) + `visible` (the student can see it now, § Week release) | W4, W3 |
| POST | `/clubs/{club_id}/planned-workouts` `{athlete_ids \| group_id, dates[], template_id? \| {sport,title,structure,notes}}` | Assign (bulk). Students are notified (`workout_assigned`) only about workouts they can already see | W4, W5, A5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/planned-workouts/{id}` | GET adds `athlete` and the linked `activity` (only with consent: the student shares training data with the club and, for a synced activity, that provider too, e.g. `share_strava`; else null). PATCH edits or moves (date); the student is notified (`workout_changed`) if they can see it | W4 |
| POST | `/clubs/{club_id}/planned-workouts/copy-week` `{from_monday, to_monday, athlete_ids?}` | Copy a week (all students if no ids) → `{copied}` | W4 |
| GET | `/clubs/{club_id}/weeks/{week_start}` | Release state of a week (staff): `{week_start, release_mode, started, released_at, released_athlete_ids, auto_release_at, drafts}`. `released_at`: released to everyone (else null); `released_athlete_ids`: released to some students only; `auto_release_at`: when it will be released automatically (null if off, released or started); `drafts`: workouts students can't see yet. `week_start` must be a Monday (`400 week.invalid`) | W4 |
| POST | `/clubs/{club_id}/weeks/{week_start}/release` `{athlete_ids? \| group_id?, notify?}` | Release the week (staff): to everyone without ids, or to some students. `notify` (default true): one `week_released` notification per newly released student with workouts that week. → the week state. `409 week.started` (already visible), `409 week.release_off` (club in `immediate` mode) | W4 |
| DELETE | `/clubs/{club_id}/weeks/{week_start}/release` | Undo every release of a week that hasn't started (staff) → the week state. `409 week.started` | W4 |
| GET / POST | `/clubs/{club_id}/plans` · GET / PATCH / DELETE `/plans/{id}` | Planilhas; list items carry `items_count`, `weekly_duration_s[]`, `active_assignments`; GET one adds `items` and `assignments` (athlete, workouts, done) | W7 |
| PUT | `/clubs/{club_id}/plans/{id}/items` `{items}` | Replace the plan grid (week, weekday 1–7, sport, title, structure, est_*, notes, template_id?) | W7 |
| POST | `/clubs/{club_id}/plans/{id}/assign` `{athlete_ids \| group_id, start_date (Monday)}` | Apply → plan_assignments + planned_workouts; students notified when the first week is already visible to them → `{assignments, workouts}` | W7 |
| DELETE | `/clubs/{club_id}/plans/{id}/assignments/{aid}` | Unassign: removes future, not-done workouts → `{removed_workouts}` | W7 |
| GET | `/clubs/{club_id}/my/workouts?from&to` | Student calendar (own, released workouts only) + `unreleased_weeks: [{week_start, auto_release_at}]`: the weeks in the range the trainer hasn't released yet (said whether or not anything is planned) | M1, M3 |
| GET | `/clubs/{club_id}/my/workouts/{id}` | Detail (a draft is `404 workout.not_found`, like the completion and comment routes): zone targets get `resolved` ranges from the student's zones (`{min_s,max_s}` or `{min,max}` bpm); `activity`, `candidate_activities` (±1 day), `coach` | M2 |
| GET | `/clubs/{club_id}/my/summary` | Today: `{shares_data, streak_weeks, week: {planned, done, duration_s, distance_m}, last_activity}` | M1 |
| PUT | `/clubs/{club_id}/my/workouts/{id}/completion` `{status, rpe, feeling, comment, activity_id?}` | Feedback. With `activity_id` (mine): that link is the student's (`matched_by: student`; the activity leaves any other workout). Without it: the workout keeps the activity it has, else gets the likeliest open same-day activity (§ Activity matching). `missed`/`skipped` drop the activity (it's matched again elsewhere). Compliance = actual ÷ planned distance (or moving time). Sets `reported_at`; the trainer is notified the first time the student reports | M5 |
| GET / POST | `/clubs/{club_id}/planned-workouts/{id}/comments` | Thread (student ⇄ trainers); items carry `author {membership_id, role, user}`; GET marks as read; POST notifies the other side | M2, W8 |
| GET | `/clubs/{club_id}/feedback?filter=needs_reply\|unread\|flagged\|all` | Trainer inbox: `{items: [{workout, athlete, last_comment, needs_reply, flagged}], counts: {needs_reply, unread, flagged, all}}`, latest activity first. A workout is in it when, in the last 30 days, its conversation had a message or its completion changed, whatever the workout's date (questions on upcoming workouts included), or when it's dated in the last 30 days; and it has a conversation, a completion comment or a warning sign. Flagged = PSE ≥ 9 or felt bad/awful. `needs_reply`: the last message is the student's (or, with no messages, the completion has a comment) | W8 |
| POST | `/clubs/{club_id}/feedback/read` `{workout_ids?}` | Mark threads as read (all if empty) | W8 |

### Exercise library
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/exercises?q&category` | Club exercises plus Runflow's global catalog (a club exercise shadows a global one with the same name); each has `scope: club \| global`. Members can read (students watch the videos) | W18, W5, M2 |
| POST | `/clubs/{club_id}/exercises` `{name, category, muscles?, equipment?, cues?, video_url?}` | Create (staff). `category`: `strength core mobility stretch plyometrics drill`. `video_url`: YouTube or Vimeo link | W18 |
| PATCH / DELETE | `/clubs/{club_id}/exercises/{id}` | Club exercises only; global ones → `403 exercise.global` (create a club version instead) | W18 |

### Assistant (AI)
Staff only. Responses carry `source`: `rules` (the deterministic rules engine, in the mock and the backend) until an LLM is chosen (root.md §11), then the model name. Limits: `429 ai.rate_limited` at 20 requests a minute per user, rejected ones included (an LLM adds a monthly cap per plan). Provider, model and budget: root.md §11.

| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/clubs/{club_id}/ai/workout` `{text, sport}` | Natural pt-BR description (5 to 2,000 characters, else `422` field `text`) → `{name, sport, structure, est_duration_s, est_distance_m, notes, warnings, tags}`: `warnings` are the pieces that weren't understood (as typed; the rest is applied), `tags` the `#hashtags` (normalized, § Tags). The rules engine parses with the shared free-text grammar (§ Workout structure, golden examples in `api/workout-text-examples.json`). Nothing understood → `422 ai.not_understood` with an example for the sport in `detail` | W5, W17 |
| POST | `/clubs/{club_id}/ai/week-plan` `{membership_id, week_start}` | Suggested week from the profile (goal, level, sessions/week), the last 14 days' compliance and the goal-race date (taper) → `{rationale[], items[] {date, sport, title, structure, est_duration_s, est_distance_m, reason}}`; skips days that already have workouts. Nothing is saved: the app assigns the chosen items | W4, W17 |
| POST | `/clubs/{club_id}/ai/feedback-summary` `{from?, to?, group_id?}` | Period summary of completions, PSE and comments → `{summary[], highlights[] {membership_id, planned_workout_id, kind: pain \| fatigue \| life \| sick \| rpe \| missed, severity, text}}` | W8, W17 |

### Reports
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/reports/training?from&to&group_id` | Period ≤ 1 year (default: last 28 days). `totals`, `weekly[]` (same shape as the dashboard trend) and `athletes[] {planned, done, partial, missed, compliance_pct, planned_s, shares_data, activities, done_s, distance_m}`. Activity volume only for students who share training data (else null), and Strava activities only when Strava is shared with the club too (D-011) | W16 |

Exports are built by the app from these payloads: CSV (`;`-separated, decimal comma, UTF-8 BOM for Excel) and PDF via the print stylesheet.

### Assessments and tests
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/assessments?membership_id&kind` | Staff: assessments, newest first, with `athlete` and the `zones` they created | W14, W3 |
| GET | `/clubs/{club_id}/my/assessments` | Student: own assessments (read-only) | M7 |
| POST | `/clubs/{club_id}/assessments` `{membership_id, kind, date, data, notes?, apply_zones?}` | Record (staff). The server computes `result`. With `apply_zones`, zone-capable tests create zones (source `test`, valid from the test date) and update the profile (threshold pace, CSS, FTP, max HR) | W14 |
| DELETE | `/clubs/{club_id}/assessments/{id}` | Delete (zones it created are kept) | W14 |

Kinds, `data` → `result`: `body {weight_kg, height_cm, body_fat_pct?, waist_cm?, resting_hr?}` → `{bmi}`; `cooper {distance_m}` (12 min) → `{vo2max, threshold_pace_s_per_km}` → pace zones; `run_3k {time_s}` → `{vo2max, threshold_pace_s_per_km}` → pace zones; `css {t400_s, t200_s}` → `{css_s_per_100m}` → swim_pace zones; `ftp {avg_power_w}` (20 min) → `{ftp_w}` (95 %) → power zones; `one_rm {exercise, weight_kg, reps}` → `{one_rm_kg}` (Epley); `hr_max {max_hr}` → HR zones. Formulas: `api/mock/lib/assessments.mjs` (mirrored in the web app for the live preview).

### Messages and announcements
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/conversations?q` | Staff: every active student (`id: null` until the first message), newest conversation first, with `student`, `last_message`, `unread_count`. Student: their single conversation with the club staff (created on first read) | W13, M10 |
| POST | `/clubs/{club_id}/conversations` `{student_membership_id}` | Staff: open (get or create) a student's conversation | W13 |
| GET | `/clubs/{club_id}/conversations/{id}` | Summary + `messages[]` (each with `author {membership_id, role, user}`; deleted ones have an empty body) + `reads[]` of the other participants (`last_read_at`, for "Visto" receipts) | W13, M10 |
| POST | `/clubs/{club_id}/conversations/{id}/messages` `{body}` | Send (≤ 4,000 chars). Student → `message` notification to every staff member; staff → to the student | W13, M10 |
| POST | `/clubs/{club_id}/conversations/{id}/read` | Mark read up to now | W13, M10 |
| DELETE | `/clubs/{club_id}/messages/{id}` | Author deletes a message (shown as "mensagem apagada") | W13, M10 |
| GET | `/clubs/{club_id}/announcements` | Mural, pinned first then newest. Students only see club-wide ones and those for their groups; each has `read_at` (mine). Staff also get `audience_count`, `reads_count` | W13, M10 |
| POST | `/clubs/{club_id}/announcements` `{title, body, group_ids?, pinned?}` | Publish (staff); `announcement` notification to the audience. Empty `group_ids` = whole club | W13 |
| PATCH / DELETE | `/clubs/{club_id}/announcements/{id}` | Edit (sets `edited_at`), pin, retarget / delete | W13 |
| POST | `/clubs/{club_id}/announcements/read` `{ids}` | Mark announcements read | M10 |
| GET | `/clubs/{club_id}/announcements/{id}/reads` | Staff: audience with `read_at` (who read, who didn't) | W13 |

### Races and events
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/races?from&to` | Club race calendar, by date. Each race has `entries_count`, `my_entry`; staff also get `entries[]` with `athlete` | W12, M9, W4 |
| POST | `/clubs/{club_id}/races` `{name, date, distances_m[], sport?, start_time?, city?, state?, url?, notes?}` | Add a race (staff) | W12 |
| GET / PATCH / DELETE | `/clubs/{club_id}/races/{id}` | Detail / edit / remove (archive). Removing a distance with entries → `409 race.distance_in_use` | W12, M9 |
| POST | `/clubs/{club_id}/races/{id}/entries` `{distance_m, goal_time_s?, is_goal?, membership_id?}` | Sign up (student: self; staff: `membership_id`). Upsert | M9, W12 |
| PATCH / DELETE | `/clubs/{club_id}/race-entries/{id}` `{distance_m?, goal_time_s?, is_goal?, status?, result_time_s?, result_position?}` | Edit, record a result, or cancel. `is_goal` makes it the student's single "A race": profile `goal` and `goal_date` follow it. A finished run result becomes the profile's `recent_race` | M9, W12 |

### Billing (Stripe)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/public/plans` | The plan catalog (`api/plans.json`): `{currency, grace_days, plans[] {id, name, price_cents, owners, trainers, students, extra: {trainer_cents, student_cents} \| null}}` | A1, O4 |
| GET | `/clubs/{club_id}/subscription` | `{plan, status, frozen, grace_until, student_limit, active_students, trainer_limit, active_trainers, included_students, included_trainers, monthly_cents, current_period_end, cancel_at_period_end, has_billing_account}`. `*_limit` null = no hard limit (Max charges seats above the included ones); `monthly_cents` = the plan's price plus extra seats. `frozen` and `grace_until`: § Plans. A cancellation scheduled for a past period end is applied on read (the backend does it from the Stripe webhook) | O4, shell |
| POST | `/clubs/{club_id}/subscription/checkout` `{plan: pro \| max}` | → `{checkout_url}` (Stripe Checkout; billing simulation: `/dev/stripe/checkout`). `409 subscription.exists` when already on a paid plan (use `change`), `503 billing.unavailable` when neither Stripe nor the simulation is on, `502 billing.provider_error` when Stripe fails | O4 |
| POST | `/clubs/{club_id}/subscription/change` `{plan: pro \| max}` | Owner, on a paid plan: switch between Pro and Max right away (prorated by Stripe). `409 plan.too_small` when the club has more members than the new plan's hard limits (detail names them), `409 billing.no_subscription` without a paid plan | O4 |
| POST | `/clubs/{club_id}/subscription/portal` | → `{portal_url}` (Stripe Billing Portal; billing simulation: `/dev/stripe/portal`). `409 billing.no_account` before the first checkout | O4 |
| GET | `/clubs/{club_id}/invoices` | Invoices, newest first (owner) | O4 |
| POST | `/webhooks/stripe` · `/webhooks/strava` | Backend only. Stripe events must carry a valid `Stripe-Signature` (`400 webhook.invalid_signature`); each event id is applied once by the worker | — |
| POST | `/mock/stripe/complete` `{club_id, plan}` | **Billing simulation** (the mock; the backend with `BILLING_SIMULATION` and no Stripe key, else `404`): checkout.session.completed → that plan, paid invoice, `billing` notification to the billing owner | O5 |
| POST | `/mock/stripe/portal` `{club_id, action: cancel \| resume \| fail_payment \| freeze \| pay \| expire}` | **Billing simulation**: portal actions and the webhooks they cause (`fail_payment` starts the grace period and notifies the billing owner; `freeze` backdates it so the club is frozen now; `pay` clears it) | O5 |

### Plans (D-043, §4.6)

The catalog is `api/plans.json` (`GET /public/plans`). Every club has exactly **one owner**.

| Plan | Price | Trainers | Students |
|---|---|---|---|
| `free` | R$ 0 | 1 | 10 |
| `pro` | R$ 20/month | 2 | 30 |
| `max` | R$ 59/month | 5 included, then R$ 5/month each | 100 included, then R$ 0,50/month each |

- **Seats count active memberships.** Free and Pro are hard limits: a trainer invite (or making someone a trainer) beyond the trainer seats answers `409 plan.limit_reached`, accepting a student invite when the student seats are full answers `invite.club_full`, and reactivating or switching a member into a full seat answers `409 plan.limit_reached` (detail names the seat and the plan). Nobody is ever removed. On Max nothing blocks; extra seats are billed.
- **One owner.** `role: owner` can't be given to another member (`422`, field `role`).
- **Max seats on Stripe.** With Stripe on, Max subscriptions carry the extra seats as quantities of two prices (extra trainer, extra student); every membership change (invite accepted, role or status change, removal, leaving) makes the worker bring them up to date, prorated. Plan changes swap the subscription's prices right away, prorated.
- **Frozen clubs.** A paid plan whose payment failed stays usable for `grace_days` (7) after `past_due_since` (`grace_until`); after that, or while a club has more members than its plan's hard limits (e.g. a subscription ended), the club is **frozen**. For its staff (owner and trainers) every write answers `423 club.frozen`, except billing (subscription, checkout, change, portal, invoices, the simulation) and closing the club; the apps show the club behind a frozen overlay with one way out: payment (owners) or a note to ask the owner (trainers). **Students never see it**: `frozen` is always `false` for them and their own actions keep working.

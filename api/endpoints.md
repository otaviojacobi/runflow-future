# Runflow API v1: endpoint catalog (contract)

The **contract** between the apps and the backend. `api/mock/server.mjs` implements it against
`api/mock/db.json`. `backend/` (Rust) will implement the same contract on `api/schema.sql`.
Screen IDs (A*, M*, W*, O*, C*) refer to `docs/build-plan.md`.

## Conventions

- **Base path** `/v1`. The web app calls it same-origin as `/api/v1/...` (dev proxy → mock on `:8787`). Mobile calls `https://api.runflow.club/v1`.
- **Auth**: `Authorization: Bearer <token>`. The real web app will use an HttpOnly cookie carrying the same token (§7.3). Mock tokens start with `mock_`; in the mock, the e-mail code is always `000000`.
- **JSON** is `snake_case`, identical to the column names in `schema.sql`. Dates are `YYYY-MM-DD` (club-local); timestamps are ISO 8601 UTC.
- **Lists** return `{ "items": [...], "next_cursor": string | null }`. Query: `?cursor=&limit=` (default 50).
- **Errors** are RFC 9457 `application/problem+json`. `title` and `detail` are **pt-BR** for people; `code` is stable English for code (D-013):
  `{ "type": "about:blank", "status": 404, "code": "workout.not_found", "title": "Treino não encontrado", "detail": "Ele pode ter sido removido pelo treinador." }`
  Validation errors add `errors: [{ "field": "name", "message": "Informe o nome do clube." }]`.
- **Authorization**: club routes check the caller's membership. `owner` ⊇ `trainer` (D-017: trainers see all students). Students only reach `/my/*` and their own data.
- **Club context**: club-scoped routes live under `/v1/clubs/{club_id}`. Subdomains only pick branding and the default club.

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
| `duration` | `{type:"time",s}` · `{type:"distance",m}` · `{type:"open"}` (lap button) |
| `target` | `{type:"open"}` · `{type:"zone",metric:"hr"\|"pace"\|"power",zone:1-5}` · `{type:"pace",min_s,max_s}` (s/km; swim s/100 m) · `{type:"hr",min,max}` · `{type:"power",min,max}` · `{type:"rpe",value:1-10}` |
| swim extras (on a step) | `stroke`: `free` `back` `breast` `fly` `im` `choice` `kick` `drill` · `equipment`: [`pullbuoy` `kickboard` `fins` `paddles` `snorkel`] · `send_off_s` |
| strength block | `{kind:"exercise", name, sets, reps:"8-10", load:{type:"kg"\|"pct_1rm"\|"bodyweight"\|"rpe", value}, rest_s, tempo?, note?}` |

Blocks can carry `note`. The quick-text parser (frontend) produces this structure; Garmin/FIT export maps from it.

## Endpoints

### Auth and account
| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/auth/email/start` `{email}` | Send a 6-digit code (mock: always `000000`) | A2 |
| POST | `/auth/email/verify` `{email, code}` | → `{token, user, is_new}` | A2 |
| POST | `/auth/google` `{id_token}` | → `{token, user, is_new}` (mock: `id_token` = an email) | A2 |
| POST | `/auth/logout` | Revoke the session | shell |
| GET | `/me` | `{user, memberships:[{membership, club, theme, subscription}], prefs, unread_notifications}` | all |
| PATCH | `/me` `{name, phone, birth_date, sex, avatar_url}` | Update profile | A4, C1 |
| DELETE | `/me` | Delete account (LGPD; App Store) | C1 |
| GET | `/me/export` | All my data as JSON (LGPD portability) | C1 |
| GET / PATCH | `/me/prefs` | Notification preferences | C1 |
| GET | `/me/consents` · POST `/me/consents` `{club_id?, kind, text_version}` · DELETE `/me/consents/{id}` | Consents (grant / revoke) | A4, C1 |
| GET | `/me/notifications` · POST `/me/notifications/read` `{ids?}` | Notification center | W11 |

### Providers and activities (user-owned)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/me/connections` | Strava / Garmin connection status | A4, C1 |
| POST | `/me/connections/strava/start` | → `{authorize_url}` (mock: in-app fake consent page) | A4, C1 |
| POST | `/me/connections/strava/callback` `{code}` | Finish OAuth; mock imports sample activities | A4, C1 |
| DELETE | `/me/connections/{provider}` | Disconnect and delete that provider's data (§5) | C1 |
| GET | `/me/activities?from&to&cursor` | My activities | M4 |
| GET | `/me/activities/{id}` | Activity detail with laps | M4 |
| POST | `/me/activities` | Log a manual activity | M4 |

### Clubs, branding, invites, members
| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/clubs` `{name, city, state, modalities}` | Create club → `{club, membership, branding, subscription}`. Caller becomes owner (free plan); a student invite link and a starter library for the chosen modalities are created | A5 |
| GET / PATCH | `/clubs/{club_id}` | Club settings (name, city, timezone, modalities, trainer_label, subdomain) | O3 |
| GET | `/clubs/{club_id}/branding` | `{primary_color, secondary_color, logo_url, theme_rev, theme}` | O1 |
| PUT | `/clubs/{club_id}/branding` `{primary_color?, secondary_color?, logo_asset_id?}` | Save; server derives the theme, bumps `theme_rev` | A5, O1 |
| POST | `/clubs/{club_id}/assets` (multipart or `{data_url, kind, width, height}`) | Upload a logo (≤ 5 MB; PNG, JPG, WebP, SVG) → `{id, url}` | A5, O1 |
| GET | `/assets/{id}` | The image (immutable, cache forever) | all |
| GET | `/public/clubs/{slug}` | Public name + theme (subdomain, invite pages) | A3 |
| GET | `/public/invites/{token}` | `{club, branding, role, valid, reason, invited_by, members, already_member}` (reason: `expired` `revoked` `used_up` `club_full`) | A3 |
| POST | `/invites/{token}/accept` | Join the club → membership | A3 |
| GET / POST | `/clubs/{club_id}/invites` | List / create invite links (role, max_uses, expires_at); each has `url` | A5, O2 |
| DELETE | `/clubs/{club_id}/invites/{id}` | Revoke | O2 |
| GET | `/clubs/{club_id}/members?role&q&status` | Members with role and status | O2 |
| PATCH / DELETE | `/clubs/{club_id}/members/{membership_id}` | Change role or status / remove | O2 |
| GET / POST | `/clubs/{club_id}/groups` · PATCH / DELETE `/groups/{id}` · PUT `/groups/{id}/members` `{membership_ids}` | Groups | W2 |
| POST | `/clubs/{club_id}/leave` | Leave a club | C1 |

### Athletes (trainer view) and dashboard
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/dashboard?date` | Today's counts, who trained or missed, unread feedback, upcoming classes | W1 |
| GET | `/clubs/{club_id}/athletes?q&group_id` | Students + compliance (28 d), last activity, groups, Strava/Garmin status | W2, W4 |
| GET | `/clubs/{club_id}/athletes/{membership_id}` | Profile, zones, stats, recent workouts | W3 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/profile` | Goal, level, physiology, notes | W3, A4 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/zones` `{kind, source, bounds}` | Set zones | W3, M7 |
| GET | `/clubs/{club_id}/athletes/{membership_id}/activities` | Activities shared by consent | W3 |

### Workouts, library, planilhas
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET / POST | `/clubs/{club_id}/templates?sport&q` | Library | W6, W5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/templates/{id}` | Template CRUD (delete = archive) | W5, W6 |
| GET | `/clubs/{club_id}/planned-workouts?from&to&athlete_id&group_id` | Calendar data (with completion + unread count) | W4, W3 |
| POST | `/clubs/{club_id}/planned-workouts` `{athlete_ids \| group_id, dates[], template_id? \| {sport,title,structure,notes}}` | Assign (bulk) | W4, W5, A5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/planned-workouts/{id}` | Edit / move (date) / remove | W4 |
| POST | `/clubs/{club_id}/planned-workouts/copy-week` `{from_monday, to_monday, athlete_ids}` | Copy a week | W4 |
| GET / POST | `/clubs/{club_id}/plans` · GET / PATCH / DELETE `/plans/{id}` | Planilhas | W7 |
| PUT | `/clubs/{club_id}/plans/{id}/items` `{items}` | Replace the plan grid | W7 |
| POST | `/clubs/{club_id}/plans/{id}/assign` `{athlete_ids, start_date}` | Apply → creates planned_workouts | W7 |
| GET | `/clubs/{club_id}/my/workouts?from&to` | Student calendar (own) | M1, M3 |
| GET | `/clubs/{club_id}/my/workouts/{id}` | Detail with personal targets resolved from zones | M2 |
| PUT | `/clubs/{club_id}/my/workouts/{id}/completion` `{status, rpe, feeling, comment, activity_id?}` | Feedback | M5 |
| GET / POST | `/clubs/{club_id}/planned-workouts/{id}/comments` | Thread (student ⇄ trainer); GET marks as read | M2, W8 |
| GET | `/clubs/{club_id}/feedback?filter=unread\|all\|flagged` | Trainer inbox (completions + comments) | W8 |

### Scheduling (aulas)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET / POST | `/clubs/{club_id}/locations` · PATCH / DELETE `/locations/{id}` | Venues | O3, W9 |
| GET / POST | `/clubs/{club_id}/class-types` · PATCH / DELETE `/class-types/{id}` | Class types | W9 |
| GET / POST | `/clubs/{club_id}/class-schedules` · PATCH / DELETE `/class-schedules/{id}` | Recurring rules (materialize sessions 8 weeks ahead) | W9 |
| GET | `/clubs/{club_id}/class-sessions?from&to` | Sessions with booked / waitlist counts and my booking | W9, M6 |
| POST | `/clubs/{club_id}/class-sessions` | One-off session | W9 |
| GET / PATCH | `/clubs/{club_id}/class-sessions/{id}` | Roster / cancel / edit | W9 |
| POST | `/clubs/{club_id}/class-sessions/{id}/bookings` `{membership_id?}` | Book (self, or trainer adds); full → waitlist | M6, W9 |
| DELETE | `/clubs/{club_id}/bookings/{id}` | Cancel (promotes the first in the waitlist) | M6, W9 |
| PATCH | `/clubs/{club_id}/bookings/{id}` `{status: attended \| no_show}` | Attendance | W9 |
| POST | `/clubs/{club_id}/class-sessions/{id}/check-in` `{checkin_code}` | Student QR check-in | M6 |

### Billing (Stripe)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/subscription` | `{plan, status, student_limit, active_students, current_period_end, cancel_at_period_end}` | O4, shell |
| POST | `/clubs/{club_id}/subscription/checkout` `{plan}` | → `{checkout_url}` (Stripe Checkout; mock: in-app fake checkout) | O4 |
| POST | `/clubs/{club_id}/subscription/portal` | → `{portal_url}` (Stripe Billing Portal; mock: in-app page) | O4 |
| GET | `/clubs/{club_id}/invoices` | Invoices | O4 |
| POST | `/webhooks/stripe` · `/webhooks/strava` | Backend only | — |
| POST | `/mock/stripe/complete` `{club_id, plan}` | **Mock only**: what the Stripe webhook would do | O5 |

**Plans** (D-016, §4.6): `free` = 10 active students; `pro` = 100 students, R$ 20/month, subdomain; `max` = TBD (not sold yet).
Hitting the limit blocks new joins (`invite.club_full`) and never removes existing students.

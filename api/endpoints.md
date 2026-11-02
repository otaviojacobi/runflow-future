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
| GET | `/me/notifications?cursor` · POST `/me/notifications/read` `{ids?}` | Notification center, newest first. Kinds: `workout_assigned` `workout_changed` `comment` `feedback` `class_reminder` (booked class in the next 12 h) `class_cancelled` `waitlist_promoted` `member_joined` `billing` `message` `announcement`. `link` is an in-app path; `club_id` tells the app which club to switch to | W11 |
| GET | `/me/sessions` · DELETE `/me/sessions/{id}` · POST `/me/sessions/revoke-others` | Signed-in devices `{id, kind, user_agent, created_at, last_seen_at, current}` | C1 |
| POST / DELETE | `/me/avatar` `{data_url, width, height}` | Upload (PNG/JPG/WebP ≤ 5 MB) or remove the profile photo → `/me` payload; `avatar_url` is an `/assets/{id}` path | C1 |

### Providers and activities (user-owned)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/me/connections` | `{items: [{provider, available, connection}]}` (Garmin: `available: false` until the program is approved) | A4, C1 |
| POST | `/me/connections/strava/start` | → `{authorize_url}` (mock: in-app fake consent page) | A4, C1 |
| POST | `/me/connections/strava/callback` `{code}` | Finish OAuth; mock imports sample activities | A4, C1 |
| DELETE | `/me/connections/{provider}` | Disconnect and delete that provider's data (§5) | C1 |
| GET | `/me/activities?from&to&cursor` | My activities, newest first; each has `matched_workout` (id, title, date, compliance) or null | M4 |
| GET | `/me/activities/{id}` | Activity detail with laps + `matched_workout` | M4 |
| POST | `/me/activities` `{sport, name, started_at, duration_s, distance_m?, avg_hr?}` | Log a manual activity | M4 |
| DELETE | `/me/activities/{id}` | Remove a manual activity (synced ones are removed at the source) | M4 |

### Clubs, branding, invites, members
| Method | Path | Purpose | Screens |
|---|---|---|---|
| POST | `/clubs` `{name, city, state, modalities}` | Create club → `{club, membership, branding, subscription}`. Caller becomes owner (free plan); a student invite link and a starter library for the chosen modalities are created | A5 |
| GET / PATCH | `/clubs/{club_id}` | Club settings (name, city, timezone, modalities, trainer_label, subdomain) | O3 |
| DELETE | `/clubs/{club_id}` `{confirm_name}` | Close the club (owner): soft delete, subscription canceled, invites revoked, subdomain released. Members lose access; their own activities stay in their accounts | O3 |
| GET | `/clubs/{club_id}/branding` | `{primary_color, secondary_color, logo_url, theme_rev, theme}` | O1 |
| PUT | `/clubs/{club_id}/branding` `{primary_color?, secondary_color?, logo_asset_id?}` | Save; server derives the theme, bumps `theme_rev` | A5, O1 |
| POST | `/clubs/{club_id}/assets` (multipart or `{data_url, kind, width, height}`) | Upload a logo (≤ 5 MB; PNG, JPG, WebP, SVG) → `{id, url}` | A5, O1 |
| GET | `/assets/{id}` | The image (immutable, cache forever) | all |
| GET | `/public/clubs/{slug}` | Public name + theme (subdomain, invite pages) | A3 |
| GET | `/public/invites/{token}` | `{club, branding, role, valid, reason, invited_by, members, already_member}` (reason: `expired` `revoked` `used_up` `club_full`) | A3 |
| POST | `/invites/{token}/accept` | Join the club → membership | A3 |
| GET / POST | `/clubs/{club_id}/invites` | List / create invite links (role, max_uses, expires_at); each has `url` | A5, O2 |
| DELETE | `/clubs/{club_id}/invites/{id}` | Revoke | O2 |
| GET | `/clubs/{club_id}/members?role&q&status` | `{membership, user, group_ids}` (role may be a list: `trainer,owner`) | O2 |
| PATCH / DELETE | `/clubs/{club_id}/members/{membership_id}` | Change role or status / remove | O2 |
| GET / POST | `/clubs/{club_id}/groups` · PATCH / DELETE `/groups/{id}` · PUT `/groups/{id}/members` `{membership_ids}` | Groups | W2 |
| POST | `/clubs/{club_id}/leave` | Leave a club: membership → `left`, that club's sharing consents revoked, open bookings cancelled. `409 member.last_owner` for the only owner | C1 |

### Athletes (trainer view) and dashboard
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/dashboard?date` | `{date, students, today: {planned, done, items}, week: {planned, done, compliance_pct, duration_s, distance_m}, compliance_trend[8], feedback[], alerts[] (missed_streak, high_rpe, no_sync, birthday, new_member, plan_limit; pt-BR text + link), upcoming_classes[], onboarding{logo, colors, students, workouts, groups, strava}, subscription}` | W1 |
| GET | `/clubs/{club_id}/athletes?q&group_id` | `{membership, user, group_ids, goal, level, compliance_pct (28 d, partial = ½), week: {planned, done}, last_activity_at (only with consent), strava: none\|private\|shared, shares_data}` | W2, W4 |
| GET | `/clubs/{club_id}/athletes/{membership_id}` | Summary + `profile` (with trainer notes), latest `zones` (pace, hr), `consents {training_data, strava}`, `weekly[12] {week_start, planned_s, done_s, distance_m, sessions}`, `recent_activities` (consent-aware), `groups` | W3 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/profile` | Goal, level, physiology, trainer notes | W3 |
| GET / PUT | `/clubs/{club_id}/my/profile` | Student's own profile: goal, goal_date, level, weekly_sessions, recent_race, HR (a race result estimates the threshold pace). Response adds `zones` (latest pace + HR, set by the trainer; read-only here) | A4, M7 |
| PUT | `/clubs/{club_id}/athletes/{membership_id}/zones` `{kind: pace, threshold_pace_s_per_km \| race{distance_m,time_s}}` or `{kind: hr, max_hr}` | Recalculate zones (5 zones; race → threshold via Riegel) | W3, M7 |
| GET | `/clubs/{club_id}/athletes/{membership_id}/activities` | Activities shared by consent | W3 |

### Workouts, library, planilhas
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET / POST | `/clubs/{club_id}/templates?sport&q` | Library | W6, W5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/templates/{id}` | Template CRUD (delete = archive) | W5, W6 |
| GET | `/clubs/{club_id}/planned-workouts?from&to&athlete_id&group_id` | Calendar data: rows + `completion` + `comments_count` + `unread_count` (for the caller) | W4, W3 |
| POST | `/clubs/{club_id}/planned-workouts` `{athlete_ids \| group_id, dates[], template_id? \| {sport,title,structure,notes}}` | Assign (bulk) | W4, W5, A5 |
| GET / PATCH / DELETE | `/clubs/{club_id}/planned-workouts/{id}` | GET adds `athlete` and the linked `activity` (only with consent). PATCH edits or moves (date); the student is notified | W4 |
| POST | `/clubs/{club_id}/planned-workouts/copy-week` `{from_monday, to_monday, athlete_ids?}` | Copy a week (all students if no ids) → `{copied}` | W4 |
| GET / POST | `/clubs/{club_id}/plans` · GET / PATCH / DELETE `/plans/{id}` | Planilhas; list items carry `items_count`, `weekly_duration_s[]`, `active_assignments`; GET one adds `items` and `assignments` (athlete, workouts, done) | W7 |
| PUT | `/clubs/{club_id}/plans/{id}/items` `{items}` | Replace the plan grid (week, weekday 1–7, sport, title, structure, est_*, notes, template_id?) | W7 |
| POST | `/clubs/{club_id}/plans/{id}/assign` `{athlete_ids \| group_id, start_date (Monday)}` | Apply → plan_assignments + planned_workouts; students notified → `{assignments, workouts}` | W7 |
| DELETE | `/clubs/{club_id}/plans/{id}/assignments/{aid}` | Unassign: removes future, not-done workouts → `{removed_workouts}` | W7 |
| GET | `/clubs/{club_id}/my/workouts?from&to` | Student calendar (own) | M1, M3 |
| GET | `/clubs/{club_id}/my/workouts/{id}` | Detail: zone targets get `resolved` ranges from the student's zones (`{min_s,max_s}` or `{min,max}` bpm); `activity`, `candidate_activities` (±1 day), `coach` | M2 |
| GET | `/clubs/{club_id}/my/summary` | Today: `{shares_data, streak_weeks, week: {planned, done, duration_s, distance_m}, last_activity, next_class}` | M1 |
| PUT | `/clubs/{club_id}/my/workouts/{id}/completion` `{status, rpe, feeling, comment, activity_id?}` | Feedback. Without `activity_id`, a same-day activity of the same sport is matched; compliance = actual ÷ planned distance (or time); the trainer is notified | M5 |
| GET / POST | `/clubs/{club_id}/planned-workouts/{id}/comments` | Thread (student ⇄ trainers); items carry `author {membership_id, role, user}`; GET marks as read; POST notifies the other side | M2, W8 |
| GET | `/clubs/{club_id}/feedback?filter=needs_reply\|unread\|flagged\|all` | Trainer inbox, last 30 days: `{items: [{workout, athlete, last_comment, needs_reply, flagged}], counts: {needs_reply, unread, flagged, all}}`. Flagged = PSE ≥ 9 or felt bad/awful | W8 |
| POST | `/clubs/{club_id}/feedback/read` `{workout_ids?}` | Mark threads as read (all if empty) | W8 |

### Scheduling (aulas)
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET / POST | `/clubs/{club_id}/locations` · PATCH / DELETE `/locations/{id}` | Venues (kind: track, pool, gym, park, studio, other) | O3, W9 |
| GET / POST | `/clubs/{club_id}/class-types` · PATCH / DELETE `/class-types/{id}` | Class types (sport, default capacity, duration) | W9 |
| GET / POST | `/clubs/{club_id}/class-schedules` `{class_type_id, weekdays[], start_time, duration_min?, capacity?, location_id?, instructor_membership_id?, valid_from?}` | Recurring rules; POST creates one per weekday and materializes 8 weeks → `{items, sessions}` | W9 |
| DELETE | `/clubs/{club_id}/class-schedules/{id}` | End a rule: future sessions cancelled, booked students notified | W9 |
| GET | `/clubs/{club_id}/class-sessions?from&to` | Sessions with `class_type`, `location`, `instructor`, `booked`, `waitlist`, `my_booking` | W9, M6 |
| POST | `/clubs/{club_id}/class-sessions` `{class_type_id, date, time, …}` | One-off session | W9 |
| GET / PATCH | `/clubs/{club_id}/class-sessions/{id}` | Staff GET adds `roster` + `checkin_code`; PATCH `{status: cancelled, reason?}` notifies; `{capacity}` promotes the waitlist | W9 |
| POST | `/clubs/{club_id}/class-sessions/{id}/bookings` `{membership_id?}` | Book (self, or staff adds); full → waitlisted with position | M6, W9 |
| DELETE | `/clubs/{club_id}/bookings/{id}` | Cancel; the first in the waitlist is promoted and notified | M6, W9 |
| PATCH | `/clubs/{club_id}/bookings/{id}` `{status: attended \| no_show \| booked}` | Attendance (staff) | W9 |
| POST | `/clubs/{club_id}/class-sessions/{id}/check-in` `{checkin_code}` | Student check-in (45 min before → end); creates a booking if there is room | M6 |

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

### Challenges, rankings and badges
| Method | Path | Purpose | Screens |
|---|---|---|---|
| GET | `/clubs/{club_id}/challenges` | Active, then upcoming, then finished. Students only see club-wide ones and those for their groups. Each has `status` (`upcoming` `active` `finished`), `participants_count`, `joined`, `my_progress {rank, value, pct}` | W15, M11 |
| POST | `/clubs/{club_id}/challenges` `{name, metric, starts_on, ends_on, description?, sport?, goal?, group_ids?}` | Create (staff). `metric`: `distance` (km) `duration` (h) `sessions` `elevation` (m); `sport` null = any; `goal` null = ranking only | W15 |
| GET / PATCH / DELETE | `/clubs/{club_id}/challenges/{id}` | GET adds `leaderboard[] {rank, membership_id, user, value, pct}` (participants only). DELETE archives | W15, M11 |
| POST / DELETE | `/clubs/{club_id}/challenges/{id}/join` | Join / leave (student). Joining = showing your progress on that leaderboard | M11 |
| GET | `/clubs/{club_id}/rankings?month=YYYY-MM&sport` | Monthly distance ranking of opted-in students (`items[] {rank, user, value km}`, `me {opted_in, rank}`) | M11, W15 |
| PUT | `/clubs/{club_id}/my/ranking` `{opted_in}` | Opt in / out of the monthly ranking | M11 |
| GET | `/clubs/{club_id}/my/badges` | `{items[] {key, kind, title, earned_at}, streak_weeks}`. Badges are awarded on read in the mock (nightly job in the backend): streaks of 4/8/12/26 weeks, 100 km running in a month, a challenge goal reached, a race finished | M11, M1 |

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
| GET | `/clubs/{club_id}/subscription` | `{plan, status, student_limit, active_students, current_period_end, cancel_at_period_end, has_billing_account}`. A cancellation scheduled for a past period end is applied on read (the backend does it from the Stripe webhook) | O4, shell |
| POST | `/clubs/{club_id}/subscription/checkout` `{plan: pro}` | → `{checkout_url}` (Stripe Checkout; mock: `/dev/stripe/checkout`). `409 subscription.exists` when already on Pro, `409 plan.unavailable` for Max | O4 |
| POST | `/clubs/{club_id}/subscription/portal` | → `{portal_url}` (Stripe Billing Portal; mock: `/dev/stripe/portal`). `409 billing.no_account` before the first checkout | O4 |
| GET | `/clubs/{club_id}/invoices` | Invoices, newest first (owner) | O4 |
| POST | `/webhooks/stripe` · `/webhooks/strava` | Backend only | — |
| POST | `/mock/stripe/complete` `{club_id, plan}` | **Mock only**: checkout.session.completed → Pro, paid invoice, `billing` notification to the billing owner | O5 |
| POST | `/mock/stripe/portal` `{club_id, action: cancel \| resume \| fail_payment \| pay \| expire}` | **Mock only**: portal actions and the webhooks they cause | O5 |

**Plans** (D-016, §4.6): `free` = 10 active students; `pro` = 100 students, R$ 20/month, subdomain; `max` = TBD (not sold yet).
Hitting the limit blocks new joins (`invite.club_full`) and never removes existing students.

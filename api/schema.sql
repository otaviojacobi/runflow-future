-- Runflow database schema (PostgreSQL 16+). CONTRACT: the mock (api/mock/db.json) uses exactly
-- these tables and columns, and backend/ migrations will start from this file.
-- Conventions: ids are uuid (backend generates UUIDv7; the mock uses readable string ids);
-- enums are text + CHECK (cheap to evolve); timestamps are timestamptz in UTC; a workout's
-- calendar day is a local `date` in the club's timezone; money is integer centavos;
-- distances in meters, durations in seconds, paces in seconds per km (swim: per 100 m).

-- =========================================================================== identity
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  avatar_url    text,
  phone         text,
  birth_date    date,
  sex           text CHECK (sex IN ('female', 'male', 'other')),
  locale        text NOT NULL DEFAULT 'pt-BR',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE auth_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('google', 'apple', 'email')),
  subject     text NOT NULL,             -- OIDC `sub`, or the lowercased email for 'email'
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE email_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  code_hash    bytea NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_email_idx ON email_codes (lower(email), created_at DESC);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,   -- sha256 of the opaque token; the token itself is never stored
  kind          text NOT NULL CHECK (kind IN ('web', 'mobile')),
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- =========================================================================== assets
CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES users (id),
  club_id        uuid,                   -- FK added after clubs
  kind           text NOT NULL CHECK (kind IN ('logo', 'avatar', 'activity_file')),
  storage_key    text NOT NULL UNIQUE,
  content_type   text NOT NULL,
  bytes          int NOT NULL,
  width          int,
  height         int,
  sha256         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================== clubs
CREATE TABLE clubs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name           text NOT NULL,
  city           text,
  state          char(2),
  timezone       text NOT NULL DEFAULT 'America/Sao_Paulo',
  modalities     text[] NOT NULL DEFAULT '{run}',   -- subset of: run swim bike strength mobility other
  trainer_label  text NOT NULL DEFAULT 'treinador' CHECK (trainer_label IN ('treinador', 'professor')),
  subdomain      text UNIQUE,                       -- Pro: <subdomain>.runflow.club
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
ALTER TABLE assets ADD CONSTRAINT assets_club_fk FOREIGN KEY (club_id) REFERENCES clubs (id);

-- Club Studio (D-014, D-019): inputs + the theme derived at save time.
CREATE TABLE club_branding (
  club_id          uuid PRIMARY KEY REFERENCES clubs (id) ON DELETE CASCADE,
  primary_color    char(7) CHECK (primary_color ~ '^#[0-9A-F]{6}$'),
  secondary_color  char(7) CHECK (secondary_color ~ '^#[0-9A-F]{6}$'),
  logo_asset_id    uuid REFERENCES assets (id),
  theme_rev        int NOT NULL DEFAULT 1,
  engine_version   int NOT NULL DEFAULT 1,
  theme            jsonb NOT NULL,       -- { primary, secondary, source, roles: { light, dark } }
  theme_css        text NOT NULL,        -- ready-to-inline CSS (clubThemeCss output)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (secondary_color IS NULL OR primary_color IS NOT NULL)
);

CREATE TABLE memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('owner', 'trainer', 'student')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  is_billing_owner  boolean NOT NULL DEFAULT false,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  left_at           timestamptz,
  UNIQUE (club_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX memberships_club_role_idx ON memberships (club_id, role) WHERE status = 'active';

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('trainer', 'student')),
  token        text NOT NULL UNIQUE,     -- url-safe random, shared via WhatsApp / QR / link
  email        text,                     -- optional: personal invite
  created_by   uuid NOT NULL REFERENCES memberships (id),
  max_uses     int,                      -- NULL = unlimited (club link)
  uses         int NOT NULL DEFAULT 0,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, name)
);

CREATE TABLE group_members (
  group_id       uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, membership_id)
);

-- LGPD: explicit, versioned, revocable (§4.5, §5).
CREATE TABLE consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  club_id        uuid REFERENCES clubs (id) ON DELETE CASCADE,  -- NULL for platform-level (terms, privacy)
  kind           text NOT NULL CHECK (kind IN ('terms', 'privacy', 'share_training_data', 'share_strava', 'share_garmin')),
  text_version   text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);
CREATE INDEX consents_user_idx ON consents (user_id, club_id, kind);

-- =========================================================================== athletes
-- The club's view of a student (per membership): goal, physiology, zones.
CREATE TABLE athlete_profiles (
  membership_id           uuid PRIMARY KEY REFERENCES memberships (id) ON DELETE CASCADE,
  goal                    text CHECK (goal IN ('health', '5k', '10k', '21k', '42k', 'trail', 'triathlon', 'swim', 'strength', 'other')),
  goal_date               date,
  level                   text CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  weekly_sessions         int CHECK (weekly_sessions BETWEEN 0 AND 14),
  max_hr                  int,
  resting_hr              int,
  threshold_pace_s_per_km int,
  css_s_per_100m          int,           -- swim critical speed
  ftp_w                   int,
  recent_race             jsonb,         -- { distance_m, time_s, date }
  trainer_notes           text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('hr', 'pace', 'swim_pace', 'power')),
  source         text NOT NULL CHECK (source IN ('test', 'race', 'manual', 'estimated')),
  bounds         jsonb NOT NULL,         -- [{ zone: 1, min, max }, …] in bpm | s/km | s/100m | W
  valid_from     date NOT NULL,
  created_by     uuid REFERENCES memberships (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_member_idx ON zones (membership_id, kind, valid_from DESC);

-- =========================================================================== workouts
-- `structure` (jsonb) is the typed, versioned workout tree (see api/endpoints.md § Workout structure).
CREATE TABLE workout_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  author_membership_id  uuid NOT NULL REFERENCES memberships (id),
  sport                 text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  name                  text NOT NULL,
  description           text,
  structure             jsonb NOT NULL,
  est_duration_s        int,
  est_distance_m        int,
  tags                  text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);
CREATE INDEX workout_templates_club_idx ON workout_templates (club_id, sport) WHERE archived_at IS NULL;

-- Planilhas: reusable multi-week plans.
CREATE TABLE training_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  author_membership_id  uuid NOT NULL REFERENCES memberships (id),
  name                  text NOT NULL,
  description           text,
  weeks                 int NOT NULL CHECK (weeks BETWEEN 1 AND 52),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);

CREATE TABLE training_plan_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES training_plans (id) ON DELETE CASCADE,
  week            int NOT NULL CHECK (week >= 1),
  weekday         int NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- ISO: 1 = Monday
  template_id     uuid REFERENCES workout_templates (id) ON DELETE SET NULL,
  sport           text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  title           text NOT NULL,
  structure       jsonb NOT NULL,        -- snapshot, editable without touching the template
  est_duration_s  int,
  est_distance_m  int,
  notes           text
);
CREATE INDEX training_plan_items_plan_idx ON training_plan_items (plan_id, week, weekday);

CREATE TABLE plan_assignments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                uuid NOT NULL REFERENCES training_plans (id),
  athlete_membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  start_date             date NOT NULL,  -- a Monday
  created_by             uuid NOT NULL REFERENCES memberships (id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE planned_workouts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  athlete_membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  date                   date NOT NULL,
  position               int NOT NULL DEFAULT 0,          -- order within the day
  sport                  text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  title                  text NOT NULL,
  structure              jsonb NOT NULL,
  notes                  text,                            -- trainer → student
  est_duration_s         int,
  est_distance_m         int,
  template_id            uuid REFERENCES workout_templates (id) ON DELETE SET NULL,
  plan_assignment_id     uuid REFERENCES plan_assignments (id) ON DELETE SET NULL,
  created_by             uuid NOT NULL REFERENCES memberships (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planned_workouts_athlete_date_idx ON planned_workouts (athlete_membership_id, date);
CREATE INDEX planned_workouts_club_date_idx ON planned_workouts (club_id, date);

-- Synced or logged sessions. Belong to the USER (not a club): visibility per club follows consents.
CREATE TABLE activities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source              text NOT NULL CHECK (source IN ('strava', 'garmin', 'manual', 'file')),
  external_id         text,
  sport               text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  name                text NOT NULL,
  started_at          timestamptz NOT NULL,
  duration_s          int NOT NULL,
  moving_time_s       int,
  distance_m          int,
  elevation_gain_m    int,
  avg_hr              int,
  max_hr              int,
  avg_pace_s_per_km   int,
  avg_power_w         int,
  calories            int,
  laps                jsonb,             -- [{ distance_m, duration_s, avg_hr, avg_pace_s_per_km }]
  polyline            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX activities_user_started_idx ON activities (user_id, started_at DESC);

CREATE TABLE workout_completions (
  planned_workout_id  uuid PRIMARY KEY REFERENCES planned_workouts (id) ON DELETE CASCADE,
  activity_id         uuid REFERENCES activities (id) ON DELETE SET NULL,
  status              text NOT NULL CHECK (status IN ('completed', 'partial', 'missed', 'skipped')),
  compliance_pct      int CHECK (compliance_pct BETWEEN 0 AND 200),
  rpe                 int CHECK (rpe BETWEEN 1 AND 10),
  feeling             text CHECK (feeling IN ('great', 'good', 'ok', 'bad', 'awful')),
  comment             text,
  completed_at        timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_workout_id    uuid NOT NULL REFERENCES planned_workouts (id) ON DELETE CASCADE,
  author_membership_id  uuid NOT NULL REFERENCES memberships (id),
  body                  text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  edited_at             timestamptz,
  deleted_at            timestamptz
);
CREATE INDEX comments_workout_idx ON comments (planned_workout_id, created_at);

-- Unread tracking for the feedback inbox (per reader, per workout thread).
CREATE TABLE thread_reads (
  membership_id       uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  planned_workout_id  uuid NOT NULL REFERENCES planned_workouts (id) ON DELETE CASCADE,
  last_read_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, planned_workout_id)
);

-- =========================================================================== providers
CREATE TABLE provider_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider           text NOT NULL CHECK (provider IN ('strava', 'garmin')),
  external_user_id   text NOT NULL,
  athlete_name       text,
  access_token_enc   bytea,
  refresh_token_enc  bytea,
  scopes             text[] NOT NULL DEFAULT '{}',
  token_expires_at   timestamptz,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_sync_at       timestamptz,
  UNIQUE (user_id, provider),
  UNIQUE (provider, external_user_id)
);

CREATE TABLE webhook_events (
  id            bigserial PRIMARY KEY,
  provider      text NOT NULL CHECK (provider IN ('strava', 'garmin', 'stripe')),
  external_id   text,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text,
  UNIQUE (provider, external_id)
);

-- =========================================================================== scheduling (aulas)
CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('track', 'pool', 'gym', 'park', 'studio', 'other')),
  address     text,
  lanes       int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE class_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name              text NOT NULL,
  sport             text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  description       text,
  default_capacity  int NOT NULL CHECK (default_capacity > 0),
  duration_min      int NOT NULL CHECK (duration_min > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);

-- Recurring rule ("toda terça e quinta 06:30") that materializes class_sessions.
CREATE TABLE class_schedules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                    uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  class_type_id              uuid NOT NULL REFERENCES class_types (id),
  location_id                uuid REFERENCES locations (id),
  instructor_membership_id   uuid REFERENCES memberships (id),
  weekday                    int NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time                 time NOT NULL,           -- club-local
  duration_min               int NOT NULL,
  capacity                   int NOT NULL,
  valid_from                 date NOT NULL,
  valid_until                date,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE class_sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                   uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  class_type_id             uuid NOT NULL REFERENCES class_types (id),
  schedule_id               uuid REFERENCES class_schedules (id) ON DELETE SET NULL,
  location_id               uuid REFERENCES locations (id),
  instructor_membership_id  uuid REFERENCES memberships (id),
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  capacity                  int NOT NULL,
  status                    text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  notes                     text,
  checkin_code              text NOT NULL,           -- shown as QR at the venue
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX class_sessions_club_time_idx ON class_sessions (club_id, starts_at);

CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES class_sessions (id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show')),
  waitlist_position int,
  checked_in_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, membership_id)
);

-- =========================================================================== races and events (F21)
-- The club's race calendar. Students sign up for a distance; an entry marked is_goal is their "A race":
-- it sets the profile goal and goal_date, which planning and plans use for periodization.
CREATE TABLE races (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name         text NOT NULL,
  sport        text NOT NULL DEFAULT 'run' CHECK (sport IN ('run', 'trail', 'swim', 'bike', 'triathlon', 'other')),
  date         date NOT NULL,
  start_time   time,                               -- club-local
  city         text,
  state        char(2),
  url          text,
  distances_m  int[] NOT NULL CHECK (cardinality(distances_m) > 0),
  notes        text,
  created_by   uuid REFERENCES memberships (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE INDEX races_club_date_idx ON races (club_id, date);
CREATE TABLE race_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id          uuid NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  membership_id    uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  distance_m       int NOT NULL CHECK (distance_m > 0),
  goal_time_s      int CHECK (goal_time_s > 0),
  is_goal          boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'finished', 'dns', 'dnf')),
  result_time_s    int CHECK (result_time_s > 0),
  result_position  int CHECK (result_position > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id, membership_id),
  CHECK (status <> 'finished' OR result_time_s IS NOT NULL)
);

-- =========================================================================== billing (Stripe, D-016)
CREATE TABLE club_subscriptions (
  club_id                 uuid PRIMARY KEY REFERENCES clubs (id) ON DELETE CASCADE,
  plan                    text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'max')),
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  student_limit           int NOT NULL DEFAULT 10,
  stripe_customer_id      text UNIQUE,
  stripe_subscription_id  text UNIQUE,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  stripe_invoice_id  text UNIQUE,
  amount_cents       int NOT NULL,
  currency           char(3) NOT NULL DEFAULT 'BRL',
  status             text NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  hosted_url         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================== notifications
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('workout_assigned', 'workout_changed', 'comment', 'feedback', 'class_reminder', 'class_cancelled', 'waitlist_promoted', 'member_joined', 'billing')),
  title       text NOT NULL,             -- pt-BR, rendered at creation time
  body        text,
  link        text,                      -- in-app path, e.g. /treinos/<id>
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_prefs (
  user_id         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  push_workouts   boolean NOT NULL DEFAULT true,
  push_comments   boolean NOT NULL DEFAULT true,
  push_classes    boolean NOT NULL DEFAULT true,
  email_weekly    boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token         text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================== ops
CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  club_id        uuid REFERENCES clubs (id) ON DELETE SET NULL,
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  action         text NOT NULL,          -- e.g. 'member.removed', 'branding.updated'
  target_type    text,
  target_id      uuid,
  data           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  run_at      timestamptz NOT NULL DEFAULT now(),
  attempts    int NOT NULL DEFAULT 0,
  locked_at   timestamptz,
  locked_by   text,
  last_error  text,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE done_at IS NULL;

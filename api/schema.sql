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
  deleted_at     timestamptz,
  -- Week release (D-031): 'immediate' = students see a workout as soon as it's saved; 'weekly' = future weeks stay
  -- drafts until released by hand or automatically at auto_release_weekday (ISO 1 = Monday … 7 = Sunday) +
  -- auto_release_time, club time, for the week that follows. Both NULL = no automatic release.
  release_mode          text NOT NULL DEFAULT 'weekly' CHECK (release_mode IN ('immediate', 'weekly')),
  auto_release_weekday  smallint DEFAULT 7 CHECK (auto_release_weekday BETWEEN 1 AND 7),
  auto_release_time     time DEFAULT '18:00',
  CHECK ((auto_release_weekday IS NULL) = (auto_release_time IS NULL))
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

-- Personal invites (D-023): one per e-mail, sent by e-mail, valid for 7 days, single use, and only the account
-- with that e-mail can accept. There are no club-wide or reusable links.
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('trainer', 'student')),
  email        text NOT NULL CHECK (email = lower(email)),
  name         text,                              -- how the inviter called them (greeting in the e-mail)
  token        text NOT NULL UNIQUE,              -- url-safe random; rotated on resend
  group_ids    uuid[] NOT NULL DEFAULT '{}',      -- groups to join on accept
  created_by   uuid NOT NULL REFERENCES memberships (id),
  expires_at   timestamptz NOT NULL,
  sent_at      timestamptz,
  send_count   int NOT NULL DEFAULT 0,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_one_open_per_email ON invitations (club_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

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
  goal_note               text,          -- the student's own words, e.g. for goal 'other' (≤ 120 chars)
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
-- Exercise library (F28). club_id null = Runflow's global catalog; a club exercise with the same name
-- shadows the global one (that is how a club adds its own video). Strength blocks may carry exercise_id.
CREATE TABLE exercises (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid REFERENCES clubs (id) ON DELETE CASCADE,
  name         text NOT NULL,
  category     text NOT NULL CHECK (category IN ('strength', 'core', 'mobility', 'stretch', 'plyometrics', 'drill')),
  muscles      text[] NOT NULL DEFAULT '{}',
  equipment    text[] NOT NULL DEFAULT '{}',
  cues         text,                         -- pt-BR coaching cues
  video_url    text,                         -- YouTube or Vimeo link (embedded privacy-enhanced)
  created_by   uuid REFERENCES memberships (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE INDEX exercises_club_idx ON exercises (club_id, name);

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
CREATE INDEX workout_templates_tags_idx ON workout_templates USING gin (tags) WHERE archived_at IS NULL; -- ?tag= filter, normalized #hashtags

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

-- Week release (D-031): a week (Monday) released to the club's students. athlete_membership_id NULL = everyone;
-- released_by NULL = the automatic release.
CREATE TABLE week_releases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  week_start             date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  athlete_membership_id  uuid REFERENCES memberships (id) ON DELETE CASCADE,
  released_by            uuid REFERENCES memberships (id) ON DELETE SET NULL,
  released_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (club_id, week_start, athlete_membership_id)
);

-- May the athlete see a workout planned for p_day yet (D-031)? Weeks start on Monday; a week that has started in
-- the club's time zone is always visible. Every student-facing read goes through this.
CREATE FUNCTION workout_released(p_club uuid, p_athlete uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT c.release_mode = 'immediate'
      OR date_trunc('week', p_day::timestamp)::date <= date_trunc('week', now() AT TIME ZONE c.timezone)::date
      OR EXISTS (SELECT 1 FROM week_releases r
                  WHERE r.club_id = c.id AND r.week_start = date_trunc('week', p_day::timestamp)::date
                    AND (r.athlete_membership_id IS NULL OR r.athlete_membership_id = p_athlete))
    FROM clubs c WHERE c.id = p_club
$$;

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

-- =========================================================================== assessments and tests (F23)
-- Physical assessments and field tests. `data` holds the raw inputs per kind and `result` the derived values
-- (see endpoints.md). A test can create new zones (zones_id) and update the athlete profile.
CREATE TABLE assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('body', 'cooper', 'run_3k', 'css', 'ftp', 'one_rm', 'hr_max')),
  date           date NOT NULL,
  data           jsonb NOT NULL,
  result         jsonb NOT NULL DEFAULT '{}',
  notes          text,
  zones_id       uuid REFERENCES zones (id) ON DELETE SET NULL,
  created_by     uuid REFERENCES memberships (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessments_athlete_idx ON assessments (membership_id, kind, date DESC);

-- =========================================================================== messages and announcements (F22)
-- One direct conversation per student and club, shared by all of the club's staff (D-017: trainers see all
-- students). Announcements (the "mural") go to the whole club or to some groups. Both have read receipts.
CREATE TABLE conversations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  student_membership_id  uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  last_message_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, student_membership_id)
);
CREATE TABLE messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  author_membership_id  uuid NOT NULL REFERENCES memberships (id),
  body                  text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE TABLE conversation_reads (
  conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  membership_id    uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, membership_id)
);
-- JSON as the apps see it (shared by the API's queries): a person, and a message with its author.
CREATE FUNCTION user_json(u users) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'avatar_url', u.avatar_url, 'phone', u.phone,
                            'birth_date', u.birth_date, 'sex', u.sex, 'locale', u.locale, 'created_at', u.created_at)
$$;
CREATE FUNCTION message_json(x messages) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', x.id, 'conversation_id', x.conversation_id, 'author_membership_id', x.author_membership_id,
                            'body', CASE WHEN x.deleted_at IS NULL THEN x.body ELSE '' END,
                            'created_at', x.created_at, 'deleted_at', x.deleted_at,
                            'author', jsonb_build_object('membership_id', m.id, 'role', m.role, 'user', user_json(u)))
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = x.author_membership_id
$$;

CREATE TABLE announcements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  author_membership_id  uuid NOT NULL REFERENCES memberships (id),
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body                  text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  group_ids             uuid[] NOT NULL DEFAULT '{}',   -- empty = the whole club
  pinned                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  edited_at             timestamptz,
  deleted_at            timestamptz
);
CREATE INDEX announcements_club_idx ON announcements (club_id, created_at DESC);
CREATE TABLE announcement_reads (
  announcement_id  uuid NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  membership_id    uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  read_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, membership_id)
);
-- Active students an announcement reaches: its groups' members, or the whole club when it names no group.
CREATE FUNCTION announcement_audience(a announcements) RETURNS TABLE (id uuid)
LANGUAGE sql STABLE AS $$
  SELECT m.id FROM memberships m
   WHERE m.club_id = a.club_id AND m.role = 'student' AND m.status = 'active'
     AND (cardinality(a.group_ids) = 0
          OR EXISTS (SELECT 1 FROM group_members g WHERE g.membership_id = m.id AND g.group_id = ANY(a.group_ids)))
$$;

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
  kind        text NOT NULL CHECK (kind IN ('workout_assigned', 'workout_changed', 'comment', 'feedback', 'member_joined', 'billing', 'message', 'announcement', 'week_released')),
  title       text NOT NULL,             -- pt-BR, rendered at creation time
  body        text,
  link        text,                      -- in-app path, e.g. /treinos/<id>
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Delivery per the recipient's preferences at creation (D-032): shown in the app's center or not, and the
  -- e-mail it still owes ('instant' or 'digest', then 'sent').
  in_app      boolean NOT NULL DEFAULT true,
  email       text NOT NULL DEFAULT 'none' CHECK (email IN ('none', 'instant', 'digest', 'sent')),
  -- Push to the person's devices (S7b): when it goes out (quiet hours delay it; null = no push) and when it did.
  push_at     timestamptz,
  pushed_at   timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_email_idx ON notifications (email) WHERE email IN ('instant', 'digest');

-- Personal calendar feed (F29): a secret URL per user, served as text/calendar (planned workouts, booked
-- classes, races). Only the token's hash is stored; regenerating revokes the old URL.
CREATE TABLE calendar_feeds (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Notification control (D-032). `kinds` overrides the defaults per kind (endpoints.md § Notifications):
-- {"<kind>": {"app": bool, "push": bool, "email": "off" | "instant" | "digest"}}. Quiet hours (club-agnostic,
-- São Paulo time) hold push; `paused` holds push and e-mail. `last_digest_on` = the day the last summary went out.
CREATE TABLE notification_prefs (
  user_id         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  kinds           jsonb NOT NULL DEFAULT '{}',
  digest_hour     smallint NOT NULL DEFAULT 7 CHECK (digest_hour BETWEEN 0 AND 23),
  quiet_start     time DEFAULT '22:00',
  quiet_end       time DEFAULT '07:00',
  paused          boolean NOT NULL DEFAULT false,
  last_digest_on  date,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Staff: feedback and comment notices only about students in these groups (empty = everyone), per club (D-032).
CREATE TABLE notification_group_filters (
  membership_id  uuid PRIMARY KEY REFERENCES memberships (id) ON DELETE CASCADE,
  group_ids      uuid[] NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- A device that receives push: web = a Web Push subscription (`token` is its endpoint URL, `keys` its p256dh and
-- auth), ios/android = an Expo push token (X10).
CREATE TABLE push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token         text NOT NULL UNIQUE,
  keys          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

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

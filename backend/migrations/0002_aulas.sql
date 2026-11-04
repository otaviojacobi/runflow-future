-- 0002: aulas (2026-11-04)
-- Keep api/schema.sql equal to all migrations together (db/tests/contract.rs).

-- Aulas (class scheduling) come back (D-052): venues, class types, recurring schedules, sessions and bookings, plus
-- two notification kinds for a student's own booking news. Additive only: new tables, and the notifications kind
-- check swapped for one that also allows the new kinds (same name and order as api/schema.sql).

-- Shown in the apps to clubs with Funcional, Musculação or Natação (the API answers every club). Staff set up venues
-- and class types, publish recurring weekly schedules (club-local weekday + time) and one-off sessions; sessions exist
-- for a rolling 8-week window (the API creates them when a schedule is saved and a daily job extends the window).
-- Students book a seat, join the waitlist when it's full (promoted in order when a seat frees up), cancel until the
-- class starts, and check in with the session's code (shown as a QR at the venue) from 45 minutes before the start to
-- the end; staff mark attendance.
CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind        text NOT NULL CHECK (kind IN ('track', 'pool', 'gym', 'park', 'studio', 'other')),
  address     text,
  lanes       int CHECK (lanes > 0),                -- pools
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX locations_club_idx ON locations (club_id);

CREATE TABLE class_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  sport             text NOT NULL CHECK (sport IN ('run', 'swim', 'bike', 'strength', 'mobility', 'other')),
  description       text,
  default_capacity  int NOT NULL CHECK (default_capacity > 0),
  duration_min      int NOT NULL CHECK (duration_min > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);
CREATE INDEX class_types_club_idx ON class_types (club_id);

-- One weekday + time per row (the API creates one per chosen weekday). valid_until ends a rule.
CREATE TABLE class_schedules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                    uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  class_type_id              uuid NOT NULL REFERENCES class_types (id),
  location_id                uuid REFERENCES locations (id),
  instructor_membership_id   uuid REFERENCES memberships (id),
  weekday                    int NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- 1 = Monday … 7 = Sunday
  start_time                 time NOT NULL,                                   -- club-local
  duration_min               int NOT NULL CHECK (duration_min > 0),
  capacity                   int NOT NULL CHECK (capacity > 0),
  valid_from                 date NOT NULL,
  valid_until                date,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX class_schedules_club_idx ON class_schedules (club_id);

CREATE TABLE class_sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                   uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  class_type_id             uuid NOT NULL REFERENCES class_types (id),
  schedule_id               uuid REFERENCES class_schedules (id) ON DELETE SET NULL,   -- null = one-off
  location_id               uuid REFERENCES locations (id),
  instructor_membership_id  uuid REFERENCES memberships (id),
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  capacity                  int NOT NULL CHECK (capacity > 0),
  status                    text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancel_reason             text,
  notes                     text,
  checkin_code              text NOT NULL,          -- 6 characters, shown as a QR at the venue
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX class_sessions_club_time_idx ON class_sessions (club_id, starts_at);
-- A schedule has at most one session per start: expanding the window again creates nothing twice.
CREATE UNIQUE INDEX class_sessions_schedule_start_idx ON class_sessions (schedule_id, starts_at) WHERE schedule_id IS NOT NULL;

-- A seat (or a place in the waitlist) in a session. One row per person and session: cancelling and booking again
-- reuses it.
CREATE TABLE class_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES class_sessions (id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show')),
  waitlist_position int CHECK (waitlist_position > 0),   -- only while waitlisted
  checked_in_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, membership_id)
);
CREATE INDEX class_bookings_membership_idx ON class_bookings (membership_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('workout_assigned', 'workout_changed', 'comment', 'feedback', 'member_joined', 'billing', 'message', 'announcement', 'week_released', 'class_cancelled', 'waitlist_promoted'));

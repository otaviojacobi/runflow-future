-- Week release (D-031): clubs plan ahead in private and release a week to their students.
ALTER TABLE clubs
  ADD COLUMN release_mode text NOT NULL DEFAULT 'weekly' CHECK (release_mode IN ('immediate', 'weekly')),
  ADD COLUMN auto_release_weekday smallint DEFAULT 7 CHECK (auto_release_weekday BETWEEN 1 AND 7),
  ADD COLUMN auto_release_time time DEFAULT '18:00',
  ADD CHECK ((auto_release_weekday IS NULL) = (auto_release_time IS NULL));

CREATE TABLE week_releases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                uuid NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  week_start             date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  athlete_membership_id  uuid REFERENCES memberships (id) ON DELETE CASCADE,
  released_by            uuid REFERENCES memberships (id) ON DELETE SET NULL,
  released_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (club_id, week_start, athlete_membership_id)
);

CREATE FUNCTION workout_released(p_club uuid, p_athlete uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT c.release_mode = 'immediate'
      OR date_trunc('week', p_day::timestamp)::date <= date_trunc('week', now() AT TIME ZONE c.timezone)::date
      OR EXISTS (SELECT 1 FROM week_releases r
                  WHERE r.club_id = c.id AND r.week_start = date_trunc('week', p_day::timestamp)::date
                    AND (r.athlete_membership_id IS NULL OR r.athlete_membership_id = p_athlete))
    FROM clubs c WHERE c.id = p_club
$$;

-- Clubs that existed before keep showing their students what they already saw.
INSERT INTO week_releases (club_id, week_start)
SELECT DISTINCT club_id, date_trunc('week', date::timestamp)::date FROM planned_workouts WHERE date > current_date;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('workout_assigned', 'workout_changed', 'comment', 'feedback', 'class_reminder', 'class_cancelled', 'waitlist_promoted', 'member_joined', 'billing', 'message', 'announcement', 'week_released'));

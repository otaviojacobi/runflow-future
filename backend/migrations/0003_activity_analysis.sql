-- 0003: activity_analysis (2026-11-05)
-- Keep api/schema.sql equal to all migrations together (db/tests/contract.rs).

-- The completed-training analysis (D-055): what Strava's detailed activity already carries, kept instead of dropped,
-- plus its time series. Additive only: two columns on activities, one new table, and the notifications kind check
-- swapped for one that also allows `activity_synced` (same name and order as api/schema.sql).

-- Per-km splits as Strava computes them (`splits_metric`): the default view of a run, even without device laps.
-- [{ n, distance_m, duration_s (moving), elapsed_s, avg_pace_s_per_km, avg_hr, elevation_diff_m }]
ALTER TABLE activities ADD COLUMN splits jsonb;
-- The full-resolution route (Strava's detailed `map.polyline`, Google's encoded polyline format); `polyline` stays
-- the summary one that list views can afford. Kept for the map; the apps draw it without a map provider for now.
ALTER TABLE activities ADD COLUMN route_polyline text;

-- An activity's time series, sampled down to at most 600 points (enough for a heart-rate chart and a route), one row
-- per activity, read only by the detail views. data: { time: [s], distance: [m], heartrate: [bpm] | null,
-- altitude: [m] | null, velocity: [m/s] | null, latlng: [[lat, lng]] | null, original_size }
CREATE TABLE activity_streams (
  activity_id  uuid PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('workout_assigned', 'workout_changed', 'comment', 'feedback', 'member_joined', 'billing', 'message', 'announcement', 'week_released', 'class_cancelled', 'waitlist_promoted', 'activity_synced'));

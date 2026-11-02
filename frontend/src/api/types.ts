/**
 * API types: mirror api/schema.sql rows and api/endpoints.md responses (snake_case, as on the wire).
 * Add types here when a screen starts using an endpoint; keep them identical to the contract.
 */
export type ID = string;
export type ISODate = string; // "YYYY-MM-DD" club-local
export type ISOTime = string; // ISO 8601 UTC timestamp
export type Role = "owner" | "trainer" | "student";
export type Sport = "run" | "swim" | "bike" | "strength" | "mobility" | "other";
export type Plan = "free" | "pro" | "max";

export interface Page<T> { items: T[]; next_cursor: string | null }

export interface User {
  id: ID; email: string; name: string; avatar_url: string | null; phone: string | null;
  birth_date: ISODate | null; sex: "female" | "male" | "other" | null; locale: string; created_at: ISOTime;
}
export interface Club {
  id: ID; slug: string; name: string; city: string | null; state: string | null; timezone: string;
  modalities: Sport[]; trainer_label: "treinador" | "professor"; subdomain: string | null; created_at: ISOTime;
}
export interface Membership {
  id: ID; club_id: ID; user_id: ID; role: Role; status: "active" | "suspended" | "left";
  is_billing_owner: boolean; joined_at: ISOTime; left_at: ISOTime | null;
}
export interface Branding {
  primary_color: string | null; secondary_color: string | null; logo_url: string | null; theme_rev: number;
  theme: { primary: string; secondary: string; source: "default" | "derived" | "club" };
  theme_css: string;
}
export interface Subscription {
  plan: Plan; status: "active" | "trialing" | "past_due" | "canceled"; student_limit: number; active_students: number;
  current_period_end: ISOTime | null; cancel_at_period_end: boolean;
}
export interface MembershipContext { membership: Membership; club: Club; branding: Branding | null; subscription: Subscription | null }
export interface NotificationPrefs { user_id: ID; push_workouts: boolean; push_comments: boolean; push_classes: boolean; email_weekly: boolean }
export interface Me { user: User; memberships: MembershipContext[]; prefs: NotificationPrefs | null; unread_notifications: number }
export interface AuthResult { token: string; user: User; is_new: boolean }

export interface Invitation {
  id: ID; club_id: ID; role: "trainer" | "student"; token: string; email: string | null; created_by: ID;
  max_uses: number | null; uses: number; expires_at: ISOTime | null; revoked_at: ISOTime | null; created_at: ISOTime; url: string;
}
export interface PublicInvite {
  club: Pick<Club, "id" | "slug" | "name" | "city" | "state" | "modalities" | "trainer_label">; branding: Branding | null;
  role: "trainer" | "student"; valid: boolean; reason: "expired" | "revoked" | "used_up" | "club_full" | null;
  invited_by: string | null; members: number; already_member: boolean;
}
export interface WorkoutTemplate {
  id: ID; club_id: ID; author_membership_id: ID; sport: Sport; name: string; description: string | null;
  structure: import("@/domain/workout").Structure; est_duration_s: number | null; est_distance_m: number | null; tags: string[];
  created_at: ISOTime; updated_at: ISOTime; archived_at: ISOTime | null;
}

export type Goal = "health" | "5k" | "10k" | "21k" | "42k" | "trail" | "triathlon" | "swim" | "strength" | "other";
export type Level = "beginner" | "intermediate" | "advanced";
export interface AthleteProfile {
  membership_id: ID; goal: Goal | null; goal_date: ISODate | null; level: Level | null; weekly_sessions: number | null;
  max_hr: number | null; resting_hr: number | null; threshold_pace_s_per_km: number | null; css_s_per_100m: number | null; ftp_w: number | null;
  recent_race: { distance_m: number; time_s: number; date?: ISODate } | null; trainer_notes?: string | null; updated_at: ISOTime;
}
export interface Connection { id: ID; provider: "strava" | "garmin"; athlete_name: string | null; status: "active" | "error" | "revoked"; connected_at: ISOTime; last_sync_at: ISOTime | null }
export interface ProviderStatus { provider: "strava" | "garmin"; available: boolean; connection: Connection | null }
export type ConsentKind = "terms" | "privacy" | "share_training_data" | "share_strava" | "share_garmin";
export interface Consent { id: ID; user_id: ID; club_id: ID | null; kind: ConsentKind; text_version: string; granted_at: ISOTime; revoked_at: ISOTime | null }

export interface Member { membership: Membership; user: User; group_ids: ID[] }
export interface Group { id: ID; club_id: ID; name: string; description: string | null; created_at: ISOTime; member_ids: ID[] }
export interface AthleteSummary {
  membership: Membership; user: User; group_ids: ID[]; goal: Goal | null; level: Level | null;
  compliance_pct: number | null; week: { planned: number; done: number }; last_activity_at: ISOTime | null;
  strava: "none" | "private" | "shared"; shares_data: boolean;
}

export type CompletionStatus = "completed" | "partial" | "missed" | "skipped";
export type Feeling = "great" | "good" | "ok" | "bad" | "awful";
export interface Completion {
  planned_workout_id: ID; activity_id: ID | null; status: CompletionStatus; compliance_pct: number | null;
  rpe: number | null; feeling: Feeling | null; comment: string | null; completed_at: ISOTime; updated_at: ISOTime;
}
export interface PlannedWorkout {
  id: ID; club_id: ID; athlete_membership_id: ID; date: ISODate; position: number; sport: Sport; title: string;
  structure: import("@/domain/workout").Structure; notes: string | null; est_duration_s: number | null; est_distance_m: number | null;
  template_id: ID | null; plan_assignment_id: ID | null; created_by: ID; created_at: ISOTime; updated_at: ISOTime;
  completion: Completion | null; comments_count: number; unread_count: number;
}
export interface Activity {
  id: ID; user_id: ID; source: "strava" | "garmin" | "manual" | "file"; external_id: string | null; sport: Sport; name: string;
  started_at: ISOTime; duration_s: number; moving_time_s: number | null; distance_m: number | null; elevation_gain_m: number | null;
  avg_hr: number | null; max_hr: number | null; avg_pace_s_per_km: number | null; avg_power_w: number | null; calories: number | null;
  laps: { distance_m: number; duration_s: number; avg_hr: number | null; avg_pace_s_per_km?: number }[] | null; polyline: string | null; created_at: ISOTime;
}
export interface PlannedWorkoutDetail extends PlannedWorkout { athlete: { membership_id: ID; user: User }; activity: Activity | null }

export interface Comment { id: ID; planned_workout_id: ID; author_membership_id: ID; body: string; created_at: ISOTime; edited_at: ISOTime | null; author: { membership_id: ID; role: Role; user: User } }
export interface MyWorkoutDetail extends PlannedWorkout { activity: Activity | null; candidate_activities: Activity[]; coach: User | null }
export interface MySummary {
  shares_data: boolean; streak_weeks: number; week: { planned: number; done: number; duration_s: number; distance_m: number };
  last_activity: Activity | null;
  next_class: { booking: { id: ID; status: string; waitlist_position: number | null }; session: { id: ID; starts_at: ISOTime; ends_at: ISOTime }; class_type: { name: string; sport: Sport }; location: { name: string } | null } | null;
}

export interface AthleteRef { membership_id: ID; user: User }
export interface Dashboard {
  date: ISODate; students: number;
  today: { planned: number; done: number; items: { workout: PlannedWorkout; athlete: AthleteRef }[] };
  week: { planned: number; done: number; compliance_pct: number | null; duration_s: number; distance_m: number };
  compliance_trend: { week_start: ISODate; pct: number | null; planned: number; done: number; current: boolean }[];
  feedback: { workout: PlannedWorkout; athlete: AthleteRef; last_comment: Omit<Comment, "author"> | null }[];
  alerts: { kind: "missed_streak" | "high_rpe" | "no_sync" | "birthday" | "new_member" | "plan_limit"; severity: "danger" | "warning" | "info" | "accent" | "brand"; athlete: AthleteRef | null; text: string; link: string }[];
  upcoming_classes: { session: { id: ID; starts_at: ISOTime }; class_type: { name: string; sport: Sport }; booked: number; waitlist: number }[];
  onboarding: { logo: boolean; colors: boolean; students: boolean; workouts: boolean; groups: boolean; strava: boolean };
  subscription: Subscription;
}

export interface MatchedWorkout { id: ID; title: string; date: ISODate; club_id: ID; compliance_pct: number | null; est_distance_m: number | null; est_duration_s: number | null }
export interface ActivityItem extends Activity { matched_workout: MatchedWorkout | null }
export interface Zone { id: ID; membership_id: ID; kind: "hr" | "pace" | "swim_pace" | "power"; source: "test" | "race" | "manual" | "estimated"; bounds: { zone: number; min: number; max: number }[]; valid_from: ISODate; created_at: ISOTime }
export interface AthleteDetail extends AthleteSummary {
  profile: AthleteProfile; zones: Zone[]; consents: { training_data: boolean; strava: boolean };
  weekly: { week_start: ISODate; current: boolean; planned_s: number; done_s: number; distance_m: number; sessions: number }[];
  recent_activities: ActivityItem[]; groups: { id: ID; name: string }[];
}

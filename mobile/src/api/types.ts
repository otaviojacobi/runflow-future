/**
 * API types: mirror api/schema.sql rows and api/endpoints.md responses (snake_case, as on the wire), the same as the
 * web app's src/api/types.ts. Add types here when a screen starts using an endpoint; keep them identical to the contract.
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
  modalities: Sport[]; trainer_label: "treinador" | "professor"; created_at: ISOTime;
  release_mode: "immediate" | "weekly"; auto_release_weekday: number | null; auto_release_time: string | null;
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
/** The club's plan (D-043): seats per role, the monthly price and whether it's frozen for the caller (never for students). */
export interface Subscription {
  plan: Plan; status: "active" | "trialing" | "past_due" | "canceled"; frozen: boolean; grace_until: ISOTime | null;
  /** null = no hard limit (Max bills the seats above the included ones). */
  student_limit: number | null; active_students: number; trainer_limit: number | null; active_trainers: number;
  included_students: number; included_trainers: number; monthly_cents: number;
  current_period_end: ISOTime | null; cancel_at_period_end: boolean; has_billing_account?: boolean;
}
export interface MembershipContext { membership: Membership; club: Club; branding: Branding | null; subscription: Subscription | null }
/** Push control (D-045): every notification lands in the app; per kind, push to the person's devices on or off, and
 * `paused` stops every push. */
export interface KindPref { push: boolean }
export interface NotificationPrefs { kinds: Record<NotificationKind, KindPref>; paused: boolean }
export type PrefsPatch = { kinds?: Partial<Record<NotificationKind, KindPref>>; paused?: boolean };
export interface Me { user: User; memberships: MembershipContext[]; prefs: NotificationPrefs | null; unread_notifications: number }
export type NotificationKind = "workout_assigned" | "workout_changed" | "week_released" | "comment" | "feedback" | "member_joined" | "billing" | "message" | "announcement";
export interface AppNotification { id: ID; user_id: ID; club_id: ID | null; kind: NotificationKind; title: string; body: string | null; link: string | null; read_at: ISOTime | null; created_at: ISOTime }
export interface UserSession { id: ID; kind: "web" | "mobile"; user_agent: string | null; created_at: ISOTime; last_seen_at: ISOTime; current: boolean }
export interface AuthResult { token: string; user: User; is_new: boolean }

/** Personal invite page data (D-023): GET /public/invites/{token}. */
export interface PublicInvite {
  club: Pick<Club, "id" | "slug" | "name" | "city" | "state" | "modalities" | "trainer_label">; branding: Branding | null;
  role: "trainer" | "student"; valid: boolean; reason: "expired" | "revoked" | "accepted" | "club_full" | null;
  invited_by: string | null; name: string | null; email: string | null; email_hint: string; expires_at: ISOTime; members: number; already_member: boolean;
  /** null when signed out */
  email_matches: boolean | null;
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
  /** The student can see it now; false = a draft (D-031). Always true under /my/*. */
  visible: boolean;
}
export interface Activity {
  id: ID; user_id: ID; source: "strava" | "garmin" | "manual" | "file"; external_id: string | null; sport: Sport; name: string;
  started_at: ISOTime; duration_s: number; moving_time_s: number | null; distance_m: number | null; elevation_gain_m: number | null;
  avg_hr: number | null; max_hr: number | null; avg_pace_s_per_km: number | null; avg_power_w: number | null; calories: number | null;
  laps: { distance_m: number; duration_s: number; avg_hr: number | null; avg_pace_s_per_km?: number }[] | null; polyline: string | null; created_at: ISOTime;
}
export interface Comment { id: ID; planned_workout_id: ID; author_membership_id: ID; body: string; created_at: ISOTime; edited_at: ISOTime | null; author: { membership_id: ID; role: Role; user: User } }

export type Goal = "health" | "5k" | "10k" | "21k" | "42k" | "trail" | "triathlon" | "swim" | "strength" | "other";
export type Level = "beginner" | "intermediate" | "advanced";
export interface AthleteProfile {
  membership_id: ID; goal: Goal | null; goal_note: string | null; goal_date: ISODate | null; level: Level | null; weekly_sessions: number | null;
  max_hr: number | null; resting_hr: number | null; threshold_pace_s_per_km: number | null; css_s_per_100m: number | null; ftp_w: number | null;
  recent_race: { distance_m: number; time_s: number; date?: ISODate } | null; trainer_notes?: string | null; updated_at: ISOTime;
  /** Only on the student's own profile (GET /my/profile): latest pace + HR zones, read-only. */
  zones?: Zone[];
}
export interface Connection { id: ID; provider: "strava" | "garmin"; athlete_name: string | null; status: "active" | "error" | "revoked"; connected_at: ISOTime; last_sync_at: ISOTime | null }
export interface ProviderStatus { provider: "strava" | "garmin"; available: boolean; connection: Connection | null }
export type ConsentKind = "terms" | "privacy" | "share_training_data" | "share_strava" | "share_garmin";
export interface Consent { id: ID; user_id: ID; club_id: ID | null; kind: ConsentKind; text_version: string; granted_at: ISOTime; revoked_at: ISOTime | null }
export interface Zone { id: ID; membership_id: ID; kind: "hr" | "pace" | "swim_pace" | "power"; source: "test" | "race" | "manual" | "estimated"; bounds: { zone: number; min: number; max: number }[]; valid_from: ISODate; created_at: ISOTime }

/** Assessments and tests (api/endpoints.md § Assessments): `data` in, `result` computed by the server. */
export type AssessmentKind = "body" | "cooper" | "run_3k" | "css" | "ftp" | "one_rm" | "hr_max";
export type AssessmentData = Partial<{ weight_kg: number; height_cm: number; body_fat_pct: number; waist_cm: number; resting_hr: number; distance_m: number; time_s: number; t400_s: number; t200_s: number; avg_power_w: number; exercise: string; reps: number; max_hr: number }>;
export type AssessmentResult = Partial<{ bmi: number; vo2max: number; threshold_pace_s_per_km: number; css_s_per_100m: number; ftp_w: number; one_rm_kg: number; max_hr: number }>;
export interface Assessment { id: ID; club_id: ID; membership_id: ID; kind: AssessmentKind; date: ISODate; data: AssessmentData; result: AssessmentResult; notes: string | null; created_at: ISOTime }

/** A club group (GET /clubs/{id}/groups). */
export interface Group { id: ID; club_id: ID; name: string; description: string | null; created_at: ISOTime; member_ids: ID[] }

// ---- messages and announcements (M10, W13)
export interface MessageAuthor { membership_id: ID; role?: Role; user: User }
export interface Message { id: ID; conversation_id: ID; author_membership_id: ID; body: string; created_at: ISOTime; deleted_at: ISOTime | null; author: MessageAuthor }
export interface ConversationSummary {
  id: ID | null; club_id: ID; student_membership_id: ID; last_message_at: ISOTime | null; created_at: ISOTime | null;
  student: { membership_id: ID; user: User }; last_message: Message | null; unread_count: number;
}
export interface ConversationDetail extends ConversationSummary { id: ID; messages: Message[]; reads: { membership_id: ID; user: User; role?: Role; last_read_at: ISOTime }[] }
export interface Announcement {
  id: ID; club_id: ID; author_membership_id: ID; title: string; body: string; group_ids: ID[]; pinned: boolean; created_at: ISOTime; edited_at: ISOTime | null; deleted_at: ISOTime | null;
  author: { membership_id: ID; user: User }; read_at: ISOTime | null; audience_count?: number; reads_count?: number;
}

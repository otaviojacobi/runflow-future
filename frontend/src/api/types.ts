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
  /** Week release (D-031): ISO weekday 1–7 + "HH:MM" of the automatic release, both null when off. */
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
export interface Subscription {
  plan: Plan; status: "active" | "trialing" | "past_due" | "canceled"; student_limit: number; active_students: number;
  current_period_end: ISOTime | null; cancel_at_period_end: boolean; has_billing_account?: boolean;
}
export interface Invoice { id: ID; club_id: ID; stripe_invoice_id: string | null; amount_cents: number; currency: string; status: "draft" | "open" | "paid" | "void" | "uncollectible"; period_start: ISOTime; period_end: ISOTime; hosted_url: string | null; created_at: ISOTime }
export interface MembershipContext { membership: Membership; club: Club; branding: Branding | null; subscription: Subscription | null }
/** Notification control (D-032): per kind, the app center, the phone and e-mail (off, right away or a daily summary). */
export type EmailMode = "off" | "instant" | "digest";
export interface KindPref { app: boolean; push: boolean; email: EmailMode }
export interface NotificationPrefs {
  kinds: Record<NotificationKind, KindPref>; digest_hour: number; quiet_start: string | null; quiet_end: string | null; paused: boolean;
  /** Staff memberships: feedback and comment notices only about these groups' students (empty = everyone). */
  groups: { club_id: ID; membership_id: ID; group_ids: ID[] }[];
}
export type PrefsPatch = Partial<Omit<NotificationPrefs, "kinds" | "groups">> & { kinds?: Partial<Record<NotificationKind, Partial<KindPref>>>; groups?: { club_id: ID; group_ids: ID[] }[] };
export interface Me { user: User; memberships: MembershipContext[]; prefs: NotificationPrefs | null; unread_notifications: number }
export type NotificationKind = "workout_assigned" | "workout_changed" | "week_released" | "comment" | "feedback" | "member_joined" | "billing" | "message" | "announcement";
export interface AppNotification { id: ID; user_id: ID; club_id: ID | null; kind: NotificationKind; title: string; body: string | null; link: string | null; read_at: ISOTime | null; created_at: ISOTime }
export interface UserSession { id: ID; kind: "web" | "mobile"; user_agent: string | null; created_at: ISOTime; last_seen_at: ISOTime; current: boolean }
export interface AuthResult { token: string; user: User; is_new: boolean }

export type InviteStatus = "pending" | "expired" | "accepted";
/** Personal invite (D-023): one e-mail, 7 days, single use. */
export interface Invitation {
  id: ID; club_id: ID; role: "trainer" | "student"; email: string; name: string | null; token: string; group_ids: ID[]; created_by: ID;
  expires_at: ISOTime; sent_at: ISOTime | null; send_count: number; accepted_at: ISOTime | null; accepted_by: ID | null; revoked_at: ISOTime | null; created_at: ISOTime;
  status: InviteStatus; url: string;
}
export interface PublicInvite {
  club: Pick<Club, "id" | "slug" | "name" | "city" | "state" | "modalities" | "trainer_label">; branding: Branding | null;
  role: "trainer" | "student"; valid: boolean; reason: "expired" | "revoked" | "accepted" | "club_full" | null;
  invited_by: string | null; name: string | null; email: string | null; email_hint: string; expires_at: ISOTime; members: number; already_member: boolean;
  /** null when signed out */
  email_matches: boolean | null;
}
export interface WorkoutTemplate {
  id: ID; club_id: ID; author_membership_id: ID; sport: Sport; name: string; description: string | null;
  structure: import("@/domain/workout").Structure; est_duration_s: number | null; est_distance_m: number | null; tags: string[];
  created_at: ISOTime; updated_at: ISOTime; archived_at: ISOTime | null;
}

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
  /** The student can see it now; false = a draft (D-031). */
  visible: boolean;
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
}

export interface AthleteRef { membership_id: ID; user: User }

/** A week's release state for the planning screen (D-031). */
export interface WeekState {
  week_start: ISODate; release_mode: Club["release_mode"]; started: boolean; released_at: ISOTime | null;
  released_athlete_ids: ID[]; auto_release_at: ISOTime | null; drafts: number;
}
/** A future week the trainer hasn't released to the student yet. */
export interface UnreleasedWeek { week_start: ISODate; auto_release_at: ISOTime | null }
export interface Dashboard {
  date: ISODate; students: number;
  today: { planned: number; done: number; items: { workout: PlannedWorkout; athlete: AthleteRef }[] };
  week: { planned: number; done: number; compliance_pct: number | null; duration_s: number; distance_m: number };
  compliance_trend: { week_start: ISODate; pct: number | null; planned: number; done: number; current: boolean }[];
  feedback: { workout: PlannedWorkout; athlete: AthleteRef; last_comment: Omit<Comment, "author"> | null }[];
  alerts: { kind: "missed_streak" | "high_rpe" | "no_sync" | "birthday" | "new_member" | "plan_limit"; severity: "danger" | "warning" | "info" | "accent" | "brand"; athlete: AthleteRef | null; text: string; link: string }[];
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

export interface FeedbackItem { workout: PlannedWorkout; athlete: AthleteRef; last_comment: Omit<Comment, "author"> | null; needs_reply: boolean; flagged: boolean }
export type FeedbackFilter = "needs_reply" | "unread" | "flagged" | "all";

export interface TrainingPlan { id: ID; club_id: ID; author_membership_id: ID; name: string; description: string | null; weeks: number; created_at: ISOTime; updated_at: ISOTime; items_count: number; weekly_duration_s: number[]; active_assignments: number }
export interface PlanItem { id: ID; plan_id?: ID; week: number; weekday: number; template_id: ID | null; sport: Sport; title: string; structure: import("@/domain/workout").Structure; est_duration_s: number | null; est_distance_m: number | null; notes: string | null }
export interface PlanAssignment { id: ID; plan_id: ID; athlete_membership_id: ID; start_date: ISODate; created_at: ISOTime; athlete: AthleteRef; workouts: number; done: number }
export interface TrainingPlanDetail extends TrainingPlan { items: PlanItem[]; assignments: PlanAssignment[] }

// ---- races and events (F21)
export type RaceSport = "run" | "trail" | "swim" | "bike" | "triathlon" | "other";
export interface RaceEntry {
  id: ID; race_id: ID; membership_id: ID; distance_m: number; goal_time_s: number | null; is_goal: boolean;
  status: "registered" | "finished" | "dns" | "dnf"; result_time_s: number | null; result_position: number | null; created_at: ISOTime; updated_at: ISOTime;
}
export interface Race {
  id: ID; club_id: ID; name: string; sport: RaceSport; date: ISODate; start_time: string | null; city: string | null; state: string | null; url: string | null;
  distances_m: number[]; notes: string | null; created_by: ID | null; created_at: ISOTime; archived_at: ISOTime | null;
  entries_count: number; my_entry: RaceEntry | null; entries?: (RaceEntry & { athlete: { membership_id: ID; user: User } })[];
}

// ---- messages and announcements (F22)
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

// ---- assessments and tests (F23)
export interface Assessment {
  id: ID; club_id: ID; membership_id: ID; kind: import("@/domain/assessments").AssessmentKind; date: ISODate;
  data: import("@/domain/assessments").AssessmentData; result: import("@/domain/assessments").AssessmentResult; notes: string | null;
  zones_id: ID | null; created_by: ID | null; created_at: ISOTime; athlete: { membership_id: ID; user: User }; zones: Zone | null;
}

// ---- reports (F25)
export interface TrainingReport {
  from: ISODate; to: ISODate; group_id: ID | null;
  totals: { athletes: number; planned: number; done: number; partial: number; missed: number; compliance_pct: number | null; planned_s: number; done_s: number; distance_m: number; sharing: number };
  weekly: { week_start: ISODate; pct: number | null; planned: number; done: number; current: boolean }[];
  athletes: { membership_id: ID; user: User; group_ids: ID[]; planned: number; done: number; partial: number; missed: number; compliance_pct: number | null; planned_s: number; shares_data: boolean; activities: number | null; done_s: number | null; distance_m: number | null }[];
}

// ---- exercise library (F28)
export type ExerciseCategory = "strength" | "core" | "mobility" | "stretch" | "plyometrics" | "drill";
export interface LibraryExercise { id: ID; club_id: ID | null; scope: "club" | "global"; name: string; category: ExerciseCategory; muscles: string[]; equipment: string[]; cues: string | null; video_url: string | null; created_at: ISOTime; archived_at: ISOTime | null }

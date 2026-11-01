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

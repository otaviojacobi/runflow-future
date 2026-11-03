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

export interface User {
  id: ID; email: string; name: string; avatar_url: string | null; phone: string | null;
  birth_date: ISODate | null; sex: "female" | "male" | "other" | null; locale: string; created_at: ISOTime;
}
export interface Club {
  id: ID; slug: string; name: string; city: string | null; state: string | null; timezone: string;
  modalities: Sport[]; trainer_label: "treinador" | "professor"; subdomain: string | null; created_at: ISOTime;
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
export interface MembershipContext { membership: Membership; club: Club; branding: Branding | null; subscription: Subscription | null }
export interface Me { user: User; memberships: MembershipContext[]; prefs: unknown; unread_notifications: number }
export interface AuthResult { token: string; user: User; is_new: boolean }

/** Personal invite page data (D-023): GET /public/invites/{token}. */
export interface PublicInvite {
  club: Pick<Club, "id" | "slug" | "name" | "city" | "state" | "modalities" | "trainer_label">; branding: Branding | null;
  role: "trainer" | "student"; valid: boolean; reason: "expired" | "revoked" | "accepted" | "club_full" | null;
  invited_by: string | null; name: string | null; email: string | null; email_hint: string; expires_at: ISOTime; members: number; already_member: boolean;
  /** null when signed out */
  email_matches: boolean | null;
}

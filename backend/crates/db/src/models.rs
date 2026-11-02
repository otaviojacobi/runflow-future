//! Row shapes returned by the API. Field names match `api/schema.sql` columns (snake_case JSON, D-020).

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// A person, as everyone sees them (the mock's `publicUser`).
#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub phone: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub sex: Option<String>,
    pub locale: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Club {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub city: Option<String>,
    pub state: Option<String>,
    pub timezone: String,
    pub modalities: Vec<String>,
    pub trainer_label: String,
    pub subdomain: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Membership {
    pub id: Uuid,
    pub club_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub status: String,
    pub is_billing_owner: bool,
    pub joined_at: DateTime<Utc>,
    pub left_at: Option<DateTime<Utc>>,
}

/// `club_branding` as the apps consume it (logo as an `/v1/assets/{id}` path).
#[derive(Debug, Clone, Serialize)]
pub struct Branding {
    pub primary_color: Option<String>,
    pub secondary_color: Option<String>,
    pub logo_url: Option<String>,
    pub theme_rev: i32,
    pub theme: Value,
    pub theme_css: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Subscription {
    pub plan: String,
    pub status: String,
    pub student_limit: i32,
    pub active_students: i64,
    pub current_period_end: Option<DateTime<Utc>>,
    pub cancel_at_period_end: bool,
    pub has_billing_account: bool,
}

/// One entry of `GET /me` → `memberships`.
#[derive(Debug, Clone, Serialize)]
pub struct MembershipContext {
    pub membership: Membership,
    pub club: Club,
    pub branding: Option<Branding>,
    pub subscription: Option<Subscription>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationPrefs {
    pub user_id: Uuid,
    pub push_workouts: bool,
    pub push_comments: bool,
    pub push_classes: bool,
    pub email_weekly: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Consent {
    pub id: Uuid,
    pub user_id: Uuid,
    pub club_id: Option<Uuid>,
    pub kind: String,
    pub text_version: String,
    pub granted_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub club_id: Option<Uuid>,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub link: Option<String>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// A signed-in device (`GET /me/sessions`).
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: Uuid,
    pub kind: String,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub current: bool,
}

/// A personal invite (D-023). The API adds `status` and `url`.
#[derive(Debug, Clone, Serialize)]
pub struct Invitation {
    pub id: Uuid,
    pub club_id: Uuid,
    pub role: String,
    pub email: String,
    pub name: Option<String>,
    pub token: String,
    pub group_ids: Vec<Uuid>,
    pub created_by: Uuid,
    pub expires_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
    pub send_count: i32,
    pub accepted_at: Option<DateTime<Utc>>,
    pub accepted_by: Option<Uuid>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl Invitation {
    /// `revoked`, `accepted`, `expired` or `pending`.
    pub fn status(&self, now: DateTime<Utc>) -> &'static str {
        if self.revoked_at.is_some() {
            "revoked"
        } else if self.accepted_at.is_some() {
            "accepted"
        } else if self.expires_at < now {
            "expired"
        } else {
            "pending"
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub id: Uuid,
    pub club_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub member_ids: Vec<Uuid>,
}

/// One row of `GET /clubs/{id}/members`.
#[derive(Debug, Clone, Serialize)]
pub struct Member {
    pub membership: Membership,
    pub user: User,
    pub group_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: Uuid,
    pub club_id: Uuid,
    pub author_membership_id: Uuid,
    pub sport: String,
    pub name: String,
    pub description: Option<String>,
    pub structure: Value,
    pub est_duration_s: Option<i32>,
    pub est_distance_m: Option<i32>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExerciseRow {
    pub id: Uuid,
    pub club_id: Option<Uuid>,
    pub name: String,
    pub category: String,
    pub muscles: Vec<String>,
    pub equipment: Vec<String>,
    pub cues: Option<String>,
    pub video_url: Option<String>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

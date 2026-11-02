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

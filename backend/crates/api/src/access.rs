//! Club-scoped authorization (§7.3): every `/clubs/{club_id}/…` handler checks the caller's active membership
//! and role, with the same answers as the mock's `ctx.member()` / `ctx.staff()` / `ctx.owner()`.

use axum::http::StatusCode;
use uuid::Uuid;

use crate::session::Auth;
use crate::{AppState, Problem};

pub const OWNER: &[&str] = &["owner"];
pub const STAFF: &[&str] = &["owner", "trainer"];
pub const ANY: &[&str] = &["owner", "trainer", "student"];

#[derive(Debug, Clone)]
pub struct Member {
    pub user_id: Uuid,
    pub club_id: Uuid,
    pub membership_id: Uuid,
    pub role: String,
}

impl Member {
    pub fn is_owner(&self) -> bool {
        self.role == "owner"
    }
}

/// `404 club.not_found` when the caller isn't an active member (or the id is malformed), `403 auth.forbidden`
/// when the role isn't allowed.
pub async fn member(
    state: &AppState,
    auth: &Auth,
    club_id: &str,
    roles: &[&str],
) -> Result<Member, Problem> {
    let club_id = Uuid::parse_str(club_id).map_err(|_| Problem::club_not_found())?;
    let a = runflow_db::clubs::access(&state.db, auth.user_id, club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    if !roles.contains(&a.role.as_str()) {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "auth.forbidden",
            "Sem permissão",
            "Seu papel no clube não permite esta ação.",
        ));
    }
    Ok(Member {
        user_id: auth.user_id,
        club_id,
        membership_id: a.membership_id,
        role: a.role,
    })
}

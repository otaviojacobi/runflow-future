//! Club-scoped authorization (§7.3): every `/clubs/{club_id}/…` handler checks the caller's active membership
//! and role, with the same answers as the mock's `ctx.member()` / `ctx.staff()` / `ctx.owner()`.

use axum::extract::Request;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use crate::session::Auth;
use crate::{AppState, Problem};

pub const OWNER: &[&str] = &["owner"];
pub const STAFF: &[&str] = &["owner", "trainer"];
pub const ANY: &[&str] = &["owner", "trainer", "student"];

tokio::task_local! {
    /// Set per request by [`write_gate`]: whether a staff member of a frozen club may not do this.
    static GATED: bool;
}

/// Marks the writes a frozen club's staff can't make (D-043): anything but reads, billing (subscription,
/// checkout, change, portal, invoices, the simulation) and closing the club. [`member`] enforces it.
pub async fn write_gate(req: Request, next: Next) -> Response {
    let gated = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS)
        && !allowed_while_frozen(req.method(), req.uri().path());
    GATED.scope(gated, next.run(req)).await
}

fn allowed_while_frozen(method: &Method, path: &str) -> bool {
    let path = path.strip_prefix("/v1").unwrap_or(path);
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["clubs", _] => method == Method::DELETE,
        ["clubs", _, "subscription" | "invoices", ..] | ["mock", "stripe", ..] => true,
        _ => false,
    }
}

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
    // Frozen clubs (D-043): staff can only pay (or close the club); students never notice.
    if a.role != "student"
        && GATED.try_with(|g| *g).unwrap_or(false)
        && runflow_db::clubs::subscription(&state.db, club_id, &a.role)
            .await?
            .is_some_and(|s| s.frozen)
    {
        return Err(Problem::new(
            StatusCode::LOCKED,
            "club.frozen",
            "Clube congelado",
            if a.role == "owner" {
                "O pagamento do plano está pendente. Regularize em Plano e cobrança para voltar a usar o clube."
            } else {
                "O pagamento do plano está pendente. Peça ao responsável pelo clube para regularizar."
            },
        ));
    }
    Ok(Member {
        user_id: auth.user_id,
        club_id,
        membership_id: a.membership_id,
        role: a.role,
    })
}

/// `409 plan.limit_reached` when `adding` more of `role` don't fit the plan's hard limits (Free, Pro; Max bills
/// extra seats instead), like the mock's `ensureSeat`.
pub async fn ensure_seat(
    state: &AppState,
    club_id: Uuid,
    role: &str,
    adding: i64,
) -> Result<(), Problem> {
    let Some(s) = runflow_db::clubs::subscription_row(&state.db, club_id).await? else {
        return Ok(());
    };
    let used = if role == "trainer" {
        s.active_trainers
    } else {
        s.active_students
    };
    match runflow_domain::plans::seat_full(runflow_domain::plans::plan(&s.plan), role, used, adding)
    {
        Some((title, detail)) => Err(Problem::new(
            StatusCode::CONFLICT,
            "plan.limit_reached",
            title,
            detail,
        )),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_frozen_club_still_allows() {
        let id = "/v1/clubs/0190a3c4-0000-7000-8000-000000000000";
        assert!(allowed_while_frozen(&Method::DELETE, id));
        assert!(!allowed_while_frozen(&Method::PATCH, id));
        for p in [
            "/subscription",
            "/subscription/checkout",
            "/subscription/change",
            "/subscription/portal",
            "/invoices",
        ] {
            assert!(
                allowed_while_frozen(&Method::POST, &format!("{id}{p}")),
                "{p}"
            );
        }
        assert!(allowed_while_frozen(&Method::POST, "/mock/stripe/portal"));
        assert!(!allowed_while_frozen(
            &Method::POST,
            &format!("{id}/workouts")
        ));
        assert!(!allowed_while_frozen(
            &Method::POST,
            "/clubs/x/members/y/subscription-ish"
        ));
    }
}

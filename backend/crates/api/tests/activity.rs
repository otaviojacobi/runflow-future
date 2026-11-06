//! D-056: account activity is kept (users, memberships, clubs), so an inactivity policy can be decided later.

mod common;

use common::TestApp;
use serde_json::json;
use sqlx::PgPool;

/// Pushes every activity stamp an hour back, and lets the next touch through Valkey's throttle.
async fn age(app: &TestApp) {
    for table in ["users", "memberships", "clubs"] {
        // Table names from the fixed list above.
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table} SET last_active_at = now() - interval '1 hour'"
        )))
        .execute(app.db())
        .await
        .unwrap();
    }
    sqlx::query("UPDATE sessions SET last_seen_at = now() - interval '1 hour'")
        .execute(app.db())
        .await
        .unwrap();
}

async fn recent(app: &TestApp, sql: &str) -> bool {
    // `sql` is always one of this file's literal queries.
    sqlx::query_scalar::<_, bool>(sqlx::AssertSqlSafe(format!(
        "SELECT ({sql}) > now() - interval '1 minute'"
    )))
    .fetch_one(app.db())
    .await
    .unwrap()
}

/// The membership's stamp is written off the request path: wait for it (2 s at most).
async fn eventually_recent(app: &TestApp, sql: &str) -> bool {
    for _ in 0..40 {
        if recent(app, sql).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    false
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn sign_ins_attempts_and_use_are_kept(db: PgPool) {
    let app = TestApp::new(db);
    let ana = app.sign_in("ana@email.com").await;
    let ana_user = "SELECT {} FROM users WHERE email = 'ana@email.com'";
    assert!(recent(&app, &ana_user.replace("{}", "last_sign_in_at")).await);
    assert!(recent(&app, &ana_user.replace("{}", "last_active_at")).await);
    // Asking for a code is an attempt, even if never used; an address without an account stores nothing.
    let attempt = ana_user.replace("{}", "last_sign_in_attempt_at");
    sqlx::query("UPDATE users SET last_sign_in_attempt_at = NULL")
        .execute(app.db())
        .await
        .unwrap();
    app.skip_code_cooldown("ana@email.com").await;
    app.post(
        "/v1/auth/email/start",
        None,
        json!({ "email": "ANA@email.com" }),
    )
    .await
    .ok();
    assert!(recent(&app, &attempt).await);
    app.post(
        "/v1/auth/email/start",
        None,
        json!({ "email": "nobody@email.com" }),
    )
    .await
    .ok();
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(app.db())
        .await
        .unwrap();
    assert_eq!(users, 1);

    // Using a session (past its 5-minute throttle) is activity.
    age(&app).await;
    app.get("/v1/me", Some(&ana)).await.ok();
    assert!(recent(&app, &ana_user.replace("{}", "last_active_at")).await);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn club_requests_mark_the_membership_and_the_club(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let id = app
        .post(
            "/v1/clubs",
            Some(&owner),
            json!({ "name": "Pace Forte", "modalities": ["run"] }),
        )
        .await
        .body["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    age(&app).await;
    app.get(&format!("/v1/clubs/{id}"), Some(&owner)).await.ok();
    assert!(eventually_recent(&app, "SELECT last_active_at FROM memberships").await);
    assert!(eventually_recent(&app, "SELECT last_active_at FROM clubs").await);

    // Written at most every 5 minutes per membership: a second request right after leaves the stamps alone.
    age(&app).await;
    app.get(&format!("/v1/clubs/{id}"), Some(&owner)).await.ok();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(!recent(&app, "SELECT last_active_at FROM memberships").await);

    // A club already stamped in the last 5 minutes isn't rewritten for another member (big clubs stay cheap).
    sqlx::query("UPDATE clubs SET last_active_at = now() - interval '2 minutes'")
        .execute(app.db())
        .await
        .unwrap();
    let membership: uuid::Uuid = sqlx::query_scalar("SELECT id FROM memberships")
        .fetch_one(app.db())
        .await
        .unwrap();
    runflow_db::clubs::touch_membership(app.db(), membership)
        .await
        .unwrap();
    assert!(!recent(&app, "SELECT last_active_at FROM clubs").await);
    assert!(recent(&app, "SELECT last_active_at FROM memberships").await);
}

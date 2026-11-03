//! Billing (D-016, §4.6): the club's plan from Stripe (Checkout, subscription and invoice events) or from the
//! billing simulation, and its invoices. Plan limits: Free 10 active students, Pro 100.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

pub const FREE_LIMIT: i32 = 10;
pub const PRO_LIMIT: i32 = 100;

/// Applies a cancellation whose period is over (Stripe also sends `customer.subscription.deleted`).
pub async fn settle(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE club_subscriptions SET plan = 'free', status = 'active', student_limit = $2, stripe_subscription_id = NULL,
                current_period_end = NULL, cancel_at_period_end = false, updated_at = now()
          WHERE club_id = $1 AND plan <> 'free' AND cancel_at_period_end AND current_period_end <= now()",
        club_id,
        FREE_LIMIT
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct Account {
    pub plan: String,
    pub status: String,
    pub customer: Option<String>,
    pub subscription: Option<String>,
}

pub async fn account(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Option<Account>> {
    sqlx::query_as!(
        Account,
        r#"SELECT plan, status, stripe_customer_id AS customer, stripe_subscription_id AS subscription
             FROM club_subscriptions WHERE club_id = $1"#,
        club_id
    )
    .fetch_optional(db)
    .await
}

/// The club behind a Stripe subscription or customer.
pub async fn club_of(
    db: impl PgExecutor<'_>,
    subscription: Option<&str>,
    customer: Option<&str>,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        "SELECT club_id FROM club_subscriptions
          WHERE ($1::text IS NOT NULL AND stripe_subscription_id = $1) OR ($2::text IS NOT NULL AND stripe_customer_id = $2)
          ORDER BY (stripe_subscription_id = $1) DESC NULLS LAST LIMIT 1",
        subscription,
        customer
    )
    .fetch_optional(db)
    .await
}

/// A Pro subscription's state; `None` keeps what's stored.
#[derive(Default)]
pub struct Pro<'a> {
    pub customer: Option<&'a str>,
    pub subscription: Option<&'a str>,
    pub status: Option<&'a str>,
    pub period_end: Option<DateTime<Utc>>,
    pub cancel_at_period_end: Option<bool>,
}

/// Puts the club on Pro (or updates it). Returns the plan it had before.
pub async fn set_pro(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    p: Pro<'_>,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar!(
        r#"WITH before AS (SELECT plan FROM club_subscriptions WHERE club_id = $1)
           UPDATE club_subscriptions SET plan = 'pro', student_limit = $2,
                  stripe_customer_id = coalesce($3, stripe_customer_id),
                  stripe_subscription_id = coalesce($4, stripe_subscription_id),
                  status = coalesce($5, CASE WHEN plan = 'pro' THEN status ELSE 'active' END),
                  current_period_end = coalesce($6, current_period_end),
                  cancel_at_period_end = coalesce($7, CASE WHEN plan = 'pro' THEN cancel_at_period_end ELSE false END),
                  updated_at = now()
            WHERE club_id = $1
           RETURNING (SELECT plan FROM before) AS "before!""#,
        club_id,
        PRO_LIMIT,
        p.customer,
        p.subscription,
        p.status,
        p.period_end,
        p.cancel_at_period_end
    )
    .fetch_optional(db)
    .await
}

/// Back to Free (the subscription ended); the customer stays for a later checkout and the portal.
pub async fn set_free(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE club_subscriptions SET plan = 'free', status = 'active', student_limit = $2, stripe_subscription_id = NULL,
                current_period_end = NULL, cancel_at_period_end = false, updated_at = now()
          WHERE club_id = $1",
        club_id,
        FREE_LIMIT
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_status(db: impl PgExecutor<'_>, club_id: Uuid, status: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE club_subscriptions SET status = $2, updated_at = now() WHERE club_id = $1 AND plan <> 'free'",
        club_id,
        status
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Simulation: the period ended yesterday with a scheduled cancellation (the next read settles it).
pub async fn expire(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE club_subscriptions SET current_period_end = now() - interval '1 day', cancel_at_period_end = true, updated_at = now()
          WHERE club_id = $1",
        club_id
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn invoices(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(i) AS "x!" FROM invoices i WHERE club_id = $1 ORDER BY created_at DESC, id"#,
        club_id
    )
    .fetch_all(db)
    .await
}

pub struct Invoice<'a> {
    pub club_id: Uuid,
    pub stripe_invoice_id: &'a str,
    pub amount_cents: i32,
    pub currency: &'a str,
    pub status: &'a str,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub hosted_url: Option<&'a str>,
}

/// Insert or update by Stripe id (events can arrive more than once and out of order).
pub async fn upsert_invoice(db: impl PgExecutor<'_>, i: Invoice<'_>) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO invoices (id, club_id, stripe_invoice_id, amount_cents, currency, status, period_start, period_end, hosted_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (stripe_invoice_id) DO UPDATE SET amount_cents = excluded.amount_cents, status = excluded.status,
           hosted_url = coalesce(excluded.hosted_url, invoices.hosted_url)",
        Uuid::now_v7(),
        i.club_id,
        i.stripe_invoice_id,
        i.amount_cents,
        i.currency,
        i.status,
        i.period_start,
        i.period_end,
        i.hosted_url
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Memberships that get billing notices.
pub async fn billing_owners(db: impl PgExecutor<'_>, club_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        "SELECT id FROM memberships WHERE club_id = $1 AND is_billing_owner AND status = 'active'",
        club_id
    )
    .fetch_all(db)
    .await
}

/// `subscription.*` entries in the audit log (`actor` is None for Stripe's own events).
pub async fn audit(
    db: impl PgExecutor<'_>,
    club_id: Uuid,
    actor: Option<Uuid>,
    action: &str,
    data: &Value,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO audit_log (club_id, actor_user_id, action, target_type, target_id, data) VALUES ($1, $2, $3, 'club', $1, $4)",
        club_id,
        actor,
        action,
        data
    )
    .execute(db)
    .await?;
    Ok(())
}

/// The billing notices (pt-BR), sent to the club's billing owners.
pub enum Notice {
    Upgraded,
    PaymentFailed,
}

pub async fn notify_owners(
    db: &mut PgConnection,
    club_id: Uuid,
    notice: Notice,
) -> sqlx::Result<()> {
    let (title, body) = match notice {
        Notice::Upgraded => (
            "Bem-vindo ao Pro!",
            "Agora o clube comporta até 100 alunos e pode ter endereço próprio.",
        ),
        Notice::PaymentFailed => (
            "Não conseguimos cobrar a assinatura",
            "Atualize o cartão em Plano e cobrança para manter o Pro.",
        ),
    };
    for m in billing_owners(&mut *db, club_id).await? {
        crate::notifications::to_member(
            db,
            m,
            crate::notifications::Notice {
                club_id,
                kind: "billing",
                title,
                body: Some(body),
                link: "/club/billing",
            },
            None,
        )
        .await?;
    }
    Ok(())
}

//! Billing (O4, O5; endpoints.md § Billing), like api/mock/routes/billing.mjs. With Stripe configured, checkout
//! and the portal are Stripe's hosted pages and the plan follows signed webhooks (applied by the worker). Without
//! it, the billing simulation (`BILLING_SIMULATION`, dev and QA) sends owners to the app's `/dev/stripe` pages and
//! `/mock/stripe/*` plays Stripe's part. No charging during the beta (D-016).

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use runflow_db::billing::{self as db, Invoice, Notice, Paid};
use runflow_domain::plans::{self, Plan};
use runflow_integrations::stripe::{Checkout, StripeError, plan_items, verify_signature};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, OWNER, member};
use crate::body::Body;
use crate::session::Auth;
use crate::{AppState, Problem};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs/{club_id}/subscription", get(subscription))
        .route("/clubs/{club_id}/subscription/checkout", post(checkout))
        .route("/clubs/{club_id}/subscription/change", post(change))
        .route("/clubs/{club_id}/subscription/portal", post(portal))
        .route("/clubs/{club_id}/invoices", get(invoices))
        .route("/webhooks/stripe", post(webhook))
        .route("/mock/stripe/complete", post(sim_complete))
        .route("/mock/stripe/portal", post(sim_portal))
        .route("/public/plans", get(public_plans))
}

/// The plan catalog (`api/plans.json`): seats per role and prices, for the landing page and Plano e cobrança.
async fn public_plans() -> Json<&'static plans::Catalog> {
    Json(plans::catalog())
}

/// How checkout works here.
enum Mode<'a> {
    Stripe(&'a runflow_integrations::stripe::StripeClient),
    Simulation,
}

fn mode(state: &AppState) -> Result<Mode<'_>, Problem> {
    match &state.stripe {
        Some(client) => Ok(Mode::Stripe(client)),
        None if state.settings.billing.simulation => Ok(Mode::Simulation),
        None => Err(unavailable()),
    }
}

/// Max's seats above the included ones `(trainers, students)`.
fn extras(p: &Plan, row: &runflow_db::models::SubscriptionRow) -> (i64, i64) {
    match p.extra {
        Some(_) => (
            (row.active_trainers - p.trainers).max(0),
            (row.active_students - p.students).max(0),
        ),
        None => (0, 0),
    }
}

/// After a membership change: Max bills its seats, so the worker brings the Stripe quantities up to date.
pub(crate) async fn seats_changed(state: &AppState, club_id: Uuid) -> Result<(), Problem> {
    if state.stripe.is_none() {
        return Ok(());
    }
    if let Some(a) = db::account(&state.db, club_id).await?
        && a.plan == "max"
        && a.subscription.is_some()
    {
        runflow_jobs::enqueue(
            &state.db,
            runflow_jobs::STRIPE_SEATS,
            json!({ "club_id": club_id }),
        )
        .await?;
    }
    Ok(())
}

fn unavailable() -> Problem {
    Problem::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "billing.unavailable",
        "Assinaturas indisponíveis no momento",
        "Durante o beta todos os clubes usam o Runflow sem pagar. Fale com a gente se precisar de mais vagas.",
    )
}

fn stripe_failed(e: StripeError) -> Problem {
    tracing::error!(error = %e, "stripe request failed");
    Problem::new(
        StatusCode::BAD_GATEWAY,
        "billing.provider_error",
        "Não conseguimos falar com o Stripe",
        "Tente de novo em alguns minutos.",
    )
}

async fn current(state: &AppState, club_id: Uuid, role: &str) -> Result<Value, Problem> {
    db::settle(&state.db, club_id).await?;
    let s = runflow_db::clubs::subscription(&state.db, club_id, role)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    Ok(json!(s))
}

/// `pro` or `max` (`422` otherwise).
fn paid_plan(body: &Body) -> Result<&'static Plan, Problem> {
    match body.str("plan").as_deref() {
        Some(id @ ("pro" | "max")) => Ok(plans::plan(id)),
        _ => Err(Problem::field("plan", "Escolha um plano.")),
    }
}

fn no_subscription() -> Problem {
    Problem::new(
        StatusCode::CONFLICT,
        "billing.no_subscription",
        "Nenhuma assinatura ativa",
        "Assine um plano primeiro.",
    )
}

async fn subscription(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    Ok(Json(current(&state, m.club_id, &m.role).await?))
}

async fn checkout(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let p = paid_plan(&body)?;
    db::settle(&state.db, m.club_id).await?;
    let account = db::account(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    if account.plan != "free" && account.status != "canceled" {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "subscription.exists",
            format!("Você já está no {}", plans::plan(&account.plan).name),
            "Para trocar de plano, use “Mudar plano”; para o pagamento, “Gerenciar assinatura”.",
        ));
    }
    let url = match mode(&state)? {
        Mode::Stripe(client) => {
            let email = runflow_db::auth::user_by_id(&state.db, auth.user_id)
                .await?
                .map(|u| u.email)
                .unwrap_or_default();
            let row = runflow_db::clubs::subscription_row(&state.db, m.club_id)
                .await?
                .ok_or_else(Problem::club_not_found)?;
            let (trainers, students) = extras(p, &row);
            let prices = client.prices().await.map_err(stripe_failed)?;
            let items = plan_items(&prices, &p.id, trainers, students).map_err(stripe_failed)?;
            let app = &state.settings.public_app_url;
            client
                .checkout(Checkout {
                    items: &items,
                    plan: &p.id,
                    club_id: &m.club_id.to_string(),
                    customer: account.customer.as_deref(),
                    email: &email,
                    success_url: &format!("{app}/club/billing?checkout=success"),
                    cancel_url: &format!("{app}/club/billing?checkout=cancelled"),
                })
                .await
                .map_err(stripe_failed)?
        }
        Mode::Simulation => format!(
            "/dev/stripe/checkout?club={}&plan={}&session=cs_sim_{}",
            m.club_id,
            p.id,
            &Uuid::now_v7().simple().to_string()[..12]
        ),
    };
    Ok(Json(json!({ "checkout_url": url })))
}

/// Pro ⇄ Max on a paid plan, never into a plan the club doesn't fit.
async fn change(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let p = paid_plan(&body)?;
    db::settle(&state.db, m.club_id).await?;
    let row = runflow_db::clubs::subscription_row(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    let account = db::account(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    if row.plan == "free" || account.subscription.is_none() {
        return Err(no_subscription());
    }
    if row.plan == p.id {
        return Ok(Json(json!(row.view(&m.role))));
    }
    if let Some((title, detail)) = plans::too_small(p, row.active_students, row.active_trainers) {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "plan.too_small",
            title,
            detail,
        ));
    }
    if let Mode::Stripe(client) = mode(&state)? {
        let current = client
            .subscription(account.subscription.as_deref().unwrap_or_default())
            .await
            .map_err(stripe_failed)?;
        let (trainers, students) = extras(p, &row);
        let prices = client.prices().await.map_err(stripe_failed)?;
        let items = plan_items(&prices, &p.id, trainers, students).map_err(stripe_failed)?;
        client
            .change_plan(&current, &p.id, &items)
            .await
            .map_err(stripe_failed)?;
    }
    let mut tx = state.db.begin().await?;
    db::set_paid(
        &mut *tx,
        m.club_id,
        Paid {
            plan: Some(&p.id),
            ..Paid::default()
        },
    )
    .await?;
    db::audit(
        &mut *tx,
        m.club_id,
        Some(auth.user_id),
        "subscription.changed",
        &json!({ "plan": p.id }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(current(&state, m.club_id, &m.role).await?))
}

async fn portal(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let customer = db::account(&state.db, m.club_id)
        .await?
        .and_then(|a| a.customer)
        .ok_or_else(|| {
            Problem::new(
                StatusCode::CONFLICT,
                "billing.no_account",
                "Nenhuma assinatura ainda",
                "Assine um plano para gerenciar pagamentos.",
            )
        })?;
    let url = match mode(&state)? {
        Mode::Stripe(client) => client
            .portal(
                &customer,
                &format!("{}/club/billing", state.settings.public_app_url),
            )
            .await
            .map_err(stripe_failed)?,
        Mode::Simulation => format!("/dev/stripe/portal?club={}", m.club_id),
    };
    Ok(Json(json!({ "portal_url": url })))
}

async fn invoices(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let items = db::invoices(&state.db, m.club_id).await?;
    Ok(Json(json!({ "items": items, "next_cursor": null })))
}

/// Stripe's events: verified, stored once per event id, applied by the worker (`stripe.event`).
async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Bytes,
) -> Result<StatusCode, Problem> {
    let Some(secret) = &state.settings.billing.webhook_secret else {
        return Err(Problem::route_not_found("POST", "/v1/webhooks/stripe"));
    };
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !verify_signature(secret, signature, &payload, Utc::now().timestamp()) {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "webhook.invalid_signature",
            "Assinatura inválida",
            "O evento não veio do Stripe.",
        ));
    }
    let event: Value = serde_json::from_slice(&payload).map_err(|_| Problem::invalid_json())?;
    let Some(id) = event["id"].as_str() else {
        return Err(Problem::invalid_json());
    };
    if let Some(row) = runflow_db::providers::record_event(&state.db, "stripe", id, &event).await? {
        runflow_jobs::enqueue(
            &state.db,
            runflow_jobs::STRIPE_EVENT,
            json!({ "event_id": row }),
        )
        .await?;
    }
    Ok(StatusCode::OK)
}

// ------------------------------------------------------------------------------------ simulation

/// The simulation's routes exist only when it's on and Stripe isn't configured.
fn simulating(state: &AppState, path: &str) -> Result<(), Problem> {
    match mode(state) {
        Ok(Mode::Simulation) => Ok(()),
        _ => Err(Problem::route_not_found("POST", path)),
    }
}

/// Checkout completed: what `checkout.session.completed` and the first paid invoice do.
async fn sim_complete(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Value>, Problem> {
    simulating(&state, "/v1/mock/stripe/complete")?;
    let club_id = body.str("club_id").unwrap_or_default();
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let p = match body.str("plan") {
        None => plans::plan("pro"),
        Some(_) => paid_plan(&body)?,
    };
    let now = Utc::now();
    let end = now
        .checked_add_months(chrono::Months::new(1))
        .unwrap_or(now);
    let short = |p: &str| format!("{p}_sim_{}", &Uuid::now_v7().simple().to_string()[..12]);
    let customer = db::account(&state.db, m.club_id)
        .await?
        .and_then(|a| a.customer)
        .unwrap_or_else(|| short("cus"));
    let mut tx = state.db.begin().await?;
    let before = db::set_paid(
        &mut *tx,
        m.club_id,
        Paid {
            plan: Some(&p.id),
            customer: Some(&customer),
            subscription: Some(&short("sub")),
            status: Some("active"),
            period_end: Some(end),
            cancel_at_period_end: Some(false),
        },
    )
    .await?;
    let seats = runflow_db::clubs::subscription_row(&mut *tx, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    db::upsert_invoice(
        &mut *tx,
        Invoice {
            club_id: m.club_id,
            stripe_invoice_id: &short("in"),
            amount_cents: plans::monthly_cents(p, seats.active_students, seats.active_trainers)
                as i32,
            currency: "BRL",
            status: "paid",
            period_start: now,
            period_end: end,
            hosted_url: None,
        },
    )
    .await?;
    if before.as_deref() != Some(p.id.as_str()) {
        db::notify_owners(&mut tx, m.club_id, Notice::Welcome(p)).await?;
    }
    db::audit(
        &mut *tx,
        m.club_id,
        Some(auth.user_id),
        "subscription.upgraded",
        &json!({ "plan": p.id }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(current(&state, m.club_id, &m.role).await?))
}

/// The portal's actions and the webhooks they cause; `freeze` = a failed payment whose grace period is over.
async fn sim_portal(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Json<Value>, Problem> {
    simulating(&state, "/v1/mock/stripe/portal")?;
    let club_id = body.str("club_id").unwrap_or_default();
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let account = db::account(&state.db, m.club_id)
        .await?
        .ok_or_else(Problem::club_not_found)?;
    if account.subscription.is_none() {
        return Err(no_subscription());
    }
    let mut tx = state.db.begin().await?;
    let cancel = |at_period_end| Paid {
        cancel_at_period_end: Some(at_period_end),
        ..Paid::default()
    };
    match body.str("action").as_deref() {
        Some("cancel") => {
            db::set_paid(&mut *tx, m.club_id, cancel(true)).await?;
        }
        Some("resume") => {
            db::set_paid(&mut *tx, m.club_id, cancel(false)).await?;
        }
        Some(action @ ("fail_payment" | "freeze")) => {
            let before = if action == "freeze" {
                db::freeze(&mut *tx, m.club_id).await?
            } else {
                db::set_status(&mut *tx, m.club_id, "past_due").await?
            };
            if before.as_deref().is_some_and(|s| s != "past_due") {
                db::notify_owners(&mut tx, m.club_id, Notice::PaymentFailed).await?;
            }
        }
        Some("pay") => {
            db::set_status(&mut *tx, m.club_id, "active").await?;
        }
        Some("expire") => db::expire(&mut *tx, m.club_id).await?,
        _ => return Err(Problem::field("action", "Ação inválida.")),
    }
    tx.commit().await?;
    Ok(Json(current(&state, m.club_id, &m.role).await?))
}

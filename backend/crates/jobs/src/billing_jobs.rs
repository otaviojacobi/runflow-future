//! Stripe events (D-016): `stripe.event {event_id}` applies a verified webhook event to the club's plan and
//! invoices. Events can arrive more than once and in any order, so every write is an idempotent upsert.

use chrono::{DateTime, Utc};
use runflow_db::billing::{self, Invoice, Notice, Paid};
use runflow_db::providers;
use runflow_domain::plans;
use runflow_integrations::stripe::{id_of, invoice_period, period_end, plan_status};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{JobError, Worker};

pub const STRIPE_EVENT: &str = "stripe.event";

pub(crate) async fn event(w: &Worker, payload: &Value) -> Result<(), JobError> {
    let id = payload["event_id"]
        .as_i64()
        .ok_or_else(|| JobError::permanent("bad payload"))?;
    let Some(e) = providers::event(&w.db, id).await? else {
        return Ok(());
    };
    let result = apply(w, &e).await;
    let err = result.as_ref().err().map(|e| e.message.clone());
    if result.is_ok() || !result.as_ref().is_err_and(|e| e.retry) {
        providers::event_done(&w.db, id, err.as_deref()).await?;
    }
    result
}

/// The plan our checkout put in the metadata (`pro` | `max`).
fn plan_of(o: &Value) -> Option<&str> {
    o["metadata"]["plan"]
        .as_str()
        .filter(|p| matches!(*p, "pro" | "max"))
}

fn at(secs: Option<i64>) -> Option<DateTime<Utc>> {
    secs.and_then(|s| DateTime::from_timestamp(s, 0))
}

/// The club an object belongs to: our metadata first, then the stored Stripe ids.
async fn club_of(
    w: &Worker,
    o: &Value,
    subscription: Option<&str>,
) -> Result<Option<Uuid>, JobError> {
    let tagged = o["metadata"]["club_id"]
        .as_str()
        .or_else(|| o["client_reference_id"].as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    if tagged.is_some() {
        return Ok(tagged);
    }
    Ok(billing::club_of(&w.db, subscription, id_of(&o["customer"])).await?)
}

async fn apply(w: &Worker, e: &Value) -> Result<(), JobError> {
    let o = &e["data"]["object"];
    let kind = e["type"].as_str().unwrap_or_default();
    match kind {
        // Checkout finished: the club is on the plan it bought (our metadata; Pro before plans by seats).
        "checkout.session.completed" if o["mode"] == "subscription" => {
            let subscription = id_of(&o["subscription"]);
            let Some(club) = club_of(w, o, subscription).await? else {
                return Ok(());
            };
            let plan = plans::plan(plan_of(o).unwrap_or("pro"));
            let mut tx = w.db.begin().await?;
            let before = billing::set_paid(
                &mut *tx,
                club,
                Paid {
                    plan: Some(&plan.id),
                    customer: id_of(&o["customer"]),
                    subscription,
                    ..Paid::default()
                },
            )
            .await?;
            if before.as_deref().is_some_and(|p| p != plan.id) {
                billing::notify_owners(&mut tx, club, Notice::Welcome(plan)).await?;
                billing::audit(
                    &mut *tx,
                    club,
                    None,
                    "subscription.upgraded",
                    &json!({ "plan": plan.id }),
                )
                .await?;
            }
            tx.commit().await?;
        }
        "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted" => {
            let subscription = o["id"].as_str();
            let Some(club) = club_of(w, o, subscription).await? else {
                return Ok(());
            };
            let status = plan_status(o["status"].as_str().unwrap_or_default());
            // Another (older) subscription of the same customer doesn't touch the current one.
            let current = billing::account(&w.db, club).await?;
            let other = current
                .as_ref()
                .and_then(|a| a.subscription.as_deref())
                .is_some_and(|s| Some(s) != subscription);
            if kind == "customer.subscription.deleted" || status == Some("canceled") {
                if !other {
                    billing::set_free(&w.db, club).await?;
                    billing::audit(
                        &w.db,
                        club,
                        None,
                        "subscription.ended",
                        &json!({ "plan": "free" }),
                    )
                    .await?;
                }
            } else if let Some(status) = status
                && !(other && current.as_ref().is_some_and(|a| a.plan != "free"))
            {
                billing::set_paid(
                    &w.db,
                    club,
                    Paid {
                        plan: plan_of(o),
                        customer: id_of(&o["customer"]),
                        subscription,
                        status: Some(status),
                        period_end: at(period_end(o)),
                        cancel_at_period_end: o["cancel_at_period_end"].as_bool(),
                    },
                )
                .await?;
            }
        }
        "invoice.created"
        | "invoice.finalized"
        | "invoice.updated"
        | "invoice.paid"
        | "invoice.payment_succeeded"
        | "invoice.payment_failed"
        | "invoice.voided"
        | "invoice.marked_uncollectible" => {
            let (Some(id), Some(club)) = (
                o["id"].as_str(),
                club_of(w, o, id_of(&o["subscription"])).await?,
            ) else {
                return Ok(());
            };
            let Some((start, end)) = invoice_period(o) else {
                return Ok(());
            };
            let status = o["status"].as_str().unwrap_or("open");
            let amount = if status == "paid" {
                &o["amount_paid"]
            } else {
                &o["amount_due"]
            };
            let mut tx = w.db.begin().await?;
            billing::upsert_invoice(
                &mut *tx,
                Invoice {
                    club_id: club,
                    stripe_invoice_id: id,
                    amount_cents: amount.as_i64().unwrap_or(0) as i32,
                    currency: &o["currency"].as_str().unwrap_or("brl").to_uppercase(),
                    status,
                    period_start: at(Some(start)).unwrap_or_default(),
                    period_end: at(Some(end)).unwrap_or_default(),
                    hosted_url: o["hosted_invoice_url"].as_str(),
                },
            )
            .await?;
            if kind == "invoice.payment_failed"
                && billing::set_status(&mut *tx, club, "past_due")
                    .await?
                    .is_some_and(|before| before != "past_due")
            {
                billing::notify_owners(&mut tx, club, Notice::PaymentFailed).await?;
            }
            tx.commit().await?;
        }
        _ => {}
    }
    Ok(())
}

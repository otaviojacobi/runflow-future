//! S7 billing (O4, O5; D-016): the simulation (dev, QA) with the mock's answers, Stripe Checkout and the portal
//! against a fake Stripe, and signed webhooks applied by the worker.

mod common;

use std::sync::{Arc, Mutex};

use axum::extract::{Form, State};
use axum::http::Method;
use axum::routing::post;
use axum::{Json, Router};
use common::TestApp;
use runflow_api::BillingSettings;
use runflow_integrations::stripe::sign;
use serde_json::{Value, json};
use sqlx::PgPool;

async fn setup(app: &TestApp) -> (String, String, String) {
    let owner = app.sign_in("marcos@email.com").await;
    let club = app
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
    let i = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(&owner),
            json!({ "email": "ana@email.com" }),
        )
        .await;
    let token = i.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let ana = app.sign_in("ana@email.com").await;
    app.post(
        &format!("/v1/invites/{token}/accept"),
        Some(&ana),
        json!({}),
    )
    .await
    .ok();
    (club, owner, ana)
}

async fn notifications(app: &TestApp, token: &str) -> Vec<String> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == "billing")
        .map(|n| n["title"].as_str().unwrap().to_string())
        .collect()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_billing_simulation(db: PgPool) {
    let app = TestApp::new(db);
    let (club, owner, ana) = setup(&app).await;
    let sub = format!("/v1/clubs/{club}/subscription");

    let free = app.get(&sub, Some(&ana)).await;
    assert_eq!(free.ok()["plan"], "free");
    assert_eq!(
        (&free.body["student_limit"], &free.body["trainer_limit"]),
        (&json!(10), &json!(1))
    );
    assert_eq!(free.body["active_students"], 1);
    assert_eq!(free.body["active_trainers"], 0);
    assert_eq!(free.body["monthly_cents"], 0);
    assert_eq!(free.body["frozen"], false);
    assert_eq!(free.body["has_billing_account"], false);

    // Owner only; a paid plan; the portal needs an account.
    app.post(
        &format!("{sub}/checkout"),
        Some(&ana),
        json!({ "plan": "pro" }),
    )
    .await
    .problem(403, "auth.forbidden");
    for plan in [json!({}), json!({ "plan": "free" })] {
        app.post(&format!("{sub}/checkout"), Some(&owner), plan)
            .await
            .problem(422, "validation.failed");
    }
    app.post(&format!("{sub}/portal"), Some(&owner), json!({}))
        .await
        .problem(409, "billing.no_account");
    app.post(
        &format!("{sub}/change"),
        Some(&owner),
        json!({ "plan": "max" }),
    )
    .await
    .problem(409, "billing.no_subscription");
    let max = app
        .post(
            &format!("{sub}/checkout"),
            Some(&owner),
            json!({ "plan": "max" }),
        )
        .await;
    assert!(
        max.ok()["checkout_url"]
            .as_str()
            .unwrap()
            .starts_with(&format!("/dev/stripe/checkout?club={club}&plan=max"))
    );
    let checkout = app
        .post(
            &format!("{sub}/checkout"),
            Some(&owner),
            json!({ "plan": "pro" }),
        )
        .await;
    assert!(
        checkout.ok()["checkout_url"]
            .as_str()
            .unwrap()
            .starts_with(&format!("/dev/stripe/checkout?club={club}&plan=pro"))
    );

    // The test checkout completes: Pro, a paid invoice, a notice to the billing owner.
    let pro = app
        .post(
            "/v1/mock/stripe/complete",
            Some(&owner),
            json!({ "club_id": club, "plan": "pro" }),
        )
        .await;
    assert_eq!(pro.ok()["plan"], "pro");
    assert_eq!(
        (&pro.body["student_limit"], &pro.body["trainer_limit"]),
        (&json!(30), &json!(2))
    );
    assert_eq!(pro.body["monthly_cents"], 1990);
    assert_eq!(pro.body["has_billing_account"], true);
    assert!(pro.body["current_period_end"].is_string());
    assert_eq!(notifications(&app, &owner).await, ["Bem-vindo ao Pro!"]);
    let inv = app
        .get(&format!("/v1/clubs/{club}/invoices"), Some(&owner))
        .await;
    assert_eq!(inv.ok()["items"][0]["amount_cents"], 1990);
    assert_eq!(inv.body["items"][0]["status"], "paid");
    let exists = app
        .post(
            &format!("{sub}/checkout"),
            Some(&owner),
            json!({ "plan": "max" }),
        )
        .await;
    exists.problem(409, "subscription.exists");
    assert_eq!(exists.body["title"], "Você já está no Pro");

    // Pro ⇄ Max right away; Max has no hard limits and bills the seats above the included ones.
    let max = app
        .post(
            &format!("{sub}/change"),
            Some(&owner),
            json!({ "plan": "max" }),
        )
        .await;
    assert_eq!(max.ok()["plan"], "max");
    assert_eq!(max.body["student_limit"], Value::Null);
    assert_eq!(max.body["included_students"], 100);
    assert_eq!(max.body["monthly_cents"], 7990);
    app.fill_seats(&club, "student", 101).await;
    app.fill_seats(&club, "trainer", 6).await;
    let extra = app.get(&sub, Some(&owner)).await;
    assert_eq!(extra.ok()["monthly_cents"], 7990 + 500 + 50);
    let small = app
        .post(
            &format!("{sub}/change"),
            Some(&owner),
            json!({ "plan": "pro" }),
        )
        .await;
    small.problem(409, "plan.too_small");
    assert_eq!(
        small.body["detail"],
        "O Pro inclui até 30 alunos e 2 treinadores; hoje o clube tem 101 alunos e 6 treinadores."
    );
    app.free_seats().await;
    assert_eq!(
        app.post(
            &format!("{sub}/change"),
            Some(&owner),
            json!({ "plan": "pro" })
        )
        .await
        .ok()["plan"],
        "pro"
    );
    assert_eq!(
        app.post(&format!("{sub}/portal"), Some(&owner), json!({}))
            .await
            .ok()["portal_url"],
        format!("/dev/stripe/portal?club={club}")
    );

    // Portal actions: a failed payment notifies; cancel at period end; once the period is over it's Free again.
    let portal = |action: &str| json!({ "club_id": club, "action": action });
    let failed = app
        .post(
            "/v1/mock/stripe/portal",
            Some(&owner),
            portal("fail_payment"),
        )
        .await;
    assert_eq!(failed.ok()["status"], "past_due");
    assert!(failed.body["grace_until"].is_string());
    assert_eq!(
        failed.body["frozen"], false,
        "usable during the grace period"
    );
    assert_eq!(
        notifications(&app, &owner).await,
        ["Não conseguimos cobrar a assinatura", "Bem-vindo ao Pro!"]
    );

    // The grace period is over: frozen for the staff (only billing and reads), never for students.
    let frozen = app
        .post("/v1/mock/stripe/portal", Some(&owner), portal("freeze"))
        .await;
    assert_eq!(frozen.ok()["frozen"], true);
    assert_eq!(
        notifications(&app, &owner).await.len(),
        2,
        "one notice per failure"
    );
    let groups = format!("/v1/clubs/{club}/groups");
    let locked = app
        .post(&groups, Some(&owner), json!({ "name": "Iniciantes" }))
        .await;
    locked.problem(423, "club.frozen");
    assert_eq!(
        locked.body["detail"],
        "O pagamento do plano está pendente. Regularize em Plano e cobrança para voltar a usar o clube."
    );
    app.get(&groups, Some(&owner)).await.ok();
    assert_eq!(app.get(&sub, Some(&ana)).await.ok()["frozen"], false);
    let me = app.get("/v1/me", Some(&ana)).await;
    assert_eq!(me.ok()["memberships"][0]["subscription"]["frozen"], false);
    let me = app.get("/v1/me", Some(&owner)).await;
    assert_eq!(me.ok()["memberships"][0]["subscription"]["frozen"], true);
    app.post(&format!("{sub}/portal"), Some(&owner), json!({}))
        .await
        .ok();
    let paid = app
        .post("/v1/mock/stripe/portal", Some(&owner), portal("pay"))
        .await;
    assert_eq!(paid.ok()["status"], "active");
    assert_eq!(
        (&paid.body["frozen"], &paid.body["grace_until"]),
        (&json!(false), &Value::Null)
    );
    assert_eq!(
        app.post(&groups, Some(&owner), json!({ "name": "Iniciantes" }))
            .await
            .status,
        201
    );
    let cancel = app
        .post("/v1/mock/stripe/portal", Some(&owner), portal("cancel"))
        .await;
    assert_eq!(cancel.ok()["cancel_at_period_end"], true);
    assert_eq!(cancel.body["plan"], "pro");
    let resumed = app
        .post("/v1/mock/stripe/portal", Some(&owner), portal("resume"))
        .await;
    assert_eq!(resumed.ok()["cancel_at_period_end"], false);
    let expired = app
        .post("/v1/mock/stripe/portal", Some(&owner), portal("expire"))
        .await;
    assert_eq!(expired.ok()["plan"], "free");
    assert_eq!(expired.body["student_limit"], 10);
    assert_eq!(expired.body["status"], "active");
    assert_eq!(expired.body["has_billing_account"], true);
    app.post("/v1/mock/stripe/portal", Some(&owner), portal("cancel"))
        .await
        .problem(409, "billing.no_subscription");
    app.post("/v1/mock/stripe/portal", Some(&owner), portal("dance"))
        .await
        .problem(409, "billing.no_subscription");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn without_stripe_or_simulation_nobody_upgrades(db: PgPool) {
    let app = TestApp::new(db).with_billing(BillingSettings::default());
    let (club, owner, _) = setup(&app).await;
    app.post(
        &format!("/v1/clubs/{club}/subscription/checkout"),
        Some(&owner),
        json!({ "plan": "pro" }),
    )
    .await
    .problem(503, "billing.unavailable");
    app.post(
        "/v1/mock/stripe/complete",
        Some(&owner),
        json!({ "club_id": club, "plan": "pro" }),
    )
    .await
    .problem(404, "route.not_found");
    app.post("/v1/webhooks/stripe", None, json!({ "id": "evt_1" }))
        .await
        .problem(404, "route.not_found");
}

/// What the fake Stripe saw (POST forms, in order) and the one subscription it holds: `(item id, price, quantity)`.
#[derive(Default)]
struct Fake {
    calls: Vec<std::collections::HashMap<String, String>>,
    items: Vec<(String, String, i64)>,
}

type Shared = State<Arc<Mutex<Fake>>>;
type FormMap = Form<std::collections::HashMap<String, String>>;

fn subscription_json(f: &Fake) -> Value {
    let lookup = |price: &str| match price {
        "price_pro" => "runflow_pro_monthly",
        "price_max" => "runflow_max_monthly",
        "price_max_trainer" => "runflow_max_extra_trainer_monthly",
        _ => "runflow_max_extra_student_monthly",
    };
    let items: Vec<Value> = f
        .items
        .iter()
        .map(|(id, price, q)| json!({ "id": id, "quantity": q, "price": { "id": price, "lookup_key": lookup(price) } }))
        .collect();
    json!({ "id": "sub_1", "items": { "data": items } })
}

async fn fake_stripe() -> (String, Arc<Mutex<Fake>>) {
    use axum::extract::Path;
    use axum::routing::get;
    let fake = Arc::new(Mutex::new(Fake::default()));
    let checkout = |State(f): Shared, headers: axum::http::HeaderMap, Form(p): FormMap| async move {
        assert_eq!(headers["authorization"], "Bearer sk_test_123");
        f.lock().unwrap().calls.push(p);
        Json(json!({ "id": "cs_1", "url": "https://checkout.stripe.com/c/pay/cs_1" }))
    };
    let portal = |State(f): Shared, Form(p): FormMap| async move {
        let customer = p.get("customer").cloned().unwrap_or_default();
        f.lock().unwrap().calls.push(p);
        if customer == "cus_gone" {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({ "error": { "message": "No such customer" } })),
            );
        }
        (
            axum::http::StatusCode::OK,
            Json(json!({ "id": "bps_1", "url": "https://billing.stripe.com/p/session/1" })),
        )
    };
    let prices = || async {
        Json(json!({ "data": [
            { "id": "price_pro", "lookup_key": "runflow_pro_monthly" },
            { "id": "price_max", "lookup_key": "runflow_max_monthly" },
            { "id": "price_max_trainer", "lookup_key": "runflow_max_extra_trainer_monthly" },
            { "id": "price_max_student", "lookup_key": "runflow_max_extra_student_monthly" } ] }))
    };
    let get_sub = |State(f): Shared| async move { Json(subscription_json(&f.lock().unwrap())) };
    // Plan change: the old items are deleted, the new ones added.
    let update_sub = |State(f): Shared, Form(p): FormMap| async move {
        let mut f = f.lock().unwrap();
        f.items.clear();
        for n in 0..10 {
            if let (Some(price), Some(q)) = (
                p.get(&format!("items[{n}][price]")),
                p.get(&format!("items[{n}][quantity]")),
            ) {
                f.items
                    .push((format!("si_new{n}"), price.clone(), q.parse().unwrap()));
            }
        }
        f.calls.push(p);
        Json(subscription_json(&f))
    };
    let add_item = |State(f): Shared, Form(p): FormMap| async move {
        let mut f = f.lock().unwrap();
        let id = format!("si_{}", f.items.len() + 10);
        f.items.push((
            id.clone(),
            p["price"].clone(),
            p["quantity"].parse().unwrap(),
        ));
        f.calls.push(p);
        Json(json!({ "id": id }))
    };
    let set_item = |State(f): Shared, Path(id): Path<String>, Form(p): FormMap| async move {
        let mut f = f.lock().unwrap();
        let q: i64 = p["quantity"].parse().unwrap();
        f.items
            .iter_mut()
            .filter(|i| i.0 == id)
            .for_each(|i| i.2 = q);
        f.calls.push(p);
        Json(json!({ "id": id }))
    };
    let del_item = |State(f): Shared, Path(id): Path<String>| async move {
        let mut f = f.lock().unwrap();
        f.items.retain(|i| i.0 != id);
        f.calls.push([("deleted".to_string(), id.clone())].into());
        Json(json!({ "id": id, "deleted": true }))
    };
    let app = Router::new()
        .route("/v1/checkout/sessions", post(checkout))
        .route("/v1/billing_portal/sessions", post(portal))
        .route(
            "/v1/billing_portal/configurations",
            get(|| async { Json(json!({ "data": [] })) }),
        )
        .route("/v1/prices", get(prices))
        .route("/v1/subscriptions/{id}", get(get_sub).post(update_sub))
        .route("/v1/subscription_items", post(add_item))
        .route(
            "/v1/subscription_items/{id}",
            post(set_item).delete(del_item),
        )
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, fake)
}

async fn deliver(app: &TestApp, event: Value) -> u16 {
    let t = chrono::Utc::now().timestamp();
    let signature = sign("whsec_test", event.to_string().as_bytes(), t);
    app.call(
        Method::POST,
        "/v1/webhooks/stripe",
        None,
        Some(event),
        &[("stripe-signature", &signature)],
    )
    .await
    .status
    .as_u16()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn stripe_checkout_portal_and_webhooks(db: PgPool) {
    let (url, fake) = fake_stripe().await;
    let app = TestApp::new(db).with_stripe(&url);
    let (club, owner, ana) = setup(&app).await;
    let sub = format!("/v1/clubs/{club}/subscription");

    // Checkout: Stripe's hosted page, with the club and the owner's e-mail.
    let checkout = app
        .post(
            &format!("{sub}/checkout"),
            Some(&owner),
            json!({ "plan": "pro" }),
        )
        .await;
    assert_eq!(
        checkout.ok()["checkout_url"],
        "https://checkout.stripe.com/c/pay/cs_1"
    );
    {
        let f = fake.lock().unwrap();
        let p = &f.calls[0];
        assert_eq!(p["mode"], "subscription");
        assert_eq!(p["line_items[0][price]"], "price_pro");
        assert_eq!(p["client_reference_id"], club);
        assert_eq!(p["subscription_data[metadata][club_id]"], club);
        assert_eq!(p["subscription_data[metadata][plan]"], "pro");
        assert_eq!(p["customer_email"], "marcos@email.com");
        assert_eq!(
            p["success_url"],
            "http://localhost:8080/club/billing?checkout=success"
        );
    }
    // The simulation is off when Stripe is on.
    app.post(
        "/v1/mock/stripe/complete",
        Some(&owner),
        json!({ "club_id": club, "plan": "pro" }),
    )
    .await
    .problem(404, "route.not_found");

    // Webhooks: unsigned or badly signed events are refused.
    let completed = json!({ "id": "evt_1", "type": "checkout.session.completed", "data": { "object": {
        "id": "cs_1", "mode": "subscription", "client_reference_id": club, "customer": "cus_1", "subscription": "sub_1" } } });
    app.call(
        Method::POST,
        "/v1/webhooks/stripe",
        None,
        Some(completed.clone()),
        &[("stripe-signature", "t=1,v1=00")],
    )
    .await
    .problem(400, "webhook.invalid_signature");
    assert_eq!(deliver(&app, completed.clone()).await, 200);
    assert_eq!(
        deliver(&app, completed).await,
        200,
        "a repeated event is accepted (and applied once)"
    );
    // The subscription event (newer API shape: the period on the item).
    let period_end = chrono::Utc::now().timestamp() + 30 * 86400;
    let updated = json!({ "id": "evt_2", "type": "customer.subscription.updated", "data": { "object": {
        "id": "sub_1", "customer": "cus_1", "status": "active", "cancel_at_period_end": false, "metadata": { "club_id": club },
        "items": { "data": [{ "current_period_end": period_end }] } } } });
    assert_eq!(deliver(&app, updated).await, 200);
    let invoice = json!({ "id": "evt_3", "type": "invoice.paid", "data": { "object": {
        "id": "in_1", "customer": "cus_1", "subscription": "sub_1", "status": "paid", "amount_paid": 2000, "amount_due": 2000,
        "currency": "brl", "hosted_invoice_url": "https://invoice.stripe.com/i/1", "period_start": 1, "period_end": 2,
        "lines": { "data": [{ "period": { "start": period_end - 30 * 86400, "end": period_end } }] } } } });
    assert_eq!(deliver(&app, invoice).await, 200);
    app.run_jobs().await;

    let pro = app.get(&sub, Some(&ana)).await;
    assert_eq!(pro.ok()["plan"], "pro");
    assert_eq!(pro.body["status"], "active");
    assert_eq!(pro.body["student_limit"], 30);
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(pro.body["current_period_end"].as_str().unwrap())
            .unwrap()
            .timestamp(),
        period_end
    );
    assert_eq!(notifications(&app, &owner).await, ["Bem-vindo ao Pro!"]);
    let inv = app
        .get(&format!("/v1/clubs/{club}/invoices"), Some(&owner))
        .await;
    assert_eq!(inv.ok()["items"].as_array().unwrap().len(), 1);
    assert_eq!(inv.body["items"][0]["currency"], "BRL");
    assert_eq!(
        inv.body["items"][0]["hosted_url"],
        "https://invoice.stripe.com/i/1"
    );

    // The portal for the club's customer.
    let portal = app
        .post(&format!("{sub}/portal"), Some(&owner), json!({}))
        .await;
    assert_eq!(
        portal.ok()["portal_url"],
        "https://billing.stripe.com/p/session/1"
    );
    assert_eq!(fake.lock().unwrap().calls[1]["customer"], "cus_1");

    // A failed renewal: past due and a notice; then the subscription ends: Free again, the customer stays.
    let failed = json!({ "id": "evt_4", "type": "invoice.payment_failed", "data": { "object": {
        "id": "in_2", "customer": "cus_1", "subscription": "sub_1", "status": "open", "amount_paid": 0, "amount_due": 2000,
        "currency": "brl", "period_start": 3, "period_end": 4 } } });
    let deleted = json!({ "id": "evt_5", "type": "customer.subscription.deleted", "data": { "object": {
        "id": "sub_1", "customer": "cus_1", "status": "canceled", "metadata": { "club_id": club } } } });
    assert_eq!(deliver(&app, failed).await, 200);
    app.run_jobs().await;
    assert_eq!(app.get(&sub, Some(&owner)).await.ok()["status"], "past_due");
    assert_eq!(
        notifications(&app, &owner).await,
        ["Não conseguimos cobrar a assinatura", "Bem-vindo ao Pro!"]
    );
    assert_eq!(deliver(&app, deleted).await, 200);
    app.run_jobs().await;
    let free = app.get(&sub, Some(&owner)).await;
    assert_eq!(free.ok()["plan"], "free");
    assert_eq!(free.body["status"], "active");
    assert_eq!(free.body["has_billing_account"], true);
    assert_eq!(
        app.get(&format!("/v1/clubs/{club}/invoices"), Some(&owner))
            .await
            .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // Stripe refusing the portal is a 502 for the app, not a crash.
    sqlx::query(
        "UPDATE club_subscriptions SET stripe_customer_id = 'cus_gone' WHERE club_id = $1::uuid",
    )
    .bind(&club)
    .execute(app.db())
    .await
    .unwrap();
    app.post(&format!("{sub}/portal"), Some(&owner), json!({}))
        .await
        .problem(502, "billing.provider_error");
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn stripe_max_seats_and_plan_changes(db: PgPool) {
    let (url, fake) = fake_stripe().await;
    let app = TestApp::new(db).with_stripe(&url);
    let (club, owner, _ana) = setup(&app).await;
    let sub = format!("/v1/clubs/{club}/subscription");

    // Checkout for Max with one trainer above the 5 included: the base price and one extra trainer seat.
    app.fill_seats(&club, "trainer", 6).await;
    app.post(
        &format!("{sub}/checkout"),
        Some(&owner),
        json!({ "plan": "max" }),
    )
    .await
    .ok();
    let c = fake.lock().unwrap().calls[0].clone();
    assert_eq!(
        (
            c["line_items[0][price]"].as_str(),
            c["line_items[0][quantity]"].as_str()
        ),
        ("price_max", "1")
    );
    assert_eq!(
        (
            c["line_items[1][price]"].as_str(),
            c["line_items[1][quantity]"].as_str()
        ),
        ("price_max_trainer", "1")
    );
    assert!(
        !c.contains_key("line_items[2][price]"),
        "no student seats above the included 100"
    );
    assert_eq!(c["subscription_data[metadata][plan]"], "max");

    // Stripe confirms: the plan comes from the subscription's prices.
    fake.lock().unwrap().items = vec![
        ("si_1".into(), "price_max".into(), 1),
        ("si_2".into(), "price_max_trainer".into(), 1),
    ];
    let completed = json!({ "id": "evt_1", "type": "checkout.session.completed", "data": { "object": {
        "mode": "subscription", "customer": "cus_1", "subscription": "sub_1", "client_reference_id": club,
        "metadata": { "club_id": club, "plan": "max" } } } });
    let updated = json!({ "id": "evt_2", "type": "customer.subscription.updated", "data": { "object": {
        "id": "sub_1", "customer": "cus_1", "status": "active", "metadata": { "club_id": club },
        "items": { "data": [{ "price": { "id": "price_max", "lookup_key": "runflow_max_monthly" }, "current_period_end": 1 }] } } } });
    assert_eq!(deliver(&app, completed).await, 200);
    assert_eq!(deliver(&app, updated).await, 200);
    app.run_jobs().await;
    let max = app.get(&sub, Some(&owner)).await;
    assert_eq!(max.ok()["plan"], "max");
    assert_eq!(max.body["monthly_cents"], 7990 + 500);
    assert_eq!(notifications(&app, &owner).await, ["Bem-vindo ao Max!"]);

    // Making Ana a trainer takes another paid seat: the worker raises the quantity on Stripe.
    let members = app
        .get(
            &format!("/v1/clubs/{club}/members?role=student"),
            Some(&owner),
        )
        .await;
    let ana_id = members.ok()["items"][0]["membership"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let member = format!("/v1/clubs/{club}/members/{ana_id}");
    app.patch(&member, Some(&owner), json!({ "role": "trainer" }))
        .await
        .ok();
    app.run_jobs().await;
    assert!(
        fake.lock()
            .unwrap()
            .items
            .contains(&("si_2".into(), "price_max_trainer".into(), 2))
    );

    // Too many trainers for Pro; with the extra trainers gone, Pro replaces Max's items, prorated.
    app.post(
        &format!("{sub}/change"),
        Some(&owner),
        json!({ "plan": "pro" }),
    )
    .await
    .problem(409, "plan.too_small");
    app.free_seats().await;
    app.patch(&member, Some(&owner), json!({ "role": "student" }))
        .await
        .ok();
    app.run_jobs().await;
    assert!(
        !fake
            .lock()
            .unwrap()
            .items
            .iter()
            .any(|i| i.1 == "price_max_trainer"),
        "no extra trainer seats left"
    );
    let pro = app
        .post(
            &format!("{sub}/change"),
            Some(&owner),
            json!({ "plan": "pro" }),
        )
        .await;
    assert_eq!(pro.ok()["plan"], "pro");
    let f = fake.lock().unwrap();
    assert_eq!(
        f.items,
        [("si_new1".to_string(), "price_pro".to_string(), 1)]
    );
    let change = f.calls.last().unwrap();
    assert_eq!(change["items[0][deleted]"], "true");
    assert_eq!(change["proration_behavior"], "create_prorations");
    assert_eq!(change["metadata[plan]"], "pro");
}

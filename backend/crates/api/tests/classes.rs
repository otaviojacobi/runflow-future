//! G3 Aulas (D-052; endpoints.md § Aulas): venues, class types, recurring schedules kept 8 weeks ahead, sessions,
//! bookings with a waitlist, check-in and attendance, the attendance report, and every membership change that frees
//! a seat. Same scenarios as api/mock/aulas-smoke.mjs.

mod common;

use chrono::{Duration, Utc};
use common::TestApp;
use serde_json::{Value, json};
use sqlx::PgPool;

struct Club {
    id: String,
    owner: String,
    owner_m: String,
}

async fn student(app: &TestApp, club: &str, owner: &str, email: &str) -> (String, String) {
    let i = app
        .post(
            &format!("/v1/clubs/{club}/invites"),
            Some(owner),
            json!({ "email": email }),
        )
        .await;
    let token = i.body["url"]
        .as_str()
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    let t = app.sign_in(email).await;
    let m = app
        .post(&format!("/v1/invites/{token}/accept"), Some(&t), json!({}))
        .await;
    (t, m.body["membership"]["id"].as_str().unwrap().to_string())
}

async fn setup(app: &TestApp) -> Club {
    let owner = app.sign_in("marcos@email.com").await;
    let created = app
        .post(
            "/v1/clubs",
            Some(&owner),
            json!({ "name": "Studio Forte", "modalities": ["mobility", "strength"] }),
        )
        .await;
    Club {
        id: created.body["club"]["id"].as_str().unwrap().to_string(),
        owner_m: created.body["membership"]["id"]
            .as_str()
            .unwrap()
            .to_string(),
        owner,
    }
}

/// A club-local (São Paulo, UTC−3) date and "HH:MM" `minutes` from now.
fn local(minutes: i64) -> (String, String) {
    let t = Utc::now() - Duration::hours(3) + Duration::minutes(minutes);
    (
        t.format("%Y-%m-%d").to_string(),
        t.format("%H:%M").to_string(),
    )
}

async fn class_type(app: &TestApp, c: &Club, name: &str, capacity: i64) -> String {
    let t = app
        .post(
            &format!("/v1/clubs/{}/class-types", c.id),
            Some(&c.owner),
            json!({ "name": name, "sport": "mobility", "default_capacity": capacity, "duration_min": 40 }),
        )
        .await;
    assert_eq!(t.status, 201, "{}", t.body);
    t.body["id"].as_str().unwrap().to_string()
}

async fn one_off(app: &TestApp, c: &Club, type_id: &str, minutes: i64) -> Value {
    let (date, time) = local(minutes);
    let s = app
        .post(
            &format!("/v1/clubs/{}/class-sessions", c.id),
            Some(&c.owner),
            json!({ "class_type_id": type_id, "date": date, "time": time }),
        )
        .await;
    assert_eq!(s.status, 201, "{}", s.body);
    s.body.clone()
}

async fn book(app: &TestApp, c: &Club, token: &str, session: &str) -> Value {
    let b = app
        .post(
            &format!("/v1/clubs/{}/class-sessions/{session}/bookings", c.id),
            Some(token),
            json!({}),
        )
        .await;
    assert_eq!(b.status, 201, "{}", b.body);
    b.body.clone()
}

async fn roster(app: &TestApp, c: &Club, session: &str) -> Vec<Value> {
    app.get(
        &format!("/v1/clubs/{}/class-sessions/{session}", c.id),
        Some(&c.owner),
    )
    .await
    .ok()["roster"]
        .as_array()
        .unwrap()
        .clone()
}

async fn notes(app: &TestApp, token: &str, kind: &str) -> Vec<Value> {
    app.get("/v1/me/notifications", Some(token)).await.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == kind)
        .cloned()
        .collect()
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn the_booking_flow(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let (ana, ana_m) = student(&app, &c.id, &c.owner, "ana@email.com").await;
    let (bia, _) = student(&app, &c.id, &c.owner, "bia@email.com").await;
    let (caio, caio_m) = student(&app, &c.id, &c.owner, "caio@email.com").await;

    // Venues and class types: everyone reads, staff write.
    let venue = app
        .post(
            &format!("/v1/clubs/{}/locations", c.id),
            Some(&c.owner),
            json!({ "name": "Sala 1", "kind": "studio" }),
        )
        .await;
    assert_eq!(venue.status, 201, "{}", venue.body);
    let bad = app
        .post(
            &format!("/v1/clubs/{}/class-types", c.id),
            Some(&c.owner),
            json!({ "name": " ", "sport": "chess", "default_capacity": 0 }),
        )
        .await;
    bad.problem(422, "validation.failed");
    let mut fields: Vec<&str> = bad.body["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    fields.sort_unstable();
    assert_eq!(
        fields,
        ["default_capacity", "duration_min", "name", "sport"]
    );
    app.post(
        &format!("/v1/clubs/{}/class-types", c.id),
        Some(&ana),
        json!({ "name": "Yoga", "sport": "mobility", "default_capacity": 5, "duration_min": 50 }),
    )
    .await
    .problem(403, "auth.forbidden");
    let ty = class_type(&app, &c, "Funcional express", 2).await;
    let types = app
        .get(&format!("/v1/clubs/{}/class-types", c.id), Some(&ana))
        .await;
    assert_eq!(types.ok()["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        app.get(&format!("/v1/clubs/{}/locations", c.id), Some(&ana))
            .await
            .ok()["items"][0]["name"],
        "Sala 1"
    );

    // A two-seat class in 30 minutes: a code and a QR link for the staff only.
    let s = one_off(&app, &c, &ty, 30).await;
    let sid = s["id"].as_str().unwrap().to_string();
    let code = s["checkin_code"].as_str().unwrap().to_string();
    assert!(
        code.len() == 6
            && code
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_lowercase()),
        "{code}"
    );
    assert_eq!(
        s["checkin_url"],
        format!("http://localhost:8080/classes/check-in?session={sid}&code={code}")
    );
    let (today, _) = local(0);
    let (later, _) = local(13 * 24 * 60);
    let listed = app
        .get(
            &format!("/v1/clubs/{}/class-sessions?from={today}&to={later}", c.id),
            Some(&ana),
        )
        .await;
    let item = listed.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == sid.as_str())
        .cloned()
        .unwrap();
    assert!(item.get("checkin_code").is_none() && item.get("roster").is_none());
    assert_eq!(item["class_type"]["name"], "Funcional express");
    assert_eq!(
        (item["booked"].clone(), item["waitlist"].clone()),
        (json!(0), json!(0))
    );
    app.get(&format!("/v1/clubs/{}/class-sessions", c.id), Some(&ana))
        .await
        .problem(422, "validation.failed");

    // Two seats, then the waitlist; booking twice and booking a staff member are refused.
    let b1 = book(&app, &c, &ana, &sid).await;
    let b2 = book(&app, &c, &bia, &sid).await;
    let b3 = book(&app, &c, &caio, &sid).await;
    assert_eq!(
        (b1["status"].as_str(), b2["status"].as_str()),
        (Some("booked"), Some("booked"))
    );
    assert_eq!(b3["status"], "waitlisted");
    assert_eq!(b3["waitlist_position"], 1);
    let again = app
        .post(
            &format!("/v1/clubs/{}/class-sessions/{sid}/bookings", c.id),
            Some(&caio),
            json!({}),
        )
        .await;
    again.problem(409, "booking.exists");
    assert_eq!(again.body["detail"], "Na lista de espera, posição 1.");
    app.post(
        &format!("/v1/clubs/{}/class-sessions/{sid}/bookings", c.id),
        Some(&c.owner),
        json!({ "membership_id": c.owner_m }),
    )
    .await
    .problem(422, "validation.failed");
    let mine = app
        .get(
            &format!("/v1/clubs/{}/class-sessions/{sid}", c.id),
            Some(&caio),
        )
        .await;
    assert_eq!(mine.ok()["my_booking"]["status"], "waitlisted");
    assert!(mine.body.get("roster").is_none());

    // Bia cancels: Caio takes the seat and hears about it, pushed by default.
    let cancelled = app
        .delete(
            &format!("/v1/clubs/{}/bookings/{}", c.id, b2["id"].as_str().unwrap()),
            Some(&bia),
        )
        .await;
    assert_eq!(cancelled.status, 204);
    let r = roster(&app, &c, &sid).await;
    let caio_row = r
        .iter()
        .find(|x| x["membership_id"] == caio_m.as_str())
        .unwrap();
    assert_eq!(caio_row["status"], "booked");
    assert!(caio_row["waitlist_position"].is_null());
    assert_eq!(caio_row["athlete"]["user"]["email"], "caio@email.com");
    let promoted = notes(&app, &caio, "waitlist_promoted").await;
    assert_eq!(promoted.len(), 1);
    assert_eq!(promoted[0]["link"], format!("/classes?session={sid}"));
    assert_eq!(promoted[0]["title"], "Você saiu da lista de espera");
    let pushed: bool = sqlx::query_scalar(
        "SELECT push_at IS NOT NULL FROM notifications WHERE kind = 'waitlist_promoted'",
    )
    .fetch_one(app.db())
    .await
    .unwrap();
    assert!(!pushed, "no device registered: in the center only");
    let prefs = app.get("/v1/me/prefs", Some(&caio)).await;
    assert_eq!(prefs.ok()["kinds"]["waitlist_promoted"]["push"], true);
    assert_eq!(prefs.ok()["kinds"]["class_cancelled"]["push"], true);

    // Check-in: a wrong code, then the right one (any case) 30 minutes before the start.
    app.post(
        &format!("/v1/clubs/{}/class-sessions/{sid}/check-in", c.id),
        Some(&ana),
        json!({ "checkin_code": "ZZZZZZ" }),
    )
    .await
    .problem(400, "checkin.invalid_code");
    let checked = app
        .post(
            &format!("/v1/clubs/{}/class-sessions/{sid}/check-in", c.id),
            Some(&ana),
            json!({ "checkin_code": code.to_lowercase() }),
        )
        .await;
    assert_eq!(checked.ok()["status"], "attended");
    assert!(checked.body["checked_in_at"].is_string());
    app.post(
        &format!("/v1/clubs/{}/class-sessions/{sid}/check-in", c.id),
        Some(&c.owner),
        json!({ "checkin_code": code }),
    )
    .await
    .problem(403, "auth.forbidden");
    let far = one_off(&app, &c, &ty, 3 * 60).await;
    let far_id = far["id"].as_str().unwrap().to_string();
    app.post(
        &format!("/v1/clubs/{}/class-sessions/{far_id}/check-in", c.id),
        Some(&ana),
        json!({ "checkin_code": far["checkin_code"] }),
    )
    .await
    .problem(409, "checkin.window");

    // Attendance is the staff's.
    let caio_booking = caio_row["id"].as_str().unwrap();
    app.patch(
        &format!("/v1/clubs/{}/bookings/{caio_booking}", c.id),
        Some(&caio),
        json!({ "status": "attended" }),
    )
    .await
    .problem(403, "auth.forbidden");
    app.patch(
        &format!("/v1/clubs/{}/bookings/{caio_booking}", c.id),
        Some(&c.owner),
        json!({ "status": "late" }),
    )
    .await
    .problem(422, "validation.failed");
    let ns = app
        .patch(
            &format!("/v1/clubs/{}/bookings/{caio_booking}", c.id),
            Some(&c.owner),
            json!({ "status": "no_show" }),
        )
        .await;
    assert_eq!(ns.ok()["status"], "no_show");

    // A class that already started: the student can't cancel any more; staff mark her attended.
    let started = one_off(&app, &c, &ty, -10).await;
    let started_id = started["id"].as_str().unwrap().to_string();
    let late = book(&app, &c, &bia, &started_id).await;
    app.delete(
        &format!(
            "/v1/clubs/{}/bookings/{}",
            c.id,
            late["id"].as_str().unwrap()
        ),
        Some(&bia),
    )
    .await
    .problem(409, "booking.started");
    let att = app
        .patch(
            &format!(
                "/v1/clubs/{}/bookings/{}",
                c.id,
                late["id"].as_str().unwrap()
            ),
            Some(&c.owner),
            json!({ "status": "attended" }),
        )
        .await;
    assert_eq!(att.ok()["status"], "attended");
    assert!(att.body["checked_in_at"].is_string());

    // Staff cancel the far class with a reason: everyone booked is told; students stop seeing it; no new bookings.
    book(&app, &c, &bia, &far_id).await;
    let cancel = app
        .patch(
            &format!("/v1/clubs/{}/class-sessions/{far_id}", c.id),
            Some(&c.owner),
            json!({ "status": "cancelled", "cancel_reason": "Chuva forte" }),
        )
        .await;
    assert_eq!(cancel.ok()["status"], "cancelled");
    assert_eq!(cancel.body["cancel_reason"], "Chuva forte");
    assert_eq!(cancel.body["roster"], json!([]));
    let told = notes(&app, &bia, "class_cancelled").await;
    assert_eq!(told.len(), 1);
    assert!(
        told[0]["body"].as_str().unwrap().ends_with(": Chuva forte"),
        "{}",
        told[0]
    );
    let after = app
        .get(
            &format!("/v1/clubs/{}/class-sessions?from={today}&to={later}", c.id),
            Some(&bia),
        )
        .await;
    assert!(
        !after.ok()["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["id"] == far_id.as_str())
    );
    let staff_list = app
        .get(
            &format!("/v1/clubs/{}/class-sessions?from={today}&to={later}", c.id),
            Some(&c.owner),
        )
        .await;
    assert!(
        staff_list.ok()["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["id"] == far_id.as_str())
    );
    app.post(
        &format!("/v1/clubs/{}/class-sessions/{far_id}/bookings", c.id),
        Some(&caio),
        json!({}),
    )
    .await
    .problem(409, "session.cancelled");
    app.patch(
        &format!("/v1/clubs/{}/class-sessions/{far_id}", c.id),
        Some(&c.owner),
        json!({ "status": "scheduled" }),
    )
    .await
    .problem(422, "validation.failed");

    // Raising a capacity promotes the waitlist.
    let tiny_type = class_type(&app, &c, "Turma de um", 1).await;
    let tiny = one_off(&app, &c, &tiny_type, 24 * 60).await;
    let tiny_id = tiny["id"].as_str().unwrap().to_string();
    book(&app, &c, &ana, &tiny_id).await;
    let waits = book(&app, &c, &bia, &tiny_id).await;
    assert_eq!(waits["status"], "waitlisted");
    let raised = app
        .patch(
            &format!("/v1/clubs/{}/class-sessions/{tiny_id}", c.id),
            Some(&c.owner),
            json!({ "capacity": 2, "notes": "Traga toalha" }),
        )
        .await;
    assert_eq!(raised.ok()["capacity"], 2);
    assert_eq!(raised.body["notes"], "Traga toalha");
    assert_eq!(
        (
            raised.body["booked"].clone(),
            raised.body["waitlist"].clone()
        ),
        (json!(2), json!(0))
    );

    // Hoje: Ana's next class; the dashboard's upcoming classes; the attendance report counts the held class only.
    let summary = app
        .get(&format!("/v1/clubs/{}/my/summary", c.id), Some(&ana))
        .await;
    assert_eq!(
        summary.ok()["next_class"]["session"]["id"],
        tiny_id.as_str()
    );
    assert!(
        summary.body["next_class"]["session"]
            .get("checkin_code")
            .is_none()
    );
    assert_eq!(
        summary.body["next_class"]["class_type"]["name"],
        "Turma de um"
    );
    let dash = app
        .get(&format!("/v1/clubs/{}/dashboard", c.id), Some(&c.owner))
        .await;
    let upcoming = dash.ok()["upcoming_classes"].as_array().unwrap();
    assert!(!upcoming.is_empty() && upcoming.len() <= 3);
    assert_eq!(upcoming[0]["session"]["id"], sid.as_str());
    let report = app
        .get(
            &format!("/v1/clubs/{}/reports/attendance", c.id),
            Some(&c.owner),
        )
        .await;
    let totals = &report.ok()["totals"];
    assert_eq!(totals["sessions"], 1, "{}", report.body);
    assert_eq!(totals["attended"], 1);
    assert_eq!(totals["attendance_pct"], 100);
    assert_eq!(totals["occupancy_pct"], 50);
    assert_eq!(report.body["by_type"].as_array().unwrap().len(), 1);
    assert_eq!(report.body["athletes"][0]["user"]["email"], "bia@email.com");
    app.get(
        &format!("/v1/clubs/{}/reports/attendance", c.id),
        Some(&ana),
    )
    .await
    .problem(403, "auth.forbidden");

    // The export carries the bookings.
    let export = app.get("/v1/me/export", Some(&ana)).await;
    assert!(export.ok()["class_bookings"].as_array().unwrap().len() >= 2);
    let _ = ana_m;
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn schedules_stay_eight_weeks_ahead(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let (ana, _) = student(&app, &c.id, &c.owner, "ana@email.com").await;
    let ty = class_type(&app, &c, "Pilates", 8).await;
    let path = format!("/v1/clubs/{}/class-schedules", c.id);

    let bad = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "class_type_id": ty, "weekdays": [9], "start_time": "25:00", "capacity": 0 }),
        )
        .await;
    bad.problem(422, "validation.failed");
    let mut fields: Vec<&str> = bad.body["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    fields.sort_unstable();
    assert_eq!(fields, ["capacity", "start_time", "weekdays"]);
    app.post(
        &path,
        Some(&c.owner),
        json!({ "class_type_id": "nope", "weekdays": [1], "start_time": "07:00" }),
    )
    .await
    .problem(404, "class_type.not_found");

    // Saturday 08:00: about 8 weeks of sessions, the class type's capacity.
    let rule = app
        .post(
            &path,
            Some(&c.owner),
            json!({ "class_type_id": ty, "weekdays": [6, 6], "start_time": "08:00" }),
        )
        .await;
    assert_eq!(rule.status, 201, "{}", rule.body);
    let items = rule.body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["start_time"], "08:00");
    assert_eq!(items[0]["capacity"], 8);
    assert_eq!(items[0]["class_type"]["name"], "Pilates");
    let created = rule.body["sessions"].as_i64().unwrap();
    assert!((8..=9).contains(&created), "{created}");
    let rule_id = items[0]["id"].as_str().unwrap().to_string();
    let count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM class_sessions WHERE schedule_id = $1::uuid",
        )
        .bind(&rule_id)
        .fetch_one(app.db())
        .await
        .unwrap()
    };
    assert_eq!(count().await, created);
    // Every start is Saturday 08:00 in club time.
    let wrong: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM class_sessions s JOIN clubs c ON c.id = s.club_id
          WHERE s.schedule_id = $1::uuid
            AND (extract(isodow FROM s.starts_at AT TIME ZONE c.timezone) <> 6
                 OR to_char(s.starts_at AT TIME ZONE c.timezone, 'HH24:MI') <> '08:00')",
    )
    .bind(&rule_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(wrong, 0);
    assert_eq!(
        app.get(&path, Some(&c.owner)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    app.get(&path, Some(&ana))
        .await
        .problem(403, "auth.forbidden");

    // The worker keeps the window: nothing new today however often it runs; a week later, one more Saturday.
    app.tick(Utc::now()).await;
    app.tick(Utc::now()).await;
    assert_eq!(count().await, created);
    app.tick(Utc::now() + Duration::days(7)).await;
    assert_eq!(count().await, created + 1);

    // Ana books the next Saturday; ending the rule cancels every future session and tells her.
    let first: String = sqlx::query_scalar(
        "SELECT id::text FROM class_sessions WHERE schedule_id = $1::uuid AND starts_at > now() ORDER BY starts_at LIMIT 1",
    )
    .bind(&rule_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    book(&app, &c, &ana, &first).await;
    let future: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM class_sessions WHERE schedule_id = $1::uuid AND starts_at > now()",
    )
    .bind(&rule_id)
    .fetch_one(app.db())
    .await
    .unwrap();
    let ended = app
        .delete(&format!("{path}/{rule_id}"), Some(&c.owner))
        .await;
    assert_eq!(ended.ok()["cancelled_sessions"], future);
    let told = notes(&app, &ana, "class_cancelled").await;
    assert_eq!(told.len(), 1);
    assert!(
        told[0]["body"]
            .as_str()
            .unwrap()
            .ends_with(": o horário deixou de existir")
    );
    assert_eq!(
        app.get(&path, Some(&c.owner)).await.ok()["items"],
        json!([])
    );
    app.delete(&format!("{path}/{rule_id}x"), Some(&c.owner))
        .await
        .problem(404, "schedule.not_found");

    // An ended rule never grows again.
    let before = count().await;
    app.tick(Utc::now() + Duration::days(14)).await;
    assert_eq!(count().await, before);
}

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn frozen_clubs_and_leaving_free_seats(db: PgPool) {
    let app = TestApp::new(db);
    let c = setup(&app).await;
    let (ana, ana_m) = student(&app, &c.id, &c.owner, "ana@email.com").await;
    let (bia, bia_m) = student(&app, &c.id, &c.owner, "bia@email.com").await;
    let (caio, caio_m) = student(&app, &c.id, &c.owner, "caio@email.com").await;
    let (dani, dani_m) = student(&app, &c.id, &c.owner, "dani@email.com").await;
    let ty = class_type(&app, &c, "Turma de um", 1).await;

    // One seat; Ana has it, the others wait in line.
    let s = one_off(&app, &c, &ty, 26 * 60).await;
    let sid = s["id"].as_str().unwrap().to_string();
    book(&app, &c, &ana, &sid).await;
    for t in [&bia, &caio, &dani] {
        assert_eq!(book(&app, &c, t, &sid).await["status"], "waitlisted");
    }
    let seated = |r: &[Value]| -> Vec<String> {
        r.iter()
            .filter(|x| x["status"] == "booked")
            .map(|x| x["membership_id"].as_str().unwrap().to_string())
            .collect()
    };

    // Suspended by the owner: the seat goes to Bia.
    let suspend = app
        .patch(
            &format!("/v1/clubs/{}/members/{ana_m}", c.id),
            Some(&c.owner),
            json!({ "status": "suspended" }),
        )
        .await;
    assert_eq!(suspend.status, 200, "{}", suspend.body);
    let r = roster(&app, &c, &sid).await;
    assert_eq!(seated(&r), vec![bia_m.clone()]);
    assert_eq!(notes(&app, &bia, "waitlist_promoted").await.len(), 1);

    // Removed by the owner: Caio's turn.
    let removed = app
        .delete(
            &format!("/v1/clubs/{}/members/{bia_m}", c.id),
            Some(&c.owner),
        )
        .await;
    assert_eq!(removed.status, 204, "{}", removed.body);
    assert_eq!(seated(&roster(&app, &c, &sid).await), vec![caio_m.clone()]);

    // Caio leaves the club: Dani's turn, first in the (renumbered) line.
    let r = roster(&app, &c, &sid).await;
    assert_eq!(
        r.iter()
            .find(|x| x["membership_id"] == dani_m.as_str())
            .unwrap()["waitlist_position"],
        1
    );
    let left = app
        .post(&format!("/v1/clubs/{}/leave", c.id), Some(&caio), json!({}))
        .await;
    assert_eq!(left.status, 204, "{}", left.body);
    assert_eq!(seated(&roster(&app, &c, &sid).await), vec![dani_m.clone()]);

    // Deleting the account frees the seat too.
    let (eva, eva_m) = student(&app, &c.id, &c.owner, "eva@email.com").await;
    let two = one_off(&app, &c, &ty, 27 * 60).await;
    let two_id = two["id"].as_str().unwrap().to_string();
    book(&app, &c, &dani, &two_id).await;
    book(&app, &c, &eva, &two_id).await;
    let gone = app.delete("/v1/me", Some(&dani)).await;
    assert_eq!(gone.status, 204, "{}", gone.body);
    assert_eq!(
        seated(&roster(&app, &c, &two_id).await),
        vec![eva_m.clone()]
    );

    // Frozen (unpaid past the grace period): staff writes answer 423, reads work, students keep booking.
    sqlx::query(
        "UPDATE club_subscriptions SET plan = 'pro', status = 'past_due', past_due_since = now() - interval '8 days'
          WHERE club_id = $1::uuid",
    )
    .bind(&c.id)
    .execute(app.db())
    .await
    .unwrap();
    app.post(
        &format!("/v1/clubs/{}/class-types", c.id),
        Some(&c.owner),
        json!({ "name": "Yoga", "sport": "mobility", "default_capacity": 5, "duration_min": 50 }),
    )
    .await
    .problem(423, "club.frozen");
    app.patch(
        &format!("/v1/clubs/{}/class-sessions/{two_id}", c.id),
        Some(&c.owner),
        json!({ "status": "cancelled" }),
    )
    .await
    .problem(423, "club.frozen");
    assert_eq!(
        app.get(
            &format!("/v1/clubs/{}/class-sessions/{two_id}", c.id),
            Some(&c.owner)
        )
        .await
        .status,
        200
    );
    let three = sqlx::query_scalar::<_, String>(
        "INSERT INTO class_sessions (club_id, class_type_id, starts_at, ends_at, capacity, checkin_code)
         VALUES ($1::uuid, $2::uuid, now() + interval '1 day', now() + interval '1 day 40 minutes', 3, 'ABC123')
         RETURNING id::text",
    )
    .bind(&c.id)
    .bind(&ty)
    .fetch_one(app.db())
    .await
    .unwrap();
    assert_eq!(book(&app, &c, &eva, &three).await["status"], "booked");
    let _ = ana;
}

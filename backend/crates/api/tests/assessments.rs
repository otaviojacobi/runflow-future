//! S6c assessments (W14, W3, M7): the server computes the result; a test can create zones and update the profile;
//! students read their own. Same behavior as api/mock/routes/assessments.mjs.

mod common;

use common::TestApp;
use serde_json::json;
use sqlx::PgPool;

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

#[sqlx::test(migrator = "runflow_db::MIGRATOR")]
async fn tests_compute_results_and_zones(db: PgPool) {
    let app = TestApp::new(db);
    let owner = app.sign_in("marcos@email.com").await;
    let club = app
        .post(
            "/v1/clubs",
            Some(&owner),
            json!({ "name": "Pace Forte", "modalities": ["run", "swim"] }),
        )
        .await
        .body["club"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (ana, ana_m) = student(&app, &club, &owner, "ana@email.com").await;
    let (bia, bia_m) = student(&app, &club, &owner, "bia@email.com").await;
    let path = format!("/v1/clubs/{club}/assessments");
    let profile = format!("/v1/clubs/{club}/athletes/{ana_m}");

    // Validation: athlete, kind, date (not in the future) and the kind's data.
    let bad = app
        .post(
            &path,
            Some(&owner),
            json!({ "kind": "yoga", "date": "2999-01-01" }),
        )
        .await;
    bad.problem(422, "validation.failed");
    let fields: Vec<&str> = bad.body["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, ["membership_id", "kind", "date"]);
    let bad = app
        .post(
            &path,
            Some(&owner),
            json!({ "membership_id": ana_m, "kind": "css", "date": "2026-10-01", "data": { "t400_s": 360, "t200_s": 400 } }),
        )
        .await;
    bad.problem(422, "validation.failed");
    assert_eq!(bad.body["errors"][0]["field"], "data.t200_s");
    app.post(
        &path,
        Some(&ana),
        json!({ "membership_id": ana_m, "kind": "hr_max", "date": "2026-10-01", "data": { "max_hr": 190 } }),
    )
    .await
    .problem(403, "auth.forbidden");

    // A Cooper test applied: result, pace zones from the test date, threshold pace on the profile.
    let cooper = app
        .post(
            &path,
            Some(&owner),
            json!({ "membership_id": ana_m, "kind": "cooper", "date": "2026-10-01", "data": { "distance_m": 2800 },
                    "notes": " Pista molhada ", "apply_zones": true }),
        )
        .await;
    assert_eq!(cooper.status.as_u16(), 201);
    let cooper_id = cooper.body["id"].as_str().unwrap().to_string();
    assert_eq!(
        cooper.body["result"],
        json!({ "vo2max": 51.3, "threshold_pace_s_per_km": 278 })
    );
    assert_eq!(cooper.body["notes"], "Pista molhada");
    assert_eq!(cooper.body["athlete"]["user"]["email"], "ana@email.com");
    assert_eq!(cooper.body["zones"]["kind"], "pace");
    assert_eq!(cooper.body["zones"]["source"], "test");
    assert_eq!(cooper.body["zones"]["valid_from"], "2026-10-01");
    assert_eq!(
        cooper.body["zones"]["bounds"][3],
        json!({ "zone": 4, "min": 261, "max": 278 })
    );
    let p = app.get(&profile, Some(&owner)).await;
    assert_eq!(p.ok()["profile"]["threshold_pace_s_per_km"], 278);

    // Without apply_zones nothing else changes; a CSS test rounds into the profile when applied.
    let plain = app
        .post(
            &path,
            Some(&owner),
            json!({ "membership_id": ana_m, "kind": "hr_max", "date": "2026-10-02", "data": { "max_hr": 190 } }),
        )
        .await;
    assert!(plain.ok()["zones"].is_null());
    app.post(
        &path,
        Some(&owner),
        json!({ "membership_id": ana_m, "kind": "css", "date": "2026-10-03", "data": { "t400_s": 361, "t200_s": 170 }, "apply_zones": true }),
    )
    .await
    .ok();
    let p = app.get(&profile, Some(&owner)).await;
    assert!(p.ok()["profile"]["max_hr"].is_null());
    assert_eq!(p.body["profile"]["css_s_per_100m"], 96);

    // Lists: newest first, filters; the student reads only her own.
    let all = app.get(&path, Some(&owner)).await;
    let kinds: Vec<&str> = all.ok()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["css", "hr_max", "cooper"]);
    assert_eq!(
        app.get(&format!("{path}?kind=cooper"), Some(&owner))
            .await
            .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        app.get(&format!("{path}?membership_id={bia_m}"), Some(&owner))
            .await
            .ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let mine = format!("/v1/clubs/{club}/my/assessments");
    assert_eq!(
        app.get(&mine, Some(&ana)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        app.get(&mine, Some(&bia)).await.ok()["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    app.get(&mine, Some(&owner))
        .await
        .problem(403, "auth.forbidden");
    app.get(&path, Some(&ana))
        .await
        .problem(403, "auth.forbidden");

    // Deleting keeps the zones it created.
    assert_eq!(
        app.delete(&format!("{path}/{cooper_id}"), Some(&owner))
            .await
            .status
            .as_u16(),
        204
    );
    app.delete(&format!("{path}/{cooper_id}"), Some(&owner))
        .await
        .problem(404, "assessment.not_found");
    let p = app.get(&profile, Some(&owner)).await;
    assert!(
        p.ok()["zones"]
            .as_array()
            .unwrap()
            .iter()
            .any(|z| z["kind"] == "pace")
    );
}

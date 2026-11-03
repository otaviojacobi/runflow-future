//! Plans by seats (D-043): the catalog in `api/plans.json` (synced to `backend/assets`), seat limits, the monthly
//! price with Max's extra seats, the pt-BR seat messages and when a club is frozen. Same rules as the mock
//! (`api/mock/server.mjs` → `subscription`, `ensureSeat`).

use std::sync::LazyLock;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extra {
    pub trainer_cents: i64,
    pub student_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub price_cents: i64,
    pub owners: i64,
    pub trainers: i64,
    pub students: i64,
    /// Max: seats above the included ones are charged; `None` = hard limits (Free, Pro).
    pub extra: Option<Extra>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub readme: String,
    pub currency: String,
    pub grace_days: i64,
    pub plans: Vec<Plan>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../assets/plans.json")).expect("assets/plans.json")
});

pub fn catalog() -> &'static Catalog {
    &CATALOG
}

/// A plan by id (`free` when unknown).
pub fn plan(id: &str) -> &'static Plan {
    let c = catalog();
    c.plans.iter().find(|p| p.id == id).unwrap_or(&c.plans[0])
}

/// Hard limits `(students, trainers)`; `None` = no limit (Max bills extra seats).
pub fn limits(p: &Plan) -> (Option<i64>, Option<i64>) {
    match p.extra {
        Some(_) => (None, None),
        None => (Some(p.students), Some(p.trainers)),
    }
}

/// The plan's price plus Max's extra seats.
pub fn monthly_cents(p: &Plan, students: i64, trainers: i64) -> i64 {
    p.price_cents
        + p.extra.as_ref().map_or(0, |e| {
            (trainers - p.trainers).max(0) * e.trainer_cents
                + (students - p.students).max(0) * e.student_cents
        })
}

fn trainers_text(n: i64) -> String {
    if n == 1 {
        "1 treinador".into()
    } else {
        format!("{n} treinadores")
    }
}

/// `Some((title, detail))` when `adding` more of `role` wouldn't fit the plan's hard limit (`409 plan.limit_reached`).
pub fn seat_full(p: &Plan, role: &str, used: i64, adding: i64) -> Option<(&'static str, String)> {
    let (students, trainers) = limits(p);
    let (limit, title, what) = match role {
        "trainer" => (
            trainers?,
            "Limite de treinadores atingido",
            trainers_text(trainers?),
        ),
        _ => (
            students?,
            "Limite de alunos atingido",
            format!("{} alunos", students?),
        ),
    };
    (used + adding > limit).then(|| {
        (
            title,
            format!("O plano {} inclui {what}. Faça upgrade em Plano e cobrança para liberar mais vagas.", p.name),
        )
    })
}

/// `Some((title, detail))` when a club with these members doesn't fit `p` (`409 plan.too_small`).
pub fn too_small(p: &Plan, students: i64, trainers: i64) -> Option<(String, String)> {
    (p.extra.is_none() && (students > p.students || trainers > p.trainers)).then(|| {
        (
            format!("O clube não cabe no {}", p.name),
            format!(
                "O {} inclui até {} alunos e {}; hoje o clube tem {students} alunos e {}.",
                p.name,
                p.students,
                trainers_text(p.trainers),
                trainers_text(trainers)
            ),
        )
    })
}

/// The grace period's end for a past-due paid plan.
pub fn grace_until(status: &str, past_due_since: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    (status == "past_due")
        .then_some(past_due_since)
        .flatten()
        .map(|t| t + Duration::days(catalog().grace_days))
}

/// Frozen for its staff: unpaid past the grace period, or more members than the plan's hard limits.
pub fn frozen(
    p: &Plan,
    grace_until: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    students: i64,
    trainers: i64,
) -> bool {
    let unpaid = p.id != "free" && grace_until.is_some_and(|g| g <= now);
    let (s, t) = limits(p);
    let over = s.is_some_and(|s| students > s) || t.is_some_and(|t| trainers > t);
    unpaid || over
}

/// The billing owner's notice when a plan starts: `(title, body)` in pt-BR.
pub fn welcome(p: &Plan) -> (String, String) {
    let holds = match p.extra {
        Some(_) => format!(
            "{} alunos e {} incluídos, e vagas extras cobradas por pessoa.",
            p.students,
            trainers_text(p.trainers)
        ),
        None => format!("até {} alunos e {}.", p.students, trainers_text(p.trainers)),
    };
    (
        format!("Bem-vindo ao {}!", p.name),
        format!("Agora o clube tem {holds}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog() {
        let ids: Vec<&str> = catalog().plans.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["free", "pro", "max"]);
        assert_eq!(plan("nope").id, "free");
        assert_eq!(limits(plan("free")), (Some(10), Some(1)));
        assert_eq!(limits(plan("pro")), (Some(30), Some(2)));
        assert_eq!(limits(plan("max")), (None, None));
    }

    #[test]
    fn prices_with_extra_seats() {
        assert_eq!(monthly_cents(plan("pro"), 29, 2), 2000);
        assert_eq!(monthly_cents(plan("max"), 100, 5), 5900);
        // 2 extra trainers, 20 extra students.
        assert_eq!(monthly_cents(plan("max"), 120, 7), 5900 + 2 * 500 + 20 * 50);
    }

    #[test]
    fn seats_and_messages() {
        let free = plan("free");
        assert!(seat_full(free, "student", 9, 1).is_none());
        let (title, detail) = seat_full(free, "student", 10, 1).unwrap();
        assert_eq!(title, "Limite de alunos atingido");
        assert_eq!(
            detail,
            "O plano Free inclui 10 alunos. Faça upgrade em Plano e cobrança para liberar mais vagas."
        );
        assert_eq!(
            seat_full(free, "trainer", 1, 1).unwrap().1,
            "O plano Free inclui 1 treinador. Faça upgrade em Plano e cobrança para liberar mais vagas."
        );
        assert!(seat_full(plan("max"), "trainer", 40, 1).is_none());
        assert_eq!(
            too_small(plan("pro"), 40, 1).unwrap().1,
            "O Pro inclui até 30 alunos e 2 treinadores; hoje o clube tem 40 alunos e 1 treinador."
        );
        assert!(too_small(plan("max"), 400, 9).is_none());
    }

    #[test]
    fn freezing() {
        let now = Utc::now();
        let pro = plan("pro");
        let g = grace_until("past_due", Some(now - Duration::days(3))).unwrap();
        assert!(!frozen(pro, Some(g), now, 10, 1), "within the grace period");
        let g = grace_until("past_due", Some(now - Duration::days(8)));
        assert!(frozen(pro, g, now, 10, 1), "past the grace period");
        assert!(grace_until("active", Some(now)).is_none());
        assert!(
            frozen(plan("free"), None, now, 25, 1),
            "more students than Free allows"
        );
        assert!(!frozen(plan("max"), None, now, 250, 9));
    }

    #[test]
    fn welcome_notices() {
        assert_eq!(
            welcome(plan("pro")).1,
            "Agora o clube tem até 30 alunos e 2 treinadores."
        );
        assert_eq!(
            welcome(plan("max")),
            (
                "Bem-vindo ao Max!".into(),
                "Agora o clube tem 100 alunos e 5 treinadores incluídos, e vagas extras cobradas por pessoa.".into()
            )
        );
    }
}

//! Activity matching (D-049, docs/activity-matching.md): which planned workout a synced or logged activity was.
//! Pure: the caller gathers one student's open activities and open workouts (§ Scope in the doc); the result is the
//! links to make and the questions to ask. Port of `api/mock/lib/matching.mjs`; both must give the outputs in
//! `api/activity-match-examples.json` (synced to `assets/`, proven by `tests/matching.rs`).

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// An activity can be a workout planned up to 2 days before or after it.
pub const MAX_DAYS: i64 = 2;
/// Cost per day away from the planned date.
pub const DAY_COST: i64 = 500;
/// Size cost when neither distance nor time can be compared.
pub const UNKNOWN_SIZE: i64 = 300;
/// Cap on the size cost.
pub const MAX_SIZE: i64 = 2000;
/// On another day, |ln(actual ÷ planned)| must be ≤ 0.5 (≈ 61%–165%).
pub const PLAUSIBLE_SIZE: i64 = 500;
/// A rival this close to the best makes the engine ask.
pub const MARGIN: i64 = 250;
pub const MAX_OPTIONS: usize = 3;
/// Only activities of the last 7 days become questions; older doubts stay unmatched.
pub const ASK_DAYS: i64 = 7;
/// An automatic match at ≥ 80% is "completed", below it "partial".
pub const COMPLETED_PCT: i32 = 80;

/// An activity as the engine sees it: `day` is its club-time date.
#[derive(Debug, Clone, Deserialize)]
pub struct Act {
    pub id: String,
    pub day: NaiveDate,
    pub sport: String,
    #[serde(default)]
    pub distance_m: Option<i64>,
    pub duration_s: i64,
    #[serde(default)]
    pub moving_time_s: Option<i64>,
    /// The clubs this activity may be matched to (the ones the student shares it with, D-011); `None` = any.
    #[serde(default)]
    pub clubs: Option<Vec<String>>,
}

/// A planned workout as the engine sees it.
#[derive(Debug, Clone, Deserialize)]
pub struct Planned {
    pub id: String,
    pub date: NaiveDate,
    pub sport: String,
    #[serde(default)]
    pub est_distance_m: Option<i64>,
    #[serde(default)]
    pub est_duration_s: Option<i64>,
    #[serde(default)]
    pub club_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    pub activity_id: String,
    pub workout_id: String,
    pub compliance_pct: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
    pub activity_id: String,
    /// Best first.
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Solution {
    pub links: Vec<Link>,
    pub pending: Vec<Pending>,
}

fn positive(v: Option<i64>) -> Option<f64> {
    v.filter(|v| *v > 0).map(|v| v as f64)
}

/// Whole days from `b` to `a`.
pub fn days(a: NaiveDate, b: NaiveDate) -> i64 {
    (a - b).num_days()
}

fn gym(s: &str) -> bool {
    s == "strength" || s == "mobility"
}

/// Same sport, or both from the gym family (a functional circuit often reaches Strava as "Workout" = strength).
pub fn compatible(a: &str, b: &str) -> bool {
    a == b || (gym(a) && gym(b))
}

/// actual ÷ planned: distance when both have one, else time (moving time when known) against the planned time.
pub fn ratio(act: &Act, w: &Planned) -> Option<f64> {
    if let (Some(est), Some(d)) = (positive(w.est_distance_m), positive(act.distance_m)) {
        return Some(d / est);
    }
    let est_s = positive(w.est_duration_s)?;
    let time = positive(act.moving_time_s).unwrap_or(act.duration_s as f64);
    Some(time / est_s)
}

/// Compliance of a linked workout: the ratio as a percentage (0–200), 100 when nothing can be compared.
pub fn compliance(act: &Act, w: &Planned) -> i32 {
    match ratio(act, w) {
        None => 100,
        Some(r) => (r * 100.0).round().clamp(0.0, 200.0) as i32,
    }
}

/// How unlikely it is that `act` was `w` (lower is likelier), or `None` when it can't have been.
pub fn cost(act: &Act, w: &Planned) -> Option<i64> {
    // Only a club the student shares this activity with may see it completing one of its workouts (D-011).
    if let Some(clubs) = &act.clubs
        && !w.club_id.as_ref().is_some_and(|c| clubs.contains(c))
    {
        return None;
    }
    if !compatible(&act.sport, &w.sport) {
        return None;
    }
    let d = days(act.day, w.date).abs();
    if d > MAX_DAYS {
        return None;
    }
    let r = ratio(act, w);
    let size = match r {
        None => UNKNOWN_SIZE,
        Some(r) => (r.ln().abs() * 1000.0).round().min(MAX_SIZE as f64) as i64,
    };
    // Same day: always plausible (a short run is a partial workout). Another day: only when the size fits.
    if d > 0
        && match r {
            None => d > 1,
            Some(_) => size > PLAUSIBLE_SIZE,
        }
    {
        return None;
    }
    Some(d * DAY_COST + size)
}

struct Pair<'a> {
    a: &'a Act,
    w: &'a Planned,
    c: i64,
}

/// Links each activity to its likeliest workout, or asks when a free rival is almost as likely.
pub fn solve(today: NaiveDate, activities: &[Act], workouts: &[Planned]) -> Solution {
    let mut acts: Vec<&Act> = activities.iter().collect();
    acts.sort_by(|x, y| {
        x.day
            .cmp(&y.day)
            .then_with(|| x.id.as_bytes().cmp(y.id.as_bytes()))
    });
    let mut pairs: Vec<Pair> = Vec::new();
    for a in &acts {
        for w in workouts {
            if let Some(c) = cost(a, w) {
                pairs.push(Pair { a, w, c });
            }
        }
    }
    pairs.sort_by(|x, y| {
        x.c.cmp(&y.c)
            .then_with(|| x.a.day.cmp(&y.a.day))
            .then_with(|| x.a.id.as_bytes().cmp(y.a.id.as_bytes()))
            .then_with(|| x.w.date.cmp(&y.w.date))
            .then_with(|| x.w.id.as_bytes().cmp(y.w.id.as_bytes()))
            .then(Ordering::Equal)
    });
    // Greedy: the cheapest pairs first, each activity and each workout used once.
    let mut by_act: HashMap<&str, usize> = HashMap::new();
    let mut taken: HashSet<&str> = HashSet::new();
    for (i, p) in pairs.iter().enumerate() {
        if by_act.contains_key(p.a.id.as_str()) || taken.contains(p.w.id.as_str()) {
            continue;
        }
        by_act.insert(p.a.id.as_str(), i);
        taken.insert(p.w.id.as_str());
    }
    let mut out = Solution::default();
    for a in &acts {
        let Some(&bi) = by_act.get(a.id.as_str()) else {
            continue;
        };
        let best = &pairs[bi];
        // Rivals: workouts no activity took, almost as likely as the best one.
        let rivals: Vec<&Pair> = pairs
            .iter()
            .filter(|q| {
                q.a.id == a.id
                    && q.w.id != best.w.id
                    && !taken.contains(q.w.id.as_str())
                    && q.c - best.c < MARGIN
            })
            .collect();
        if rivals.is_empty() {
            out.links.push(Link {
                activity_id: a.id.clone(),
                workout_id: best.w.id.clone(),
                compliance_pct: compliance(a, best.w),
            });
        } else if days(today, a.day) <= ASK_DAYS {
            out.pending.push(Pending {
                activity_id: a.id.clone(),
                options: std::iter::once(best)
                    .chain(rivals)
                    .take(MAX_OPTIONS)
                    .map(|q| q.w.id.clone())
                    .collect(),
            });
        }
    }
    out
}

/// The status of a workout completed by the engine.
pub fn status_for(compliance_pct: i32) -> &'static str {
    if compliance_pct >= COMPLETED_PCT {
        "completed"
    } else {
        "partial"
    }
}

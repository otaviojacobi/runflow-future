//! Strava API (D-011): OAuth (authorize, token exchange, refresh, deauthorize) and activities. Students connect
//! their own accounts; what we store is shown to trainers only with consent (§5).

use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

pub const STRAVA_BASE: &str = "https://www.strava.com";
/// What we ask for: the athlete's public profile and all activities, including private ones (the student
/// decides what their club sees through consents).
pub const SCOPE: &str = "read,activity:read_all";

#[derive(Debug, thiserror::Error)]
pub enum StravaError {
    /// The user denied access, the code is invalid, or the token was revoked (401/400).
    #[error("strava rejected the request ({0}): {1}")]
    Rejected(u16, String),
    /// Rate limited (429): try again later.
    #[error("strava rate limit")]
    RateLimited,
    #[error("strava unreachable: {0}")]
    Transport(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    #[serde(default)]
    pub athlete: Option<Athlete>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Athlete {
    pub id: i64,
    pub firstname: Option<String>,
    pub lastname: Option<String>,
}

impl Athlete {
    pub fn name(&self) -> Option<String> {
        let n = [self.firstname.as_deref(), self.lastname.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        (!n.trim().is_empty()).then(|| n.trim().to_string())
    }
}

#[derive(Clone)]
pub struct StravaClient {
    http: reqwest::Client,
    base: String,
    client_id: String,
    client_secret: String,
}

impl std::fmt::Debug for StravaClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StravaClient")
            .field("base", &self.base)
            .field("client_id", &self.client_id)
            .finish_non_exhaustive()
    }
}

impl StravaClient {
    pub fn new(base: &str, client_id: String, client_secret: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("runflow/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            client_id,
            client_secret,
        }
    }

    /// Where to send the person to approve access. `redirect_uri` must be on the app's authorized domain.
    pub fn authorize_url(&self, redirect_uri: &str, state: &str) -> String {
        self.authorize_at("/oauth/authorize", redirect_uri, state)
    }

    /// The phone app's variant: opens the Strava app when it's installed (else Strava's site), then returns to
    /// `redirect_uri` (`runflow://<callback domain>/…`).
    pub fn mobile_authorize_url(&self, redirect_uri: &str, state: &str) -> String {
        self.authorize_at("/oauth/mobile/authorize", redirect_uri, state)
    }

    fn authorize_at(&self, path: &str, redirect_uri: &str, state: &str) -> String {
        let enc = |s: &str| {
            s.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect::<String>()
        };
        format!(
            "{}{path}?client_id={}&redirect_uri={}&response_type=code&approval_prompt=auto&scope={}&state={}",
            self.base,
            enc(&self.client_id),
            enc(redirect_uri),
            enc(SCOPE),
            enc(state)
        )
    }

    async fn token(&self, form: &[(&str, &str)]) -> Result<Tokens, StravaError> {
        let mut params = vec![
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
        ];
        params.extend_from_slice(form);
        let res = self
            .http
            .post(format!("{}/oauth/token", self.base))
            .form(&params)
            .send()
            .await
            .map_err(|e| StravaError::Transport(e.to_string()))?;
        Self::json(res).await
    }

    pub async fn exchange_code(&self, code: &str) -> Result<Tokens, StravaError> {
        self.token(&[("code", code), ("grant_type", "authorization_code")])
            .await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens, StravaError> {
        self.token(&[
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .await
    }

    /// Revoke our access (disconnect). Best effort.
    pub async fn deauthorize(&self, access_token: &str) -> Result<(), StravaError> {
        let res = self
            .http
            .post(format!("{}/oauth/deauthorize", self.base))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| StravaError::Transport(e.to_string()))?;
        Self::json::<Value>(res).await.map(|_| ())
    }

    /// Activity summaries started after `after` (unix seconds), oldest first within the page.
    pub async fn activities(
        &self,
        access_token: &str,
        after: i64,
        page: u32,
    ) -> Result<Vec<Value>, StravaError> {
        let res = self
            .http
            .get(format!("{}/api/v3/athlete/activities", self.base))
            .bearer_auth(access_token)
            .query(&[
                ("after", after.to_string()),
                ("page", page.to_string()),
                ("per_page", "100".to_string()),
            ])
            .send()
            .await
            .map_err(|e| StravaError::Transport(e.to_string()))?;
        Self::json(res).await
    }

    /// An activity's time series (D-055), keyed by type: time, distance, heart rate, altitude, smoothed speed and
    /// position, each `{ "data": [...] }`. Missing sensors are simply absent. See [`map_streams`].
    pub async fn streams(&self, access_token: &str, id: i64) -> Result<Value, StravaError> {
        let res = self
            .http
            .get(format!("{}/api/v3/activities/{id}/streams", self.base))
            .bearer_auth(access_token)
            .query(&[
                (
                    "keys",
                    "time,distance,heartrate,altitude,velocity_smooth,latlng",
                ),
                ("key_by_type", "true"),
            ])
            .send()
            .await
            .map_err(|e| StravaError::Transport(e.to_string()))?;
        Self::json(res).await
    }

    /// One detailed activity (laps, per-km splits, calories, the full route).
    pub async fn activity(&self, access_token: &str, id: i64) -> Result<Value, StravaError> {
        let res = self
            .http
            .get(format!("{}/api/v3/activities/{id}", self.base))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| StravaError::Transport(e.to_string()))?;
        Self::json(res).await
    }

    async fn json<T: for<'de> Deserialize<'de>>(res: reqwest::Response) -> Result<T, StravaError> {
        let status = res.status();
        if status.as_u16() == 429 {
            return Err(StravaError::RateLimited);
        }
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(StravaError::Rejected(
                status.as_u16(),
                body.chars().take(300).collect(),
            ));
        }
        res.json()
            .await
            .map_err(|e| StravaError::Transport(format!("unexpected response: {e}")))
    }
}

/// Runflow sport for a Strava `sport_type` (or legacy `type`).
pub fn sport_of(strava_type: &str) -> &'static str {
    match strava_type {
        "Run" | "TrailRun" | "VirtualRun" => "run",
        "Ride" | "VirtualRide" | "EBikeRide" | "GravelRide" | "MountainBikeRide"
        | "EMountainBikeRide" | "Velomobile" | "Handcycle" => "bike",
        "Swim" => "swim",
        "WeightTraining" | "Crossfit" | "Workout" | "HighIntensityIntervalTraining" => "strength",
        "Yoga" | "Pilates" => "mobility",
        _ => "other",
    }
}

/// A Strava activity mapped to our columns (api/schema.sql `activities`).
#[derive(Debug, Clone, PartialEq)]
pub struct Mapped {
    pub external_id: String,
    pub sport: &'static str,
    pub name: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub duration_s: i32,
    pub moving_time_s: Option<i32>,
    pub distance_m: Option<i32>,
    pub elevation_gain_m: Option<i32>,
    pub avg_hr: Option<i32>,
    pub max_hr: Option<i32>,
    pub avg_pace_s_per_km: Option<i32>,
    pub avg_power_w: Option<i32>,
    pub calories: Option<i32>,
    pub laps: Option<Value>,
    pub splits: Option<Value>,
    pub polyline: Option<String>,
    pub route_polyline: Option<String>,
}

fn round(v: Option<f64>) -> Option<i64> {
    v.map(|x| x.round() as i64)
}

/// Seconds per km from metres and seconds; none for a zero distance.
fn pace(distance_m: f64, seconds: f64) -> Option<i64> {
    (distance_m > 0.0).then(|| (seconds / (distance_m / 1000.0)).round() as i64)
}

/// Device laps (D-055): the watch's lap presses or auto-laps, in order. A "tiro" and its recovery are separate laps;
/// `elapsed_s` above `duration_s` is time the watch was paused inside the lap, and `start_s` places each lap on the
/// activity's clock (gaps between laps are pauses too).
fn map_laps(a: &Value) -> Option<Value> {
    let start = a["start_date"]
        .as_str()
        .and_then(|d| d.parse::<chrono::DateTime<chrono::Utc>>().ok());
    let laps = a["laps"].as_array().filter(|l| !l.is_empty())?;
    Some(Value::Array(
        laps.iter()
            .enumerate()
            .map(|(i, l)| {
                let d = l["distance"].as_f64().unwrap_or(0.0);
                let elapsed = l["elapsed_time"].as_f64();
                let t = l["moving_time"].as_f64().or(elapsed).unwrap_or(0.0);
                let start_s = match (start, l["start_date"].as_str()) {
                    (Some(s0), Some(d)) => d
                        .parse::<chrono::DateTime<chrono::Utc>>()
                        .ok()
                        .map(|t| (t - s0).num_seconds().max(0)),
                    _ => None,
                };
                serde_json::json!({
                    "n": l["lap_index"].as_i64().unwrap_or(i as i64 + 1),
                    "name": l["name"].as_str(),
                    "distance_m": d.round() as i64,
                    "duration_s": t.round() as i64,
                    "elapsed_s": round(elapsed),
                    "start_s": start_s,
                    "avg_pace_s_per_km": pace(d, t),
                    "avg_hr": round(l["average_heartrate"].as_f64()),
                    "max_hr": round(l["max_heartrate"].as_f64()),
                })
            })
            .collect(),
    ))
}

/// Per-km splits as Strava computes them (`splits_metric`, D-055); the last one is usually shorter.
fn map_splits(a: &Value) -> Option<Value> {
    let splits = a["splits_metric"].as_array().filter(|s| !s.is_empty())?;
    Some(Value::Array(
        splits
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let d = s["distance"].as_f64().unwrap_or(0.0);
                let elapsed = s["elapsed_time"].as_f64();
                let t = s["moving_time"].as_f64().or(elapsed).unwrap_or(0.0);
                serde_json::json!({
                    "n": s["split"].as_i64().unwrap_or(i as i64 + 1),
                    "distance_m": d.round() as i64,
                    "duration_s": t.round() as i64,
                    "elapsed_s": round(elapsed),
                    "avg_pace_s_per_km": pace(d, t),
                    "avg_hr": round(s["average_heartrate"].as_f64()),
                    "elevation_diff_m": round(s["elevation_difference"].as_f64()),
                })
            })
            .collect(),
    ))
}

/// The most points kept from an activity's streams (D-055): enough for a heart-rate chart and a route.
pub const STREAM_POINTS: usize = 600;

/// Strava streams (`key_by_type`) → what `activity_streams.data` keeps: every series sampled at the same evenly
/// spaced indices (first and last kept), values rounded. None without a time series.
pub fn map_streams(s: &Value) -> Option<Value> {
    let series = |k: &str| s[k]["data"].as_array().filter(|d| !d.is_empty());
    let time = series("time")?;
    let n = time.len();
    let keep: Vec<usize> = if n <= STREAM_POINTS {
        (0..n).collect()
    } else {
        (0..STREAM_POINTS)
            .map(|i| i * (n - 1) / (STREAM_POINTS - 1))
            .collect()
    };
    let nums = |k: &str, digits: i32| -> Value {
        let Some(d) = series(k).filter(|d| d.len() == n) else {
            return Value::Null;
        };
        let f = 10f64.powi(digits);
        Value::Array(
            keep.iter()
                .map(|&i| {
                    d[i].as_f64()
                        .map(|v| serde_json::json!((v * f).round() / f))
                        .unwrap_or(Value::Null)
                })
                .collect(),
        )
    };
    let latlng = series("latlng").filter(|d| d.len() == n).map(|d| {
        Value::Array(
            keep.iter()
                .map(|&i| {
                    let p = &d[i];
                    match (p[0].as_f64(), p[1].as_f64()) {
                        (Some(lat), Some(lng)) => serde_json::json!([
                            (lat * 1e5).round() / 1e5,
                            (lng * 1e5).round() / 1e5
                        ]),
                        _ => Value::Null,
                    }
                })
                .collect(),
        )
    });
    Some(serde_json::json!({
        "time": nums("time", 0),
        "distance": nums("distance", 0),
        "heartrate": nums("heartrate", 0),
        "altitude": nums("altitude", 1),
        "velocity": nums("velocity_smooth", 2),
        "latlng": latlng.unwrap_or(Value::Null),
        "original_size": n,
    }))
}

pub fn map_activity(a: &Value) -> Option<Mapped> {
    let int = |k: &str| a[k].as_f64().map(|v| v.round() as i32);
    let sport = sport_of(
        a["sport_type"]
            .as_str()
            .or(a["type"].as_str())
            .unwrap_or(""),
    );
    let distance = int("distance").filter(|d| *d > 0);
    let moving = int("moving_time");
    let laps = map_laps(a);
    Some(Mapped {
        external_id: a["id"].as_i64()?.to_string(),
        sport,
        name: a["name"]
            .as_str()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or("Atividade")
            .chars()
            .take(200)
            .collect(),
        started_at: a["start_date"].as_str()?.parse().ok()?,
        duration_s: int("elapsed_time")?,
        moving_time_s: moving,
        distance_m: distance,
        elevation_gain_m: int("total_elevation_gain"),
        avg_hr: int("average_heartrate"),
        max_hr: int("max_heartrate"),
        avg_pace_s_per_km: match (sport, distance, moving) {
            ("run", Some(d), Some(t)) if d > 0 => {
                Some(((t as f64) / (d as f64 / 1000.0)).round() as i32)
            }
            _ => None,
        },
        avg_power_w: int("average_watts"),
        calories: int("calories"),
        laps,
        splits: map_splits(a),
        polyline: a["map"]["summary_polyline"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(str::to_string),
        // Only the detailed activity carries the full route; lists have the summary one only.
        route_polyline: a["map"]["polyline"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_a_strava_run() {
        let a = json!({ "id": 12345678901i64, "name": "Rodagem leve", "sport_type": "Run", "start_date": "2026-11-01T09:20:00Z",
                        "elapsed_time": 2100, "moving_time": 2040, "distance": 6012.4, "total_elevation_gain": 31.2, "average_heartrate": 148.6,
                        "max_heartrate": 171.0, "map": { "summary_polyline": "abc" },
                        "laps": [{ "distance": 1000.0, "moving_time": 340, "average_heartrate": 145.0 }] });
        let m = map_activity(&a).unwrap();
        assert_eq!(
            (
                m.external_id.as_str(),
                m.sport,
                m.distance_m,
                m.avg_pace_s_per_km,
                m.avg_hr
            ),
            ("12345678901", "run", Some(6012), Some(339), Some(149))
        );
        assert_eq!(
            m.laps.unwrap()[0],
            json!({ "n": 1, "name": null, "distance_m": 1000, "duration_s": 340, "elapsed_s": null, "start_s": null,
                    "avg_pace_s_per_km": 340, "avg_hr": 145, "max_hr": null })
        );
        assert_eq!((m.splits, m.route_polyline), (None, None));
        assert_eq!(sport_of("GravelRide"), "bike");
        assert_eq!(sport_of("Kitesurf"), "other");
        assert!(map_activity(&json!({ "name": "x" })).is_none());
        let c = StravaClient::new(STRAVA_BASE, "123".into(), "s".into());
        let url = c.authorize_url("https://app.runflow.club/connect/strava", "abc.def");
        assert!(
            url.contains("redirect_uri=https%3A%2F%2Fapp.runflow.club%2Fconnect%2Fstrava")
                && url.contains("scope=read%2Cactivity%3Aread_all")
        );
    }

    /// D-055: a session of tiros keeps each lap with its pauses and position, Strava's per-km splits and the full route.
    #[test]
    fn keeps_intervals_splits_and_route() {
        let a = json!({ "id": 1, "name": "Tiros", "sport_type": "Run", "start_date": "2026-11-05T09:00:00Z",
            "elapsed_time": 1500, "moving_time": 1380, "distance": 4200.0,
            "map": { "summary_polyline": "sum", "polyline": "full" },
            "laps": [
                { "lap_index": 1, "name": "Lap 1", "distance": 400.0, "moving_time": 80, "elapsed_time": 80,
                  "start_date": "2026-11-05T09:10:00Z", "average_heartrate": 171.4, "max_heartrate": 182.0 },
                { "lap_index": 2, "name": "Lap 2", "distance": 120.0, "moving_time": 50, "elapsed_time": 60,
                  "start_date": "2026-11-05T09:11:20Z", "average_heartrate": 150.0, "max_heartrate": 172.0 }
            ],
            "splits_metric": [
                { "split": 1, "distance": 1000.2, "moving_time": 300, "elapsed_time": 301, "average_heartrate": 140.2, "elevation_difference": 2.6 },
                { "split": 2, "distance": 200.0, "moving_time": 50, "elapsed_time": 50 }
            ] });
        let m = map_activity(&a).unwrap();
        let laps = m.laps.unwrap();
        assert_eq!(
            laps[0],
            json!({ "n": 1, "name": "Lap 1", "distance_m": 400, "duration_s": 80, "elapsed_s": 80, "start_s": 600,
                    "avg_pace_s_per_km": 200, "avg_hr": 171, "max_hr": 182 })
        );
        assert_eq!(
            (laps[1]["start_s"].as_i64(), laps[1]["elapsed_s"].as_i64()),
            (Some(680), Some(60))
        );
        assert_eq!(
            m.splits.unwrap(),
            json!([
                { "n": 1, "distance_m": 1000, "duration_s": 300, "elapsed_s": 301, "avg_pace_s_per_km": 300, "avg_hr": 140, "elevation_diff_m": 3 },
                { "n": 2, "distance_m": 200, "duration_s": 50, "elapsed_s": 50, "avg_pace_s_per_km": 250, "avg_hr": null, "elevation_diff_m": null }
            ])
        );
        assert_eq!(
            (m.polyline.as_deref(), m.route_polyline.as_deref()),
            (Some("sum"), Some("full"))
        );
    }

    /// D-055: streams are sampled to at most STREAM_POINTS, every series at the same instants; absent sensors are null.
    #[test]
    fn samples_streams() {
        let n = 1801;
        let s = json!({
            "time": { "data": (0..n).collect::<Vec<_>>() },
            "distance": { "data": (0..n).map(|i| i as f64 * 2.83).collect::<Vec<_>>() },
            "heartrate": { "data": (0..n).map(|i| 120 + (i % 50)).collect::<Vec<_>>() },
            "latlng": { "data": (0..n).map(|i| json!([-30.0 + i as f64 * 1e-5, -51.2])).collect::<Vec<_>>() }
        });
        let d = map_streams(&s).unwrap();
        let time = d["time"].as_array().unwrap();
        assert_eq!(time.len(), STREAM_POINTS);
        assert_eq!(
            (time[0].as_f64(), time[STREAM_POINTS - 1].as_f64()),
            (Some(0.0), Some(1800.0))
        );
        assert_eq!(d["heartrate"].as_array().unwrap().len(), STREAM_POINTS);
        assert_eq!(d["latlng"][STREAM_POINTS - 1], json!([-29.982, -51.2]));
        assert_eq!(
            (d["altitude"].clone(), d["original_size"].as_u64()),
            (Value::Null, Some(1801))
        );
        // Short activities keep every point; no time series, nothing to keep.
        let short =
            json!({ "time": { "data": [0, 1, 2] }, "distance": { "data": [0.0, 2.5, 5.04] } });
        assert_eq!(
            map_streams(&short).unwrap()["distance"],
            json!([0.0, 3.0, 5.0])
        );
        assert!(map_streams(&json!({})).is_none());
    }
}

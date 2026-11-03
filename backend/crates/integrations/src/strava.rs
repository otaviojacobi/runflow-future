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

    /// One detailed activity (laps, calories, polyline).
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
    pub polyline: Option<String>,
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
    let laps =
        a["laps"].as_array().filter(|l| !l.is_empty()).map(|laps| {
            Value::Array(
            laps.iter()
                .map(|l| {
                    let d = l["distance"].as_f64().unwrap_or(0.0);
                    let t = l["moving_time"].as_f64().or(l["elapsed_time"].as_f64()).unwrap_or(0.0);
                    serde_json::json!({
                        "distance_m": d.round() as i64, "duration_s": t.round() as i64,
                        "avg_hr": l["average_heartrate"].as_f64().map(|h| h.round() as i64),
                        "avg_pace_s_per_km": (d > 0.0).then(|| (t / (d / 1000.0)).round() as i64),
                    })
                })
                .collect(),
        )
        });
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
        polyline: a["map"]["summary_polyline"]
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
            json!({ "distance_m": 1000, "duration_s": 340, "avg_hr": 145, "avg_pace_s_per_km": 340 })
        );
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
}

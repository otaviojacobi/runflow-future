//! Week release (D-031): weeks start on Monday, in the club's time zone. A club in `weekly` mode may release the
//! following week automatically at a weekday (ISO 1 = Monday … 7 = Sunday) and time of the week before.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

/// A club's time zone (Brazilian zones; unknown → São Paulo).
pub fn tz(name: &str) -> Tz {
    name.parse().unwrap_or(chrono_tz::America::Sao_Paulo)
}

pub fn monday_of(d: NaiveDate) -> NaiveDate {
    d - Duration::days(i64::from(d.weekday().num_days_from_monday()))
}

/// The Monday of the club's current week at `now`.
pub fn this_monday(now: DateTime<Utc>, timezone: &str) -> NaiveDate {
    monday_of(now.with_timezone(&tz(timezone)).date_naive())
}

/// When the week starting `week_start` is released automatically: `weekday` of the week before, at `time`.
pub fn auto_release_at(
    week_start: NaiveDate,
    weekday: i16,
    time: NaiveTime,
    timezone: &str,
) -> Option<DateTime<Utc>> {
    let day = week_start - Duration::days(7) + Duration::days(i64::from(weekday.clamp(1, 7)) - 1);
    tz(timezone)
        .from_local_datetime(&day.and_time(time))
        .earliest()
        .map(|t| t.with_timezone(&Utc))
}

/// The week the automatic release covers at `now`: next week, once its release moment has passed.
pub fn due_week(
    now: DateTime<Utc>,
    weekday: i16,
    time: NaiveTime,
    timezone: &str,
) -> Option<NaiveDate> {
    let next = this_monday(now, timezone) + Duration::days(7);
    auto_release_at(next, weekday, time, timezone)
        .filter(|at| *at <= now)
        .map(|_| next)
}

/// `"18:00"` → 18:00 (minutes only, as the API exchanges it).
pub fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    (s.len() == 5)
        .then(|| NaiveTime::parse_from_str(s, "%H:%M").ok())
        .flatten()
}

/// The `week_released` notification (pt-BR): title and body for a student with `workouts` in that week.
pub fn release_notice(week_start: NaiveDate, workouts: i64) -> (String, String) {
    let end = week_start + Duration::days(6);
    let what = if workouts == 1 {
        "1 treino".to_string()
    } else {
        format!("{workouts} treinos")
    };
    (
        "Sua semana de treinos está liberada".to_string(),
        format!(
            "{what} de {} a {}",
            week_start.format("%d/%m"),
            end.format("%d/%m")
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    const SP: &str = "America/Sao_Paulo";

    #[test]
    fn sunday_evening_releases_the_next_week() {
        let six_pm = parse_hhmm("18:00").unwrap();
        // Week of Mon 2026-11-09: released Sun 2026-11-08 18:00 in São Paulo (UTC-3) = 21:00 UTC.
        assert_eq!(
            auto_release_at(date("2026-11-09"), 7, six_pm, SP),
            Some(utc("2026-11-08T21:00:00Z"))
        );
        assert_eq!(
            auto_release_at(date("2026-11-09"), 5, six_pm, SP),
            Some(utc("2026-11-06T21:00:00Z")),
            "Friday of the week before"
        );
        assert_eq!(due_week(utc("2026-11-08T20:59:00Z"), 7, six_pm, SP), None);
        assert_eq!(
            due_week(utc("2026-11-08T21:00:00Z"), 7, six_pm, SP),
            Some(date("2026-11-09"))
        );
        // Monday morning: this week has started (always visible); the next release is next Sunday.
        assert_eq!(due_week(utc("2026-11-09T11:00:00Z"), 7, six_pm, SP), None);
        // Manaus is UTC-4: same local time, one hour later in UTC.
        assert_eq!(
            auto_release_at(date("2026-11-09"), 7, six_pm, "America/Manaus"),
            Some(utc("2026-11-08T22:00:00Z"))
        );
    }

    #[test]
    fn notice() {
        let (title, body) = release_notice(date("2026-11-09"), 3);
        assert_eq!(title, "Sua semana de treinos está liberada");
        assert_eq!(body, "3 treinos de 09/11 a 15/11");
        assert_eq!(
            release_notice(date("2026-11-09"), 1).1,
            "1 treino de 09/11 a 15/11"
        );
    }

    #[test]
    fn weeks_and_times() {
        assert_eq!(monday_of(date("2026-11-08")), date("2026-11-02"));
        assert_eq!(monday_of(date("2026-11-09")), date("2026-11-09"));
        assert_eq!(
            this_monday(utc("2026-11-09T02:00:00Z"), SP),
            date("2026-11-02"),
            "still Sunday in São Paulo"
        );
        assert!(
            parse_hhmm("7:00").is_none()
                && parse_hhmm("24:00").is_none()
                && parse_hhmm("18:30").is_some()
        );
    }
}

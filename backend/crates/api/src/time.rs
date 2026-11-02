//! Club-local dates: a workout's day is a local date in the club's timezone (api/schema.sql conventions).

use chrono::{Datelike, Duration, NaiveDate, Utc};
use chrono_tz::Tz;

/// Today in the club's timezone (Brazilian zones; unknown → São Paulo).
pub fn club_today(timezone: &str) -> NaiveDate {
    let tz: Tz = timezone.parse().unwrap_or(chrono_tz::America::Sao_Paulo);
    Utc::now().with_timezone(&tz).date_naive()
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    (s.len() == 10)
        .then(|| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .flatten()
}

pub fn monday_of(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

/// `2026-11-09` → `09/11` (pt-BR day/month).
pub fn dd_mm(d: NaiveDate) -> String {
    d.format("%d/%m").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        let d = parse_date("2026-11-05").unwrap();
        assert_eq!(monday_of(d), parse_date("2026-11-02").unwrap());
        assert_eq!(
            monday_of(parse_date("2026-11-02").unwrap()),
            parse_date("2026-11-02").unwrap()
        );
        assert_eq!(dd_mm(d), "05/11");
        assert!(parse_date("2026-13-01").is_none() && parse_date("5/11/2026").is_none());
        let today = club_today("America/Manaus");
        assert!((today - Utc::now().date_naive()).num_days().abs() <= 1);
    }
}

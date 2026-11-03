//! Automatic week release (D-031): at each club's weekday and time, release the following week to everyone and
//! tell each student who has workouts in it. Runs on the worker's minute tick; idempotent (a week released to
//! everyone is skipped), so a late or repeated tick is harmless.

use chrono::{DateTime, Utc};
use runflow_db::weeks;
use runflow_domain::week;

use crate::Worker;

/// Release every week that is due at `now`; returns how many clubs released one.
pub async fn run(worker: &Worker, now: DateTime<Utc>) -> sqlx::Result<usize> {
    let mut released = 0;
    for c in weeks::auto_release_clubs(&worker.db).await? {
        let Some(week_start) = week::due_week(now, c.weekday, c.time, &c.timezone) else {
            continue;
        };
        if weeks::released_to_all(&worker.db, c.club_id, week_start).await? {
            continue;
        }
        let mut tx = worker.db.begin().await?;
        let hidden = weeks::hidden(&mut *tx, c.club_id, week_start).await?;
        weeks::release(&mut tx, c.club_id, week_start, &[], None).await?;
        for (athlete, n) in &hidden {
            let (title, text) = week::release_notice(week_start, *n);
            runflow_db::notifications::to_member(
                &mut tx,
                *athlete,
                runflow_db::notifications::Notice {
                    club_id: c.club_id,
                    kind: "week_released",
                    title: &title,
                    body: Some(&text),
                    link: "/schedule",
                },
            )
            .await?;
        }
        tx.commit().await?;
        tracing::info!(club_id = %c.club_id, %week_start, students = hidden.len(), "week released automatically");
        released += 1;
    }
    Ok(released)
}

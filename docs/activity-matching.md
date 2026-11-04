# Activity matching (D-049)

Which planned workout a synced or logged activity was. Students move workouts around: Tuesday's run done on Monday,
a long run pushed to Sunday, a workout cut short. When an activity arrives (from Strava or logged by hand) the
engine finds the workout it most likely was, links them and marks the workout done. When two workouts are about
equally likely, the engine doesn't guess: it asks the student, who picks one (or "none of these").

The rules live in one pure function with two ports, the mock's `api/mock/lib/matching.mjs` and the backend's
`backend/crates/domain/src/matching.rs`. Both must give exactly the outputs in `api/activity-match-examples.json`.
To add a case, append `today`, `workouts`, `activities` (and a `comment`), run
`node api/mock/activity-match-examples.mjs --fill`, read the diff, then `bash backend/scripts/sync-assets.sh`.

## The engine

Input: one student's **open** activities (each with its `day` in club time) and **open** workouts, plus `today`.
Output: the links to make and the questions to ask. Activities in neither list stay unmatched (an extra session).

**Can this activity be that workout?** Only if:
- the sport is the same, or both are gym sports (`strength` and `mobility`: a functional circuit often reaches
  Strava as "Workout", which maps to `strength`);
- the workout's date is at most **2 days** before or after the activity's day;
- on the same day, always (a short run is a partial workout); on another day, only when the size fits:
  actual ÷ planned between about 61% and 165% (`|ln ratio| ≤ 0.5`), or, when there's nothing to compare, at most
  1 day away.

**Size ratio.** Distance ÷ planned distance when both have one; otherwise time (moving time when known, else elapsed)
÷ planned time; otherwise unknown.

**Cost** (lower is likelier), in whole points: `500 × days away + size`, where size is
`round(1000 × |ln ratio|)` capped at 2000, or 300 when unknown. So a day away weighs about as much as being 65% off
in size.

**Assignment.** Every possible pair is sorted by cost (ties: activity day, activity id, workout date, workout id),
then taken greedily: each activity and each workout is used once. This lets a run on its own day beat a run a day
away, and a warm-up recorded apart lose the workout to the main run.

**Asking.** An activity is asked about instead of linked when a **rival** exists: a workout no activity took whose
cost is less than **250** points above the activity's best. The question lists the best and its rivals, best first,
at most 3. Only activities from the **last 7 days** become questions; an older doubt stays unmatched (the first Strava
import brings 30 days, and nobody wants 30 questions).

**Compliance** of a link: the size ratio as a percentage, 0–200 (100 when unknown). A workout completed by the engine
is `completed` at ≥ 80%, else `partial`.

## Scope: what the engine sees

A matching pass runs for one student around some days `[from, to]`:
- **Activities** of the student with their day in `[from − 2, to + 2]`, except the ones the student dismissed
  (`match_state = 'dismissed'`) and the ones the student linked by hand (`matched_by = 'student'`).
- **Workouts** of the student (every club where they're an active student) dated within 2 days of those, that the
  student can see (drafts never, D-031), except: workouts the student marked `missed` or `skipped`, workouts linked
  by the student, and workouts linked automatically to an activity outside the pass.
- The current automatic links of the activities in the pass are recomputed: only changes are written.

Then:
- a link that disappears: the completion goes away if it only existed because of the match (`reported_at` null),
  else it stays without the activity (the student's answers are kept);
- a new link: the workout's completion gets the activity (`matched_by = 'auto'`, compliance from the activity); if
  there was none, one is created with the status from compliance and no answers (`reported_at` null);
- a question: the activity becomes `pending` with its options (`activity_match_options`); every other activity in
  the pass is `open` again;
- an automatic completion whose activity was deleted is cleaned up the same way.

## When it runs

- An activity is imported, updated or deleted (Strava's first sync and webhooks, a manual log or delete): around its
  day (the old and the new one). Disconnecting a provider: the last 30 days.
- A planned workout dated up to 2 days ahead is created, moved, deleted, or changes sport or estimates (planning,
  copying a week, applying or removing a planilha): around its date (the old and the new one).
- The backend runs the pass in the worker (`match.activities` job, enqueued in the same transaction as the change);
  the mock runs it inline.

## What the student does

- **A question** (`GET /me/activities?match=pending`; Hoje shows it, so do Atividades and the activity): "Qual
  treino foi esta atividade?", the options with their day, and "Nenhum destes (treino extra)".
- **Choosing** (`PUT /me/activities/{id}/match {planned_workout_id}`): a link the engine never changes
  (`matched_by = 'student'`). The activity leaves the workout it completed before, the chosen workout's previous
  activity becomes open again, and the days around are matched again. Any visible workout of the student within 7
  days of the activity can be chosen, so the activity detail also offers "Trocar treino".
- **None** (`planned_workout_id: null`): the activity is `dismissed` and the engine leaves it alone until the
  student picks a workout for it.
- **Feedback** on an automatically completed workout (PSE, feeling, comment) goes through the completion route as
  before. It sets `reported_at`, and the trainer is notified the **first** time the student reports, not when the
  engine links an activity.

## Why not more signals

Pace, heart rate and lap structure could tell intervals from an easy run, but they aren't comparable across watches
and students, and the founder wants questions to be rare, not zero. Day and size settle most cases; the examples
file is where new cases (and new rules) start.

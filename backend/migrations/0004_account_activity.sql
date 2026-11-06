-- 0004: account_activity (2026-11-06)
-- Keep api/schema.sql equal to all migrations together (db/tests/contract.rs).

-- Account activity (D-056): when a person, each of their club memberships and each club were last active, so an
-- inactivity policy (warning e-mails, then deletion) can be decided later from data already there. Nothing acts on it
-- yet. Written by the API, never on every request: users on sign-in and as a session is used (at most every 5 min),
-- sign-in attempts when a code is asked for an existing account, memberships on club requests (at most every 5 min
-- each, off the request path) and clubs at most every 5 min whatever their size.
ALTER TABLE users ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN last_sign_in_at timestamptz;
ALTER TABLE users ADD COLUMN last_sign_in_attempt_at timestamptz;
ALTER TABLE memberships ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clubs ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();

-- Backfill from what was already kept: sessions (last use, creation = sign-in). Before this, activity wasn't kept per
-- club, so a membership starts from its person's last activity (never before joining) and a club from its members'.
UPDATE users u
   SET last_active_at = greatest(u.created_at, (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)),
       last_sign_in_at = (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id);
UPDATE memberships m
   SET last_active_at = greatest(m.joined_at, (SELECT u.last_active_at FROM users u WHERE u.id = m.user_id));
UPDATE clubs c
   SET last_active_at = greatest(c.created_at, (SELECT max(m.last_active_at) FROM memberships m WHERE m.club_id = c.id AND m.status = 'active'));

-- No index on purpose: these columns change often, and an index would make every stamp a slower, non-HOT update; the
-- future policy scans once a day, which a sequential scan handles fine for a long while.

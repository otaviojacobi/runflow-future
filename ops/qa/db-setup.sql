-- Roles and databases besides Runflow's own, kept in shape on every `docker compose up` by the `db-setup` service
-- (after the API has migrated, so every table below exists). Idempotent: safe to run any number of times.
-- psql variables: runflow_db, umami_password, grafana_password.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- Umami (D-054): its own role and database
SELECT 'CREATE ROLE umami LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umami') \gexec
ALTER ROLE umami WITH LOGIN PASSWORD :'umami_password' CONNECTION LIMIT 10;
SELECT 'CREATE DATABASE umami OWNER umami' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami') \gexec

-- Only the roles meant to reach Runflow's database can connect to it (Umami can't).
REVOKE CONNECT ON DATABASE :"runflow_db" FROM PUBLIC;

-- ---------------------------------------------------------------- Grafana's "Produto" dashboard: read-only, counts only
-- Column-level grants: ids, dates, roles, statuses and club names. No e-mails, people's names, phones, tokens,
-- message or comment bodies, notes or workout content. A table the dashboard needs later gets its columns here.
SELECT 'CREATE ROLE grafana_reader LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_reader') \gexec
ALTER ROLE grafana_reader WITH LOGIN PASSWORD :'grafana_password' CONNECTION LIMIT 5;
ALTER ROLE grafana_reader SET default_transaction_read_only = on;
ALTER ROLE grafana_reader SET statement_timeout = '15s';
GRANT CONNECT ON DATABASE :"runflow_db" TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;

GRANT SELECT (id, created_at, deleted_at) ON users TO grafana_reader;
GRANT SELECT (id, name, modalities, release_mode, created_at, deleted_at) ON clubs TO grafana_reader;
GRANT SELECT (id, club_id, user_id, role, status, joined_at, left_at) ON memberships TO grafana_reader;
GRANT SELECT (id, club_id, role, created_at, sent_at, accepted_at, revoked_at, expires_at) ON invitations TO grafana_reader;
GRANT SELECT (id, club_id, athlete_membership_id, date, sport, created_at) ON planned_workouts TO grafana_reader;
GRANT SELECT (id, club_id, week_start, released_at) ON week_releases TO grafana_reader;
GRANT SELECT (planned_workout_id, activity_id, status, matched_by, completed_at) ON workout_completions TO grafana_reader;
GRANT SELECT (id, user_id, source, sport, started_at, created_at) ON activities TO grafana_reader;
GRANT SELECT (user_id, provider, status, connected_at) ON provider_connections TO grafana_reader;
GRANT SELECT (id, conversation_id, created_at) ON messages TO grafana_reader;
GRANT SELECT (id, membership_id, status, created_at) ON class_bookings TO grafana_reader;
GRANT SELECT (club_id, plan, status) ON club_subscriptions TO grafana_reader;
GRANT SELECT (user_id, kind, created_at, last_seen_at) ON sessions TO grafana_reader;

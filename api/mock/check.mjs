#!/usr/bin/env node
/**
 * Contract check (npm run check:api):
 *  1. api/schema.sql applies cleanly on real PostgreSQL (PGlite, in-process).
 *  2. Every table in a freshly generated seed exists in the schema, and every row INSERTs
 *     (types, CHECK constraints and foreign keys are enforced by Postgres itself).
 *  3. api/mock/db.json is up to date with seed.mjs (snapshot anchor date).
 *  4. The free-text grammar (mock/lib/workout-text.mjs) gives exactly api/workout-text-examples.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { exerciseCatalog, generate, starterLibrary } from "./seed.mjs";
import { checkExamples } from "./workout-text-examples.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fail = (msg) => { console.error("✗ " + msg); process.exit(1); };

// FK-safe insert order (schema declaration order, with assets after clubs).
const ORDER = [
  "users", "auth_identities", "sessions", "clubs", "assets", "club_branding", "memberships", "invitations",
  "groups", "group_members", "consents", "athlete_profiles", "zones", "exercises", "workout_templates", "training_plans", "training_plan_items",
  "plan_assignments", "planned_workouts", "week_releases", "activities", "workout_completions", "comments", "thread_reads", "provider_connections",
  "webhook_events", "assessments", "conversations", "messages", "conversation_reads", "announcements", "announcement_reads", "races", "race_entries", "club_subscriptions", "invoices",
  "notifications", "notification_prefs", "push_tokens", "audit_log", "jobs",
];

const db = new PGlite();
await db.exec(readFileSync(join(here, "..", "schema.sql"), "utf8")).catch((e) => fail("schema.sql: " + e.message));

const cols = new Map();
for (const row of (await db.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'")).rows) {
  if (!cols.has(row.table_name)) cols.set(row.table_name, new Map());
  cols.get(row.table_name).set(row.column_name, row.data_type);
}

const seed = generate("2026-11-03");
const tables = Object.keys(seed).filter((k) => k !== "meta");
for (const tname of tables) {
  if (!cols.has(tname)) fail(`seed table "${tname}" is not in schema.sql`);
  if (!ORDER.includes(tname)) fail(`seed table "${tname}" missing from ORDER in check.mjs`);
}
for (const tname of cols.keys()) if (!tables.includes(tname)) fail(`schema table "${tname}" has no key in the seed (add an empty array)`);

let inserted = 0;
for (const tname of ORDER) {
  const types = cols.get(tname);
  for (const row of seed[tname] || []) {
    const keys = Object.keys(row);
    for (const k of keys) if (!types.has(k)) fail(`${tname}.${k} is not a column in schema.sql`);
    const values = keys.map((k) => (row[k] !== null && types.get(k) === "jsonb" ? JSON.stringify(row[k]) : row[k]));
    const sql = `INSERT INTO ${tname} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`;
    try {
      await db.query(sql, values);
      inserted++;
    } catch (e) {
      fail(`insert into ${tname} failed: ${e.message}\n  row: ${JSON.stringify(row).slice(0, 400)}`);
    }
  }
}

const snapshot = readFileSync(join(here, "db.json"), "utf8");
const strip = (o) => JSON.stringify({ ...o, meta: { ...o.meta, generated_at: null } });
if (strip(JSON.parse(snapshot)) !== strip(seed)) fail("api/mock/db.json is stale: run `npm run seed`");
const starter = readFileSync(join(here, "..", "starter-library.json"), "utf8");
if (starter !== JSON.stringify(starterLibrary(), null, 1) + "\n") fail("api/starter-library.json is stale: run `npm run seed`");
if (readFileSync(join(here, "..", "exercise-catalog.json"), "utf8") !== JSON.stringify(exerciseCatalog(), null, 1) + "\n") fail("api/exercise-catalog.json is stale: run `npm run seed`");

// Free-text workouts (R1): the mock's grammar gives exactly the golden examples.
const golden = checkExamples();
for (const f of golden.failures.slice(0, 10)) console.error(`✗ [${f.sport}] ${JSON.stringify(f.text)}: ${f.field}\n    want ${JSON.stringify(f.want)}\n    got  ${JSON.stringify(f.got)}`);
if (golden.failures.length) fail(`${golden.failures.length} of ${golden.count} examples in api/workout-text-examples.json differ (node api/mock/workout-text-examples.mjs)`);

console.log(`✓ schema.sql applies on PostgreSQL · ${tables.length} tables · ${inserted} seed rows inserted with all constraints · db.json up to date · ${golden.count} workout text examples`);

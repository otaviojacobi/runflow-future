-- Founder decision (2026-11-02, D-027): students don't pay their club through Runflow in v1.
-- Club finances (F26) move to the later list; api/schema.sql no longer has these tables.
DROP TABLE IF EXISTS charges;
DROP TABLE IF EXISTS student_fees;
DROP TABLE IF EXISTS fee_plans;
DROP TABLE IF EXISTS club_payout_accounts;

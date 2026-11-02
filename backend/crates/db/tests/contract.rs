//! The migrations must build exactly the database described by the contract (`api/schema.sql`, D-020).
//! Compares tables, columns, defaults, constraints, indexes and functions of both, in two scratch databases.

use std::collections::BTreeSet;

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::{ConnectOptions, Connection};

const CATALOG: &str = r#"
SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
       || ' default=' || coalesce(column_default, '-')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name <> '_sqlx_migrations'
UNION ALL
SELECT 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> '_sqlx_migrations'
UNION ALL
SELECT 'index ' || indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename <> '_sqlx_migrations'
UNION ALL
SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(p.prosrc)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
"#;

async fn catalog(pool: &PgPool) -> BTreeSet<String> {
    sqlx::query_scalar::<_, String>(CATALOG)
        .fetch_all(pool)
        .await
        .expect("catalog query")
        .into_iter()
        .collect()
}

#[sqlx::test(migrations = false)]
async fn migrations_match_the_contract(_pool_options: PgPoolOptions, opts: PgConnectOptions) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../api/schema.sql");
    let Ok(contract) = std::fs::read_to_string(path) else {
        eprintln!("skipped: {path} not found (backend outside the monorepo)");
        return;
    };

    // Two scratch databases on the same server: one from the migrations, one from the contract.
    let mut admin = opts.clone().connect().await.expect("admin connection");
    let suffix = uuid_like();
    let (from_migrations, from_contract) = (
        format!("rf_migrations_{suffix}"),
        format!("rf_contract_{suffix}"),
    );
    for db in [&from_migrations, &from_contract] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(r#"CREATE DATABASE "{db}""#)))
            .execute(&mut admin)
            .await
            .expect("create scratch database");
    }

    let migrated = PgPool::connect_with(opts.clone().database(&from_migrations))
        .await
        .unwrap();
    runflow_db::migrate(&migrated)
        .await
        .expect("migrations apply");
    let contracted = PgPool::connect_with(opts.clone().database(&from_contract))
        .await
        .unwrap();
    sqlx::raw_sql(sqlx::AssertSqlSafe(contract.as_str()))
        .execute(&contracted)
        .await
        .expect("api/schema.sql applies");

    let (a, b) = (catalog(&migrated).await, catalog(&contracted).await);
    migrated.close().await;
    contracted.close().await;
    for db in [&from_migrations, &from_contract] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            r#"DROP DATABASE "{db}" WITH (FORCE)"#
        )))
        .execute(&mut admin)
        .await
        .ok();
    }
    admin.close().await.ok();

    let only_migrations: Vec<_> = a.difference(&b).collect();
    let only_contract: Vec<_> = b.difference(&a).collect();
    assert!(
        only_migrations.is_empty() && only_contract.is_empty(),
        "backend/migrations and api/schema.sql disagree.\n  only in migrations: {only_migrations:#?}\n  only in api/schema.sql: {only_contract:#?}\n\
         Change the contract and add a migration in the same step."
    );
    assert!(
        a.len() > 300,
        "suspiciously small catalog ({} entries)",
        a.len()
    );
}

fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}_{}", nanos, std::process::id())
}

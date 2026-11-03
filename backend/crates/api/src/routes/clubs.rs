//! Clubs (A5, O3), branding (O1), uploads, and public club pages (api/endpoints.md § Clubs, branding, …).

use std::sync::LazyLock;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use runflow_db::clubs as db;
use runflow_db::models::Club;
use runflow_domain::color::{Defaults, Envs, club_theme, from_tokens, normalize_hex};
use runflow_domain::week;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access::{ANY, OWNER, member};
use crate::body::Body;
use crate::session::Auth;
use crate::uploads::{read_image, store};
use crate::{AppState, FieldError, Problem};

pub const SPORTS: [&str; 6] = ["run", "swim", "bike", "strength", "mobility", "other"];
const UF: [&str; 27] = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
    "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];
/// The timezones the club settings offer (api/endpoints.md § Clubs).
pub const TIMEZONES: [&str; 8] = [
    "America/Noronha",
    "America/Sao_Paulo",
    "America/Manaus",
    "America/Cuiaba",
    "America/Campo_Grande",
    "America/Porto_Velho",
    "America/Boa_Vista",
    "America/Rio_Branco",
];
/// Never a club's subdomain (ours, or used by e-mail/DNS; docs/hosting.md).
pub const RESERVED_SUBDOMAINS: [&str; 22] = [
    "app",
    "api",
    "www",
    "mail",
    "email",
    "smtp",
    "imap",
    "pop",
    "autodiscover",
    "send",
    "status",
    "docs",
    "admin",
    "assets",
    "static",
    "cdn",
    "blog",
    "ajuda",
    "suporte",
    "dev",
    "runflow",
    "staging",
];

/// Runflow's theme inputs, from the synced design tokens.
static THEME: LazyLock<(Envs, Defaults)> = LazyLock::new(|| {
    let tokens: Value = serde_json::from_str(include_str!("../../../../assets/design/tokens.json"))
        .expect("tokens.json");
    from_tokens(&tokens).expect("tokens.json has env and seeds")
});

#[derive(Deserialize)]
struct Starter {
    sport: String,
    name: String,
    structure: Value,
    tags: Vec<String>,
    est_duration_s: Option<i32>,
    est_distance_m: Option<i32>,
}

/// Workouts every new club starts with, per modality (`api/starter-library.json`, synced).
static STARTER: LazyLock<std::collections::HashMap<String, Vec<Starter>>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../assets/starter-library.json"))
        .expect("starter-library.json")
});

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/clubs", post(create))
        .route(
            "/clubs/{club_id}",
            get(get_club).patch(update).delete(close),
        )
        .route(
            "/clubs/{club_id}/branding",
            get(get_branding).put(put_branding),
        )
        .route("/clubs/{club_id}/assets", post(upload))
        .route("/assets/{id}", get(asset))
        .route("/public/clubs/{slug}", get(public_club))
}

fn fail(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

fn not_found() -> Problem {
    Problem::new(
        StatusCode::NOT_FOUND,
        "club.not_found",
        "Clube não encontrado",
        "Ele pode ter sido encerrado.",
    )
}

/// "Pace Forte Assessoria" → "pace-forte-assessoria" (accents folded, 3..38 chars).
fn slug_base(name: &str) -> String {
    let folded: String = name
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    let mut s = folded
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    s.truncate(36);
    let s = s.trim_end_matches('-').to_string();
    match s.len() {
        0 => "clube".into(),
        1 | 2 => format!("{s}-clube"),
        _ => s,
    }
}

fn read_modalities(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for m in v
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if SPORTS.contains(&m) && !out.iter().any(|x| x == m) {
            out.push(m.to_string());
        }
    }
    out
}

fn branding_json(theme: Option<runflow_db::models::Branding>) -> Value {
    json!(theme)
}

async fn create(
    State(state): State<AppState>,
    auth: Auth,
    body: Body,
) -> Result<Response, Problem> {
    let mut errors = Vec::new();
    let name = body.str("name");
    match &name {
        None => errors.push(fail("name", "Informe o nome do clube.")),
        Some(n) if n.chars().count() > 80 => {
            errors.push(fail("name", "Use no máximo 80 caracteres."))
        }
        _ => {}
    }
    let city = body.str("city");
    if city.as_ref().is_some_and(|c| c.chars().count() > 80) {
        errors.push(fail("city", "Use no máximo 80 caracteres."));
    }
    let state_uf = body.str("state").map(|s| s.to_uppercase());
    if state_uf.as_ref().is_some_and(|s| !UF.contains(&s.as_str())) {
        errors.push(fail("state", "Escolha um estado."));
    }
    let modalities = read_modalities(body.get("modalities"));
    if modalities.is_empty() {
        errors.push(fail("modalities", "Escolha pelo menos uma modalidade."));
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let name = name.unwrap_or_default();
    let trainer_label = if modalities.iter().any(|m| m == "swim" || m == "strength")
        && !modalities.iter().any(|m| m == "run")
    {
        "professor"
    } else {
        "treinador"
    };

    let base = slug_base(&name);
    let mut slug = base.clone();
    let mut n = 2;
    while db::slug_taken(&state.db, &slug).await? {
        slug = format!("{base}-{n}");
        n += 1;
    }

    let (envs, defaults) = &*THEME;
    let (theme, css) = club_theme(None, None, envs, defaults);
    let mut tx = state.db.begin().await?;
    let club = db::insert_club(
        &mut tx,
        db::NewClub {
            name: &name,
            slug: &slug,
            city: city.as_deref(),
            state: state_uf.as_deref(),
            modalities: &modalities,
            trainer_label,
        },
    )
    .await?;
    let membership = db::insert_membership(&mut tx, club.id, auth.user_id, "owner", true).await?;
    db::save_branding(
        &mut *tx,
        club.id,
        db::BrandingInput {
            primary: None,
            secondary: None,
            logo_asset_id: None,
            theme: &theme,
            theme_css: &css,
        },
    )
    .await?;
    db::insert_free_plan(&mut tx, club.id).await?;
    for t in modalities
        .iter()
        .flat_map(|m| STARTER.get(m).map(Vec::as_slice).unwrap_or_default())
    {
        db::insert_template(
            &mut tx,
            club.id,
            membership.id,
            db::Template {
                sport: &t.sport,
                name: &t.name,
                structure: &t.structure,
                tags: &t.tags,
                est_duration_s: t.est_duration_s,
                est_distance_m: t.est_distance_m,
            },
        )
        .await?;
    }
    db::audit(
        &mut *tx,
        Some(club.id),
        auth.user_id,
        "club.created",
        "club",
        club.id,
    )
    .await?;
    tx.commit().await?;
    tracing::info!(club_id = %club.id, slug = %club.slug, "club created");

    let branding = db::branding(&state.db, club.id).await?;
    let subscription = db::subscription(&state.db, club.id).await?;
    Ok((StatusCode::CREATED, Json(json!({ "club": club, "membership": membership, "branding": branding, "subscription": subscription }))).into_response())
}

async fn get_club(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Club>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    Ok(Json(
        db::club(&state.db, m.club_id)
            .await?
            .ok_or_else(not_found)?,
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Club>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let mut errors = Vec::new();
    let mut p = db::ClubPatch::default();
    if body.has("name") {
        match body.str("name") {
            None => errors.push(fail("name", "Informe o nome do clube.")),
            Some(n) if n.chars().count() > 80 => {
                errors.push(fail("name", "Use no máximo 80 caracteres."))
            }
            Some(n) => p.name = Some(n),
        }
    }
    if body.has("city") {
        p.city = Some(body.str("city"));
    }
    if body.has("state") {
        match body.str("state").map(|s| s.to_uppercase()) {
            Some(s) if !UF.contains(&s.as_str()) => {
                errors.push(fail("state", "Escolha um estado."))
            }
            s => p.state = Some(s),
        }
    }
    if body.has("timezone") {
        match body.str("timezone") {
            Some(tz) if TIMEZONES.contains(&tz.as_str()) => p.timezone = Some(tz),
            _ => errors.push(fail("timezone", "Escolha um fuso horário.")),
        }
    }
    if body.has("modalities") {
        let mods = read_modalities(body.get("modalities"));
        if mods.is_empty() {
            errors.push(fail("modalities", "Escolha pelo menos uma modalidade."));
        } else {
            p.modalities = Some(mods);
        }
    }
    if body.has("trainer_label") {
        match body.str("trainer_label") {
            Some(l) if l == "treinador" || l == "professor" => p.trainer_label = Some(l),
            _ => errors.push(fail("trainer_label", "Opção inválida.")),
        }
    }
    if body.has("subdomain") {
        match body.str("subdomain").map(|s| s.to_lowercase()) {
            None => p.subdomain = Some(None),
            Some(sub) => {
                let shape = sub.len() >= 3
                    && sub.len() <= 32
                    && sub
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                    && !sub.starts_with('-')
                    && !sub.ends_with('-');
                if !shape {
                    errors.push(fail(
                        "subdomain",
                        "Use de 3 a 32 letras, números ou hífens.",
                    ));
                } else if sub.ends_with("-qa") {
                    // QA serves club sites at <club>-qa.runflow.club (D-029).
                    errors.push(fail(
                        "subdomain",
                        "Endereços terminados em -qa são reservados.",
                    ));
                } else if RESERVED_SUBDOMAINS.contains(&sub.as_str()) {
                    errors.push(fail(
                        "subdomain",
                        "Este endereço é reservado. Escolha outro.",
                    ));
                } else if db::subdomain_taken(&state.db, &sub, m.club_id).await? {
                    errors.push(fail("subdomain", "Este endereço já está em uso."));
                } else if db::subscription(&state.db, m.club_id)
                    .await?
                    .is_none_or(|s| s.plan == "free")
                {
                    return Err(Problem::new(
                        StatusCode::PAYMENT_REQUIRED,
                        "plan.required",
                        "Disponível no plano Pro",
                        "O endereço próprio (seuclube.runflow.club) faz parte do plano Pro.",
                    ));
                } else {
                    p.subdomain = Some(Some(sub));
                }
            }
        }
    }
    // Week release (D-031).
    if body.has("release_mode") {
        match body.str("release_mode") {
            Some(r) if r == "immediate" || r == "weekly" => p.release_mode = Some(r),
            _ => errors.push(fail(
                "release_mode",
                "Escolha quando os alunos veem os treinos.",
            )),
        }
    }
    if body.has("auto_release_weekday") || body.has("auto_release_time") {
        let weekday = body
            .get("auto_release_weekday")
            .and_then(Value::as_i64)
            .filter(|d| (1..=7).contains(d));
        let time = body
            .str("auto_release_time")
            .as_deref()
            .and_then(week::parse_hhmm);
        let off = body.get("auto_release_weekday").is_none_or(Value::is_null)
            && body.get("auto_release_time").is_none_or(Value::is_null);
        match (weekday, time) {
            (Some(d), Some(t)) => p.auto_release = Some(Some((d as i16, t))),
            _ if off => p.auto_release = Some(None),
            _ => errors.push(fail(
                "auto_release_time",
                "Informe o dia e o horário da liberação automática.",
            )),
        }
    }
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let before = db::club(&state.db, m.club_id)
        .await?
        .ok_or_else(not_found)?;
    let mut tx = state.db.begin().await?;
    let club = db::update_club(&mut *tx, m.club_id, p)
        .await?
        .ok_or_else(not_found)?;
    // Going weekly must not hide what students already saw: release every future week with workouts.
    if before.release_mode == "immediate" && club.release_mode == "weekly" {
        runflow_db::weeks::release_planned_future(&mut *tx, club.id).await?;
    }
    tx.commit().await?;
    db::audit(
        &state.db,
        Some(club.id),
        auth.user_id,
        "club.updated",
        "club",
        club.id,
    )
    .await?;
    Ok(Json(club))
}

async fn close(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<StatusCode, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let club = db::club(&state.db, m.club_id)
        .await?
        .ok_or_else(not_found)?;
    if body.str("confirm_name").map(|n| n.to_lowercase()) != Some(club.name.to_lowercase()) {
        return Err(Problem::field(
            "confirm_name",
            "Digite o nome do clube exatamente como aparece.",
        ));
    }
    let mut tx = state.db.begin().await?;
    db::close_club(&mut tx, club.id).await?;
    db::audit(
        &mut *tx,
        Some(club.id),
        auth.user_id,
        "club.closed",
        "club",
        club.id,
    )
    .await?;
    tx.commit().await?;
    tracing::info!(club_id = %club.id, "club closed");
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------------ branding

async fn get_branding(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, ANY).await?;
    Ok(Json(branding_json(
        db::branding(&state.db, m.club_id).await?,
    )))
}

async fn put_branding(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Json<Value>, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let mut errors = Vec::new();
    let mut color = |field: &'static str| match body.str(field) {
        None => None,
        Some(v) => match normalize_hex(&v).filter(|_| v.starts_with('#')) {
            Some(h) => Some(h),
            None => {
                errors.push(fail(field, "Use uma cor no formato #RRGGBB."));
                None
            }
        },
    };
    let (mut primary, mut secondary) = (color("primary_color"), color("secondary_color"));
    if primary.is_none() && secondary.is_some() {
        primary = secondary.take();
    }
    let logo = if body.has("logo_asset_id") {
        match body.str("logo_asset_id") {
            None => None,
            Some(id) => match Uuid::parse_str(&id) {
                Ok(id) if db::is_club_logo(&state.db, id, m.club_id).await? => Some(id),
                _ => {
                    errors.push(fail("logo_asset_id", "Envie o logo novamente."));
                    None
                }
            },
        }
    } else {
        db::logo_asset_id(&state.db, m.club_id).await?
    };
    if !errors.is_empty() {
        return Err(Problem::invalid(errors));
    }
    let (envs, defaults) = &*THEME;
    let (theme, css) = club_theme(primary.as_deref(), secondary.as_deref(), envs, defaults);
    db::save_branding(
        &state.db,
        m.club_id,
        db::BrandingInput {
            primary: primary.as_deref(),
            secondary: secondary.as_deref(),
            logo_asset_id: logo,
            theme: &theme,
            theme_css: &css,
        },
    )
    .await?;
    db::audit(
        &state.db,
        Some(m.club_id),
        auth.user_id,
        "branding.updated",
        "club",
        m.club_id,
    )
    .await?;
    Ok(Json(branding_json(
        db::branding(&state.db, m.club_id).await?,
    )))
}

// ------------------------------------------------------------------------------------ assets

async fn upload(
    State(state): State<AppState>,
    auth: Auth,
    Path(club_id): Path<String>,
    body: Body,
) -> Result<Response, Problem> {
    let m = member(&state, &auth, &club_id, OWNER).await?;
    let img = read_image(&body, true)?;
    let id = store(&state, auth.user_id, Some(m.club_id), "logo", img).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "url": format!("/v1/assets/{id}") })),
    )
        .into_response())
}

/// Public and immutable (ids are never reused). Served with a sandboxing CSP so an SVG can't run anything.
async fn asset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, Problem> {
    let missing = || {
        Problem::new(
            StatusCode::NOT_FOUND,
            "asset.not_found",
            "Imagem não encontrada",
            "Ela pode ter sido removida.",
        )
    };
    let id = Uuid::parse_str(&id).map_err(|_| missing())?;
    let a = db::asset(&state.db, id).await?.ok_or_else(missing)?;
    let etag = format!("\"{}\"", a.sha256);
    let cache = [
        (
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ),
        (
            header::ETAG,
            HeaderValue::from_str(&etag).map_err(|_| Problem::internal())?,
        ),
    ];
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        == Some(etag.as_str())
    {
        return Ok((StatusCode::NOT_MODIFIED, cache).into_response());
    }
    let bytes = state
        .storage
        .get(&a.storage_key)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "asset read failed");
            Problem::internal()
        })?
        .ok_or_else(missing)?;
    let mut res = (cache, bytes).into_response();
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&a.content_type).map_err(|_| Problem::internal())?,
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    Ok(res)
}

// ------------------------------------------------------------------------------------ public

async fn public_club(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>, Problem> {
    let c = db::club_by_slug(&state.db, &slug.to_lowercase())
        .await?
        .ok_or_else(|| {
            Problem::new(
                StatusCode::NOT_FOUND,
                "club.not_found",
                "Clube não encontrado",
                "Confira o endereço.",
            )
        })?;
    let branding = db::branding(&state.db, c.id).await?;
    Ok(Json(json!({
        "club": { "id": c.id, "slug": c.slug, "name": c.name, "city": c.city, "state": c.state, "modalities": c.modalities, "trainer_label": c.trainer_label },
        "branding": branding,
    })))
}

#[cfg(test)]
mod tests {
    use super::slug_base;

    #[test]
    fn slugs() {
        assert_eq!(slug_base("Pace Forte Assessoria"), "pace-forte-assessoria");
        assert_eq!(slug_base("Equipe Maré — Natação!"), "equipe-mare-natacao");
        assert_eq!(slug_base("AB"), "ab-clube");
        assert_eq!(slug_base("???"), "clube");
        assert!(slug_base(&"x".repeat(80)).len() <= 36);
    }
}

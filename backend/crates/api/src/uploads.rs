//! Image uploads (club logos, avatars) sent as `data:` URLs, like the mock. The declared type must match the
//! file's real signature; SVGs (logos only) must not carry scripts, and every asset is served with a sandboxing
//! CSP anyway (§7.2: no user-uploaded active content).

use aws_lc_rs::digest;
use axum::http::StatusCode;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;
use uuid::Uuid;

use crate::body::Body;
use crate::{AppState, Problem};

pub const MAX_BYTES: usize = 5 * 1024 * 1024;

pub struct Image {
    pub content_type: &'static str,
    pub bytes: Vec<u8>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

fn unsupported(detail: &'static str) -> Problem {
    Problem::new(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "asset.unsupported",
        "Formato não suportado",
        detail,
    )
}

/// Parse and check `{data_url, width, height}`. `allow_svg`: logos yes, avatars no.
pub fn read_image(body: &Body, allow_svg: bool) -> Result<Image, Problem> {
    let detail = if allow_svg {
        "Envie uma imagem PNG, JPG, WebP ou SVG."
    } else {
        "Envie uma foto PNG, JPG ou WebP."
    };
    let url = body.str("data_url").unwrap_or_default();
    let (meta, data) = url
        .strip_prefix("data:")
        .and_then(|r| r.split_once(','))
        .ok_or_else(|| unsupported(detail))?;
    let content_type = match meta {
        "image/png;base64" => "image/png",
        "image/jpeg;base64" => "image/jpeg",
        "image/webp;base64" => "image/webp",
        "image/svg+xml;base64" if allow_svg => "image/svg+xml",
        _ => return Err(unsupported(detail)),
    };
    // Reject before decoding when the payload is clearly too big (base64 is 4/3 of the bytes).
    if data.len() / 4 * 3 > MAX_BYTES + 3 {
        return Err(too_large());
    }
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|_| unsupported(detail))?;
    if bytes.len() > MAX_BYTES {
        return Err(too_large());
    }
    let real = match &bytes[..] {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => "image/webp",
        _ if content_type == "image/svg+xml" && safe_svg(&bytes) => "image/svg+xml",
        _ => return Err(unsupported(detail)),
    };
    if real != content_type {
        return Err(unsupported(detail));
    }
    let dim = |k: &str| {
        body.get(k)
            .and_then(Value::as_i64)
            .filter(|v| (1..=20_000).contains(v))
            .map(|v| v as i32)
    };
    Ok(Image {
        content_type,
        bytes,
        width: dim("width"),
        height: dim("height"),
    })
}

fn too_large() -> Problem {
    Problem::new(
        StatusCode::PAYLOAD_TOO_LARGE,
        "asset.too_large",
        "Imagem muito grande",
        "O limite é 5 MB.",
    )
}

/// An SVG document without scripts, event handlers, external references or embedded HTML.
fn safe_svg(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let lower = text.to_ascii_lowercase();
    lower.contains("<svg")
        && ![
            "<script",
            "javascript:",
            "<foreignobject",
            "<iframe",
            "<embed",
            "<object",
            "xlink:href=\"http",
            "href=\"http",
            "@import",
        ]
        .iter()
        .any(|bad| lower.contains(bad))
        && !lower
            .split(|c: char| c.is_whitespace())
            .any(|w| w.starts_with("on") && w.contains('='))
}

/// Store the image and record it; returns the new asset id.
pub async fn store(
    state: &AppState,
    owner: Uuid,
    club_id: Option<Uuid>,
    kind: &str,
    img: Image,
) -> Result<Uuid, Problem> {
    let id = Uuid::now_v7();
    let key = match club_id {
        Some(c) => format!("clubs/{c}/{id}"),
        None => format!("users/{owner}/{id}"),
    };
    let sha = digest::digest(&digest::SHA256, &img.bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let size = img.bytes.len() as i32;
    state.storage.put(&key, img.bytes).await.map_err(|e| {
        tracing::error!(error = %e, "asset upload failed");
        Problem::internal()
    })?;
    runflow_db::clubs::insert_asset(
        &state.db,
        runflow_db::clubs::NewAsset {
            id,
            owner_user_id: owner,
            club_id,
            kind,
            storage_key: &key,
            content_type: img.content_type,
            bytes: size,
            width: img.width,
            height: img.height,
            sha256: &sha,
        },
    )
    .await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::safe_svg;

    #[test]
    fn svg_safety() {
        assert!(safe_svg(br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4" fill="#E4572E"/></svg>"##));
        assert!(!safe_svg(br##"<svg><script>alert(1)</script></svg>"##));
        assert!(!safe_svg(br##"<svg onload="alert(1)"></svg>"##));
        assert!(!safe_svg(
            br##"<svg><a href="javascript:alert(1)">x</a></svg>"##
        ));
        assert!(!safe_svg(
            br##"<svg><image href="https://tracker.example/p.png"/></svg>"##
        ));
        assert!(!safe_svg(b"not an svg"));
    }
}

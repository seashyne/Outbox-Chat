//! User profile and appearance settings REST handlers.
//!
//! Covers `GET /api/users/@me/settings`, `PATCH /api/users/@me/settings`,
//! and `PATCH /api/users/@me` with strict hex color and preset validation.

use super::{clean_text, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{Event, UpdateProfileRequest, UpdateSettingsRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use std::sync::Arc;

/// Validates 3-digit or 6-digit `#RGB` / `#RRGGBB` hex color strings.
pub(crate) fn is_valid_hex_color(s: &str) -> bool {
    let s = s.trim();
    if !s.starts_with('#') {
        return false;
    }
    let len = s.len();
    if len != 4 && len != 7 {
        return false;
    }
    s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Returns the authenticated user's persisted settings.
pub async fn get_settings(Auth(user): Auth) -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(serde_json::json!({
        "settings": user.settings,
    })))
}

/// Applies partial updates to theme preset, custom palette colors, or online status.
pub async fn update_settings(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<UpdateSettingsRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let (new_settings, status_changed) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let stored_user = store
            .users
            .get_mut(&user.id)
            .ok_or(ApiError::NotFound("user"))?;

        let theme = body
            .settings
            .as_ref()
            .and_then(|s| s.theme.clone())
            .or(body.theme);
        let custom_colors = body
            .settings
            .as_ref()
            .and_then(|s| s.custom_colors.clone())
            .or(body.custom_colors);
        let status = body
            .settings
            .as_ref()
            .and_then(|s| s.status.clone())
            .or(body.status);

        if let Some(t) = theme {
            if t.chars().any(|c| c.is_control()) {
                return Err(ApiError::BadRequest(
                    "theme cannot contain control characters".into(),
                ));
            }
            let t = t.trim();
            const ALLOWED_THEMES: &[&str] = &[
                "dark", "light", "slate", "forest", "midnight", "amber", "custom",
            ];
            if !ALLOWED_THEMES.contains(&t) {
                return Err(ApiError::BadRequest(format!(
                    "unsupported theme preset '{t}'"
                )));
            }
            stored_user.settings.theme = t.to_string();
        }
        if let Some(cc) = custom_colors {
            const ALLOWED_PALETTE_KEYS: &[&str] = &["brand", "sidebar", "chat"];
            for (k, v) in cc {
                if ALLOWED_PALETTE_KEYS.contains(&k.as_str()) {
                    if !is_valid_hex_color(&v) {
                        return Err(ApiError::BadRequest(format!(
                            "invalid hex color for {k}: '{v}'"
                        )));
                    }
                    stored_user
                        .settings
                        .custom_colors
                        .insert(k, v.trim().to_string());
                }
            }
        }
        let mut status_val = None;
        if let Some(s) = status {
            if s.chars().any(|c| c.is_control()) {
                return Err(ApiError::BadRequest(
                    "status cannot contain control characters".into(),
                ));
            }
            let s = s.trim();
            if !s.is_empty() && s.chars().count() <= 32 {
                stored_user.settings.status = s.to_string();
                status_val = Some(s.to_string());
            }
        }
        (stored_user.settings.clone(), status_val)
    };
    state.persist();
    if let Some(status) = status_changed {
        state.emit(Event::UserStatus {
            user_id: user.id.clone(),
            status,
        });
    }
    Ok(Json(serde_json::json!({
        "settings": new_settings,
    })))
}

/// Validates safe profile image data URLs (PNG/JPEG/WebP up to 64 KB) or `https://` URLs.
fn parse_avatar_url(raw: &str) -> ApiResult<Option<String>> {
    let s = raw.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if s.len() > 65_536 || s.chars().any(|c| c.is_control() || matches!(c, '<' | '"' | '\'')) {
        return Err(ApiError::BadRequest("invalid avatar image format or size".into()));
    }
    let valid_prefix = s.starts_with("data:image/png;base64,")
        || s.starts_with("data:image/jpeg;base64,")
        || s.starts_with("data:image/webp;base64,")
        || s.starts_with("https://");
    if !valid_prefix {
        return Err(ApiError::BadRequest("invalid avatar image format or size".into()));
    }
    Ok(Some(s.to_string()))
}

/// Updates the authenticated user's display name, avatar color, or picture and broadcasts `user_update`.
pub async fn update_profile(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<UpdateProfileRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let avatar_patch = match body.avatar_url.as_deref() {
        Some(raw) => Some(parse_avatar_url(raw)?),
        None => None,
    };
    let public = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let stored_user = store
            .users
            .get_mut(&user.id)
            .ok_or(ApiError::NotFound("user"))?;

        if let Some(name) = body.display_name {
            let cleaned = clean_text(&name, 32, "display name")?;
            stored_user.display_name = cleaned;
        }
        if let Some(color) = body.color {
            let color = color.trim();
            if !is_valid_hex_color(color) {
                return Err(ApiError::BadRequest(format!(
                    "invalid profile avatar color '{color}'"
                )));
            }
            stored_user.color = color.to_string();
        }
        if let Some(next_avatar) = avatar_patch {
            stored_user.avatar_url = next_avatar;
        }
        stored_user.public()
    };
    state.persist();
    state.emit(Event::UserUpdate {
        user: public.clone(),
    });
    Ok(Json(serde_json::json!({
        "user": public,
    })))
}

//! Authentication and session bootstrap REST handlers.
//!
//! Handles `POST /api/register`, `POST /api/login`, `POST /api/logout`,
//! and `GET /api/bootstrap` using PBKDF2-HMAC-SHA256 credential hashing.

use super::{clean_text, server_view, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, new_token, now, Bootstrap, ChannelKind, Event, LoginRequest, LoginResponse,
    RegisterRequest, RegisterResponse, Role, Server, ServerMemberView, User, UserSettings,
    AVATAR_COLORS,
};
use crate::state::AppState;
use axum::extract::State;
use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use std::collections::HashMap;
use std::sync::Arc;

/// Validates password length bounds (8-128 characters).
pub(crate) fn clean_password(raw: &str) -> ApiResult<&str> {
    let count = raw.chars().count();
    if !(8..=128).contains(&count) {
        return Err(ApiError::BadRequest(
            "password must be 8-128 characters".into(),
        ));
    }
    Ok(raw)
}

fn unauthorized_json() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": "invalid username or password",
            "status": 401
        })),
    )
        .into_response()
}

/// Registers a new user account, hashes password with random salt, and joins `demo` server.
pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterRequest>,
) -> ApiResult<Json<RegisterResponse>> {
    let username = clean_text(&body.username, 32, "username")?;
    clean_password(&body.password)?;

    // Check duplicate username case-insensitively before expensive hashing.
    {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        if store
            .users
            .values()
            .any(|u| u.username.eq_ignore_ascii_case(&username))
        {
            return Err(ApiError::Conflict("username is already taken".into()));
        }
    }

    let salt = crate::crypto::random_salt_hex();
    let hash =
        crate::crypto::hash_password(&body.password, &salt).map_err(|_| ApiError::Internal)?;

    let color = AVATAR_COLORS[username.len() % AVATAR_COLORS.len()].to_string();
    let user = User {
        id: new_id(),
        username: username.clone(),
        display_name: username.clone(),
        color,
        avatar_url: None,
        banner_url: None,
        bio: String::new(),
        status_text: String::new(),
        token: new_token(),
        bot: false,
        created_at: now(),
        password_hash: hash,
        password_salt: salt,
        settings: UserSettings::default(),
    };

    let join_event = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        if store
            .users
            .values()
            .any(|u| u.username.eq_ignore_ascii_case(&username))
        {
            return Err(ApiError::Conflict("username is already taken".into()));
        }
        store.tokens.insert(user.token.clone(), user.id.clone());
        store.users.insert(user.id.clone(), user.clone());

        if let Some(members) = store.members.get_mut("demo") {
            members.insert(user.id.clone(), Role::Member);
            Some(Event::MemberJoin {
                server_id: "demo".into(),
                user: user.public(),
            })
        } else {
            None
        }
    };
    state.persist();
    if let Some(event) = join_event {
        state.emit(event);
    }

    Ok(Json(RegisterResponse {
        token: user.token.clone(),
        user: user.public(),
    }))
}

/// Authenticates username/password and issues a new 64-hex session token.
pub async fn login(State(state): State<Arc<AppState>>, Json(body): Json<LoginRequest>) -> Response {
    let username = body.username.trim();
    if username.is_empty() || body.password.is_empty() {
        return unauthorized_json();
    }

    let user_opt = {
        let store = match state.store.read() {
            Ok(s) => s,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "internal server error",
                        "status": 500
                    })),
                )
                    .into_response();
            }
        };
        store
            .users
            .values()
            .find(|u| u.username.eq_ignore_ascii_case(username))
            .cloned()
    };

    let Some(user) = user_opt else {
        return unauthorized_json();
    };
    if user.bot || user.password_hash.is_empty() || user.password_salt.is_empty() {
        return unauthorized_json();
    }
    if !crate::crypto::verify_password(&body.password, &user.password_salt, &user.password_hash) {
        return unauthorized_json();
    }

    let token = new_token();
    {
        let mut store = match state.store.write() {
            Ok(s) => s,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "internal server error",
                        "status": 500
                    })),
                )
                    .into_response();
            }
        };
        store.tokens.insert(token.clone(), user.id.clone());
        if let Some(u) = store.users.get_mut(&user.id) {
            u.token = token.clone();
        }
    }
    state.persist();

    (
        StatusCode::OK,
        Json(serde_json::json!(LoginResponse {
            token,
            user: user.public(),
        })),
    )
        .into_response()
}

/// Revokes the caller's bearer token if present.
pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .unwrap_or_default();

    if !token.is_empty() {
        if let Ok(mut store) = state.store.write() {
            store.tokens.remove(token);
        }
        state.persist();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "ok" })),
    )
        .into_response()
}

/// Returns initial client state: identity, settings, joined servers, online users, and voice rooms.
pub async fn bootstrap(
    State(state): State<Arc<AppState>>,
    Auth(current_user): Auth,
) -> ApiResult<Json<Bootstrap>> {
    let me = current_user.public();
    let (servers, channels, members, default_server_id, default_channel_id) = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        let mut mine: Vec<&Server> = store
            .servers
            .values()
            .filter(|s| store.is_member(&s.id, &me.id))
            .collect();
        mine.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        let views: Vec<_> = mine
            .iter()
            .map(|s| server_view(&store, &me.id, s))
            .collect();
        let default_server_id = views.first().map(|s| s.id.clone());
        let default_channel_id = views
            .first()
            .and_then(|s| s.channels.iter().find(|c| c.kind == ChannelKind::Text))
            .map(|c| c.id.clone());

        let mut channels_map = HashMap::new();
        let mut members_map = HashMap::new();
        for v in &views {
            channels_map.insert(v.id.clone(), v.channels.clone());
            let mut s_members = Vec::new();
            if let Some(m_map) = store.members.get(&v.id) {
                for (u_id, role) in m_map {
                    if let Some(u) = store.users.get(u_id) {
                        s_members.push(ServerMemberView {
                            id: u.id.clone(),
                            user_id: u.id.clone(),
                            username: u.username.clone(),
                            display_name: u.display_name.clone(),
                            color: u.color.clone(),
                            avatar_url: u.avatar_url.clone(),
                            banner_url: u.banner_url.clone(),
                            bio: u.bio.clone(),
                            status_text: u.status_text.clone(),
                            bot: u.bot,
                            role: *role,
                        });
                    }
                }
            }
            s_members.sort_by(|a, b| a.display_name.cmp(&b.display_name));
            members_map.insert(v.id.clone(), s_members);
        }

        (views, channels_map, members_map, default_server_id, default_channel_id)
    };

    Ok(Json(Bootstrap {
        me,
        settings: current_user.settings,
        servers,
        channels,
        members,
        online: state.online_ids(),
        voice: state.voice_snapshot(),
        default_server_id,
        default_channel_id,
    }))
}

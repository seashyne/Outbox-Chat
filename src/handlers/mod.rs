//! REST API handlers organized by feature domain.
//!
//! Every handler validates auth + membership, mutates the shared store,
//! persists it and emits a realtime event for connected WebSocket clients.

pub mod auth;
#[cfg(test)]
mod auth_tests;
pub mod channels;
pub mod messages;
pub mod servers;
#[cfg(test)]
mod settings_tests;
pub mod users;
pub mod voice;

pub use auth::{bootstrap, login, logout, register};
pub use channels::{create_channel, delete_channel};
pub use messages::{delete_message, list_messages, post_message, toggle_reaction};
pub use servers::{create_server, join_server, leave_server, list_servers};
pub use users::{get_settings, update_profile, update_settings};
pub use voice::{voice_join, voice_leave};

use crate::error::{ApiError, ApiResult};
use crate::model::{Channel, Health, PublicUser, Role, Server, ServerView, Store, User};
use crate::state::AppState;
use axum::extract::{FromRequestParts, State};
use axum::http::{header::AUTHORIZATION, request::Parts};
use axum::Json;
use std::sync::Arc;

/// Extractor that resolves `Authorization: Bearer <token>` into a `User`.
#[derive(Clone, Debug)]
pub struct Auth(pub User);

impl FromRequestParts<Arc<AppState>> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> ApiResult<Self> {
        let header_value = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim);
        let token = header_value
            .filter(|t| !t.is_empty())
            .ok_or(ApiError::Unauthorized)?;

        let user = {
            let store = state.store.read().map_err(|_| ApiError::Internal)?;
            store
                .tokens
                .get(token)
                .and_then(|user_id| store.users.get(user_id))
                .cloned()
        };
        user.map(Auth).ok_or(ApiError::Unauthorized)
    }
}

pub(crate) fn clean_text(raw: &str, max: usize, what: &str) -> ApiResult<String> {
    if raw.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest(format!(
            "{what} cannot contain control characters"
        )));
    }
    let value = raw.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(ApiError::BadRequest(format!(
            "{what} must be 1-{max} characters"
        )));
    }
    Ok(value.to_string())
}

fn is_thai_mark(c: char) -> bool {
    matches!(c, '\u{0E31}'..='\u{0E3A}' | '\u{0E47}'..='\u{0E4E}')
}

pub(crate) fn slug(raw: &str) -> ApiResult<String> {
    let mut value = String::new();
    let mut prev_dash = false;
    for c in raw.trim().to_lowercase().chars() {
        if c.is_alphanumeric() || is_thai_mark(c) || c == '_' {
            value.push(c);
            prev_dash = false;
        } else if !prev_dash && !value.is_empty() {
            value.push('-');
            prev_dash = true;
        }
    }
    let value = value.trim_matches('-').to_string();
    if value.is_empty() || value.chars().count() > 32 {
        return Err(ApiError::BadRequest(
            "channel name must be 1-32 letters, digits, '-' or '_'".into(),
        ));
    }
    Ok(value)
}

pub(crate) fn sorted_channels(store: &Store, server_id: &str) -> Vec<Channel> {
    let mut channels: Vec<Channel> = store
        .channels
        .values()
        .filter(|c| c.server_id == server_id)
        .cloned()
        .collect();
    channels.sort_by(|a, b| {
        (a.kind as i32, a.position, &a.created_at).cmp(&(b.kind as i32, b.position, &b.created_at))
    });
    channels
}

pub(crate) fn server_view(store: &Store, user_id: &str, server: &Server) -> ServerView {
    let mut members: Vec<PublicUser> = store
        .members
        .get(&server.id)
        .map(|map| {
            map.keys()
                .filter_map(|id| store.users.get(id))
                .map(User::public)
                .collect()
        })
        .unwrap_or_default();
    members.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    ServerView {
        id: server.id.clone(),
        name: server.name.clone(),
        icon: server.icon.clone(),
        owner_id: server.owner_id.clone(),
        created_at: server.created_at.clone(),
        role: store.role(&server.id, user_id).unwrap_or(Role::Member),
        channels: sorted_channels(store, &server.id),
        members,
    }
}

pub(crate) fn require_member(store: &Store, server_id: &str, user_id: &str) -> ApiResult<()> {
    if store.is_member(server_id, user_id) {
        Ok(())
    } else {
        Err(ApiError::Forbidden("you are not a member of this server"))
    }
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    let (users, servers, messages) = state
        .store
        .read()
        .map(|store| {
            (
                store.users.len(),
                store.servers.len(),
                store.messages.values().map(Vec::len).sum(),
            )
        })
        .unwrap_or((0, 0, 0));
    Json(Health {
        status: "ok",
        service: "outbox-chat",
        users,
        servers,
        messages,
        online: state.online_ids().len(),
        note: "Outbox Chat พร้อมใช้งาน",
    })
}

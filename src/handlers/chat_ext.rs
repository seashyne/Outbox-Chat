//! Extended Phase 1 chat handlers: message editing, pinning, cross-channel
//! server search, custom server stickers, and automatic URL link preview metadata.

use super::users::parse_image_url;
use super::{clean_text, require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, ChannelKind, CreateStickerRequest, EditMessageRequest, Event, LinkPreviewResponse,
    MessageView, Role, ServerSticker,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;

/// Edits an existing message (author only), marks `edited_at`, and emits `message_update`.
pub async fn edit_message(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(message_id): Path<String>,
    Json(body): Json<EditMessageRequest>,
) -> ApiResult<Json<MessageView>> {
    let content = clean_text(&body.content, 2000, "message")?;
    let (view, server_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let (channel_id, index) = store.locate_message(&message_id).ok_or(ApiError::NotFound("message"))?;
        let parent_id = store
            .threads
            .get(&channel_id)
            .map(|t| t.channel_id.clone())
            .unwrap_or_else(|| channel_id.clone());
        let channel = store.channel(&parent_id).cloned().ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &channel.server_id, &user.id)?;
        if !store.can_view_channel(&channel, &user.id) {
            return Err(ApiError::Forbidden("you cannot access this channel"));
        }

        let updated = {
            let msg = store.messages.get_mut(&channel_id).and_then(|l| l.get_mut(index)).ok_or(ApiError::NotFound("message"))?;
            if msg.author_id != user.id {
                return Err(ApiError::Forbidden("only the author can edit this message"));
            }
            msg.content = content;
            msg.edited_at = Some(now());
            msg.clone()
        };
        let view = store.message_view(&updated, &user.id).ok_or(ApiError::Internal)?;
        (view, channel.server_id)
    };
    state.persist();
    state.emit(Event::MessageUpdate { server_id, message: view.clone(), actor_id: user.id });
    Ok(Json(view))
}

/// Toggles pin state on a message and broadcasts `message_update`.
pub async fn toggle_pin_message(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(message_id): Path<String>,
) -> ApiResult<Json<MessageView>> {
    let (view, server_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let (channel_id, index) = store.locate_message(&message_id).ok_or(ApiError::NotFound("message"))?;
        let parent_id = store
            .threads
            .get(&channel_id)
            .map(|t| t.channel_id.clone())
            .unwrap_or_else(|| channel_id.clone());
        let channel = store.channel(&parent_id).cloned().ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &channel.server_id, &user.id)?;
        if !store.can_view_channel(&channel, &user.id) {
            return Err(ApiError::Forbidden("you cannot access this channel"));
        }

        let updated = {
            let msg = store.messages.get_mut(&channel_id).and_then(|l| l.get_mut(index)).ok_or(ApiError::NotFound("message"))?;
            msg.pinned = !msg.pinned;
            msg.clone()
        };
        let view = store.message_view(&updated, &user.id).ok_or(ApiError::Internal)?;
        (view, channel.server_id)
    };
    state.persist();
    state.emit(Event::MessageUpdate { server_id, message: view.clone(), actor_id: user.id });
    Ok(Json(view))
}

/// Lists all pinned messages in a text channel or DM (newest first).
pub async fn list_pinned_messages(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
) -> ApiResult<Json<Vec<MessageView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let channel = store
        .channel(&channel_id)
        .ok_or(ApiError::NotFound("channel"))?;
    require_member(&store, &channel.server_id, &user.id)?;
    if !store.can_view_channel(channel, &user.id) {
        return Err(ApiError::Forbidden("you cannot access this channel"));
    }
    let mut views: Vec<MessageView> = store
        .messages
        .get(&channel_id)
        .map(|list| {
            list.iter()
                .rev()
                .filter(|m| m.pinned)
                .filter_map(|m| store.message_view(m, &user.id))
                .collect()
        })
        .unwrap_or_default();
    views.truncate(50);
    Ok(Json(views))
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
}

/// Searches messages across all text channels in a server (`GET /api/servers/{id}/search?q=...`).
pub async fn search_server_messages(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> ApiResult<Json<Vec<MessageView>>> {
    let needle = query.q.unwrap_or_default().trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let limit = query.limit.unwrap_or(40).clamp(1, 100);
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    require_member(&store, &server_id, &user.id)?;

    let channel_ids: Vec<String> = store
        .channels
        .values()
        .filter(|c| {
            c.server_id == server_id
                && c.kind == ChannelKind::Text
                && store.can_view_channel(c, &user.id)
        })
        .map(|c| c.id.clone())
        .collect();

    let mut matches: Vec<MessageView> = Vec::new();
    for cid in &channel_ids {
        if let Some(list) = store.messages.get(cid) {
            for msg in list {
                let author_match = store
                    .users
                    .get(&msg.author_id)
                    .is_some_and(|u| u.display_name.to_lowercase().contains(&needle) || u.username.to_lowercase().contains(&needle));
                if msg.content.to_lowercase().contains(&needle) || author_match {
                    if let Some(v) = store.message_view(msg, &user.id) {
                        matches.push(v);
                    }
                }
            }
        }
    }
    matches.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    matches.truncate(limit);
    Ok(Json(matches))
}

/// Lists custom image stickers configured for a server.
pub async fn list_stickers(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<Vec<ServerSticker>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    require_member(&store, &server_id, &user.id)?;
    Ok(Json(
        store
            .stickers
            .get(&server_id)
            .cloned()
            .unwrap_or_default(),
    ))
}

/// Uploads a custom image sticker for a server (`POST /api/servers/{id}/stickers`).
pub async fn create_sticker(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Json(body): Json<CreateStickerRequest>,
) -> ApiResult<Json<ServerSticker>> {
    let name = clean_text(&body.name, 24, "sticker name")?;
    let data_url = parse_image_url(&body.data_url, 65_536)?
        .ok_or_else(|| ApiError::BadRequest("sticker image is required".into()))?;
    let sticker = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        require_member(&store, &server_id, &user.id)?;
        let max_stickers = store.max_stickers_for(&server_id, &user.id);
        let list = store.stickers.entry(server_id.clone()).or_default();
        if list.len() >= max_stickers {
            return Err(ApiError::BadRequest(format!("maximum {max_stickers} stickers per server")));
        }
        let s = ServerSticker {
            id: new_id(),
            server_id,
            name,
            data_url,
            created_by: user.id,
            created_at: now(),
        };
        list.push(s.clone());
        s
    };
    state.persist();
    Ok(Json(sticker))
}

/// Deletes a custom server sticker (creator, admin, or owner).
pub async fn delete_sticker(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path((server_id, sticker_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        require_member(&store, &server_id, &user.id)?;
        let can_manage = store.role(&server_id, &user.id).is_some_and(Role::can_manage);
        let list = store.stickers.get_mut(&server_id).ok_or(ApiError::NotFound("sticker"))?;
        let idx = list.iter().position(|s| s.id == sticker_id).ok_or(ApiError::NotFound("sticker"))?;
        if list[idx].created_by != user.id && !can_manage {
            return Err(ApiError::Forbidden("insufficient permissions to delete sticker"));
        }
        list.remove(idx);
    }
    state.persist();
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct LinkPreviewQuery {
    pub url: String,
}

/// Generates safe structured link preview metadata (`GET /api/links/preview?url=...`).
pub async fn preview_link(
    _auth: Auth,
    Query(query): Query<LinkPreviewQuery>,
) -> ApiResult<Json<LinkPreviewResponse>> {
    let raw = query.url.trim();
    let rest = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .ok_or_else(|| ApiError::BadRequest("only http/https URLs are supported".into()))?;
    let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
    let domain = host_port.split(':').next().unwrap_or("").to_lowercase();
    if domain.is_empty()
        || !domain.contains('.')
        || domain == "localhost"
        || domain.starts_with("127.")
        || domain.starts_with("10.")
        || domain.starts_with("192.168.")
    {
        return Err(ApiError::BadRequest("invalid or private URL".into()));
    }
    let path_part = rest.strip_prefix(host_port).unwrap_or("/").trim_matches('/');
    let yt_id = if domain.contains("youtube.com") {
        raw.split("v=").nth(1).map(|s| s.split(['&', '#']).next().unwrap_or(""))
    } else if domain == "youtu.be" {
        Some(path_part.split(['?', '&', '#']).next().unwrap_or(""))
    } else {
        None
    }
    .filter(|id| id.len() >= 6 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));

    let (title, description, image) = if let Some(vid) = yt_id {
        (
            format!("YouTube Video ({vid})"),
            format!("วิดีโอจาก {domain}"),
            Some(format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg")),
        )
    } else {
        let slug = path_part.split(['?', '#']).next().unwrap_or("").replace(['-', '_'], " ");
        let t = if slug.is_empty() { domain.clone() } else { format!("{domain} — {slug}") };
        (t, format!("ลิงก์เว็บไซต์จาก {domain}"), None)
    };
    Ok(Json(LinkPreviewResponse {
        url: raw.to_string(),
        domain,
        title,
        description,
        image,
    }))
}

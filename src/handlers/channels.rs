use super::moderation::record_audit;
use super::{clean_text, require_member, slug, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, Channel, ChannelKind, ChannelVisibility, CreateChannelRequest, Event, Role,
    UpdateChannelRequest,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use std::sync::Arc;

pub async fn create_channel(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Json(body): Json<CreateChannelRequest>,
) -> ApiResult<Json<Channel>> {
    let name = if body.kind == ChannelKind::Text {
        slug(&body.name)?
    } else {
        clean_text(&body.name, 32, "channel name")?
    };
    let topic = body.topic.trim().chars().take(180).collect::<String>();

    let channel = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let server = store
            .servers
            .get(&server_id)
            .cloned()
            .ok_or(ApiError::NotFound("server"))?;
        require_member(&store, &server_id, &user.id)?;
        let role = store
            .role(&server_id, &user.id)
            .unwrap_or(crate::model::Role::Member);
        if !role.can_manage() && !server.roles_config.allow_member_create_channel {
            return Err(ApiError::Forbidden(
                "only server owners and admins can create channels",
            ));
        }
        let position = store
            .channels
            .values()
            .filter(|c| c.server_id == server_id && c.kind == body.kind)
            .count() as i64;
        let category = body
            .category
            .as_deref()
            .map(|s| s.trim().chars().take(32).collect::<String>())
            .filter(|s| !s.is_empty());
        let channel = Channel {
            id: new_id(),
            server_id: server_id.clone(),
            name,
            kind: body.kind,
            topic,
            category,
            visibility: ChannelVisibility::Public,
            read_only: false,
            slowmode_seconds: 0,
            position,
            created_at: now(),
        };
        store.channels.insert(channel.id.clone(), channel.clone());
        channel
    };
    state.persist();
    state.emit(Event::ChannelCreate {
        server_id,
        channel: channel.clone(),
    });
    Ok(Json(channel))
}

pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let server_id = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let channel = store
            .channels
            .get(&channel_id)
            .ok_or(ApiError::NotFound("channel"))?;
        let server_id = channel.server_id.clone();
        require_member(&store, &server_id, &user.id)?;
        let role = store
            .role(&server_id, &user.id)
            .unwrap_or(crate::model::Role::Member);
        if !role.can_manage() {
            return Err(ApiError::Forbidden(
                "only server owners and admins can delete channels",
            ));
        }
        store.channels.remove(&channel_id);
        if let Some(msgs) = store.messages.remove(&channel_id) {
            for m in msgs {
                store.message_index.remove(&m.id);
            }
        }
        server_id
    };
    state.persist();
    state.emit(Event::ChannelDelete {
        server_id,
        channel_id: channel_id.clone(),
    });
    Ok(Json(serde_json::json!({
        "success": true,
        "channel_id": channel_id,
    })))
}

/// Updates channel name, topic, category, visibility, read-only, or slowmode (`PATCH /api/channels/{id}`).
pub async fn update_channel(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path(channel_id): Path<String>,
    Json(body): Json<UpdateChannelRequest>,
) -> ApiResult<Json<Channel>> {
    if channel_id.starts_with("dm:") {
        return Err(ApiError::BadRequest("cannot edit a direct message channel".into()));
    }
    if body.slowmode_seconds.is_some_and(|s| s > 21_600) {
        return Err(ApiError::BadRequest("slowmode must be 0-21600 seconds".into()));
    }
    let updated = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let mut ch = store.channel(&channel_id).cloned().ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &ch.server_id, &actor.id)?;
        if !store.role(&ch.server_id, &actor.id).is_some_and(Role::can_manage) {
            return Err(ApiError::Forbidden("only server owners and admins can edit channels"));
        }
        if let Some(raw) = body.name.as_deref() {
            ch.name = if ch.kind == ChannelKind::Text { slug(raw)? } else { clean_text(raw, 32, "channel name")? };
        }
        if let Some(raw) = body.topic.as_deref() {
            ch.topic = raw.trim().chars().take(180).collect();
        }
        if let Some(raw) = body.category.as_deref() {
            let trimmed: String = raw.trim().chars().take(32).collect();
            ch.category = (!trimmed.is_empty()).then_some(trimmed);
        }
        if let Some(vis) = body.visibility { ch.visibility = vis; }
        if let Some(ro) = body.read_only { ch.read_only = ro; }
        if let Some(secs) = body.slowmode_seconds { ch.slowmode_seconds = secs; }
        store.channels.insert(ch.id.clone(), ch.clone());
        let detail = format!("vis={:?},ro={},slow={}s", ch.visibility, ch.read_only, ch.slowmode_seconds);
        record_audit(&mut store, &ch.server_id, &actor, "channel_update", &ch.id, &ch.name, detail);
        ch
    };
    state.persist();
    state.emit(Event::ChannelUpdate { server_id: updated.server_id.clone(), channel: updated.clone() });
    Ok(Json(updated))
}

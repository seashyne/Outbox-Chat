use super::{clean_text, require_member, slug, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{new_id, now, Channel, ChannelKind, CreateChannelRequest, Event};
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
        let channel = Channel {
            id: new_id(),
            server_id: server_id.clone(),
            name,
            kind: body.kind,
            topic,
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

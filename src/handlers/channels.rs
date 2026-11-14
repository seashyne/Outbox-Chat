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
        store
            .servers
            .get(&server_id)
            .ok_or(ApiError::NotFound("server"))?;
        require_member(&store, &server_id, &user.id)?;
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

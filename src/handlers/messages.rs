use super::{clean_text, require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, ChannelKind, CreateMessageRequest, Event, Message, MessageView, ReactionRequest,
    Role,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    pub limit: Option<usize>,
    pub before: Option<String>,
}

pub async fn list_messages(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> ApiResult<Json<Vec<MessageView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let channel = store
        .channel(&channel_id)
        .ok_or(ApiError::NotFound("channel"))?;
    require_member(&store, &channel.server_id, &user.id)?;
    if channel.kind != ChannelKind::Text {
        return Err(ApiError::BadRequest(
            "voice channels do not have a message history".into(),
        ));
    }

    let mut messages = store.messages.get(&channel_id).cloned().unwrap_or_default();
    if let Some(before) = query.before {
        if let Some(index) = messages.iter().position(|m| m.id == before) {
            messages.truncate(index);
        }
    }
    let limit = query.limit.unwrap_or(60).clamp(1, 200);
    let start = messages.len().saturating_sub(limit);
    let views = messages[start..]
        .iter()
        .filter_map(|m| store.message_view(m, &user.id))
        .collect();
    Ok(Json(views))
}

pub async fn post_message(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
    Json(body): Json<CreateMessageRequest>,
) -> ApiResult<Json<MessageView>> {
    let content = clean_text(&body.content, 2000, "message")?;
    let (view, server_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let channel = store
            .channel(&channel_id)
            .cloned()
            .ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &channel.server_id, &user.id)?;
        if channel.kind != ChannelKind::Text {
            return Err(ApiError::BadRequest(
                "cannot post messages to a voice channel".into(),
            ));
        }
        let reply_to = body.reply_to.filter(|reply_id| {
            store
                .messages
                .get(&channel_id)
                .is_some_and(|history| history.iter().any(|m| m.id == *reply_id))
        });
        let message = Message {
            id: new_id(),
            channel_id: channel_id.clone(),
            author_id: user.id.clone(),
            content,
            created_at: now(),
            edited_at: None,
            reply_to,
            reactions: HashMap::new(),
        };
        store.insert_message(channel_id, message.clone());
        let view = store
            .message_view(&message, &user.id)
            .ok_or(ApiError::Internal)?;
        (view, channel.server_id)
    };
    state.persist();
    state.emit(Event::MessageCreate {
        server_id,
        message: view.clone(),
    });
    Ok(Json(view))
}

pub async fn delete_message(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(message_id): Path<String>,
) -> ApiResult<StatusCode> {
    let (server_id, channel_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let (channel_id, index) = store
            .locate_message(&message_id)
            .ok_or(ApiError::NotFound("message"))?;
        let channel = store
            .channel(&channel_id)
            .cloned()
            .ok_or(ApiError::NotFound("channel"))?;
        let author_id = store.messages[&channel_id][index].author_id.clone();
        let can_manage = store
            .role(&channel.server_id, &user.id)
            .is_some_and(Role::can_manage);
        if author_id != user.id && !can_manage {
            return Err(ApiError::Forbidden(
                "only the author or a server admin can delete this message",
            ));
        }
        store.remove_message(&channel_id, index);
        (channel.server_id, channel_id)
    };
    state.persist();
    state.emit(Event::MessageDelete {
        server_id,
        channel_id,
        message_id,
    });
    Ok(StatusCode::NO_CONTENT)
}

/// Toggle a reaction on/off for the current user. The whole updated message is
/// broadcast so every client stays in sync without refetching the channel.
pub async fn toggle_reaction(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(message_id): Path<String>,
    Json(body): Json<ReactionRequest>,
) -> ApiResult<Json<MessageView>> {
    let emoji: String = body.emoji.trim().chars().take(8).collect();
    const ALLOWED_REACTIONS: &[&str] = &["+1", "Like", "Ack", "Done", "Help", "Idea"];
    if !ALLOWED_REACTIONS.contains(&emoji.as_str()) {
        return Err(ApiError::BadRequest(
            "only clean text reactions are supported".into(),
        ));
    }
    let (view, server_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let (channel_id, index) = store
            .locate_message(&message_id)
            .ok_or(ApiError::NotFound("message"))?;
        let channel = store
            .channels
            .get(&channel_id)
            .cloned()
            .ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &channel.server_id, &user.id)?;

        let updated = {
            let message = store
                .messages
                .get_mut(&channel_id)
                .and_then(|history| history.get_mut(index))
                .ok_or(ApiError::NotFound("message"))?;
            let users = message.reactions.entry(emoji).or_default();
            if let Some(position) = users.iter().position(|id| id == &user.id) {
                users.remove(position);
            } else {
                users.push(user.id.clone());
            }
            message.reactions.retain(|_, users| !users.is_empty());
            message.clone()
        };
        let view = store
            .message_view(&updated, &user.id)
            .ok_or(ApiError::Internal)?;
        (view, channel.server_id)
    };
    state.persist();
    state.emit(Event::MessageUpdate {
        server_id,
        message: view.clone(),
        actor_id: user.id,
    });
    Ok(Json(view))
}

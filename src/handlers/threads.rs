//! Channel and message discussion thread handlers.

use super::files::validate_attachments;
use super::{active_timeout_until, clean_text, require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, Channel, ChannelKind, ChannelThread, CreateMessageRequest, CreateThreadRequest,
    Event, Message, MessageView, Role, Store, ThreadView,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

fn build_thread_view(store: &Store, thread: &ChannelThread) -> ThreadView {
    let creator_name = store
        .users
        .get(&thread.created_by)
        .map(|u| u.display_name.clone())
        .unwrap_or_else(|| "สมาชิก".to_string());
    let messages = store.messages.get(&thread.id);
    let message_count = messages.map(Vec::len).unwrap_or(0);
    let last_message_at = messages.and_then(|list| list.last()).map(|m| m.created_at.clone());
    ThreadView {
        id: thread.id.clone(),
        server_id: thread.server_id.clone(),
        channel_id: thread.channel_id.clone(),
        parent_message_id: thread.parent_message_id.clone(),
        title: thread.title.clone(),
        created_by: thread.created_by.clone(),
        creator_name,
        created_at: thread.created_at.clone(),
        message_count,
        last_message_at,
    }
}

fn require_writable_text_channel(store: &Store, channel: &Channel, user_id: &str) -> ApiResult<()> {
    require_member(store, &channel.server_id, user_id)?;
    if !store.can_view_channel(channel, user_id) {
        return Err(ApiError::Forbidden("you cannot access this channel"));
    }
    if channel.kind != ChannelKind::Text {
        return Err(ApiError::BadRequest("threads require a text channel".into()));
    }
    let is_manager = store.role(&channel.server_id, user_id).is_some_and(Role::can_manage);
    if !channel.id.starts_with("dm:")
        && active_timeout_until(store, &channel.server_id, user_id).is_some()
    {
        return Err(ApiError::Forbidden("you are currently timed out in this server"));
    }
    if channel.read_only && !is_manager {
        return Err(ApiError::Forbidden("this channel is read-only"));
    }
    Ok(())
}

/// Lists all discussion threads under a channel (`GET /api/channels/{id}/threads`).
pub async fn list_threads(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
) -> ApiResult<Json<Vec<ThreadView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let channel = store.channel(&channel_id).ok_or(ApiError::NotFound("channel"))?;
    require_member(&store, &channel.server_id, &user.id)?;
    if !store.can_view_channel(channel, &user.id) {
        return Err(ApiError::Forbidden("you cannot access this channel"));
    }
    let mut views: Vec<ThreadView> = store
        .threads
        .values()
        .filter(|t| t.channel_id == channel_id)
        .map(|t| build_thread_view(&store, t))
        .collect();
    views.sort_by(|a, b| {
        let a_ts = a.last_message_at.as_deref().unwrap_or(&a.created_at);
        let b_ts = b.last_message_at.as_deref().unwrap_or(&b.created_at);
        b_ts.cmp(a_ts)
    });
    Ok(Json(views))
}

/// Creates a discussion thread in a text channel or attached to a message (`POST /api/channels/{id}/threads`).
pub async fn create_thread(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
    Json(body): Json<CreateThreadRequest>,
) -> ApiResult<Json<ThreadView>> {
    let title = clean_text(&body.title, 80, "thread title")?;
    let initial_content = match body.content.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(clean_text(raw, 2000, "message")?),
        _ => None,
    };
    let (view, first_msg) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let channel = store.channel(&channel_id).cloned().ok_or(ApiError::NotFound("channel"))?;
        require_writable_text_channel(&store, &channel, &user.id)?;
        if let Some(pid) = body.parent_message_id.as_deref() {
            let exists = store.messages.get(&channel_id).is_some_and(|l| l.iter().any(|m| m.id == pid));
            if !exists {
                return Err(ApiError::NotFound("message"));
            }
            if store.threads.values().any(|t| t.parent_message_id.as_deref() == Some(pid)) {
                return Err(ApiError::Conflict("a thread already exists for this message".into()));
            }
        }
        let thread = ChannelThread {
            id: new_id(),
            server_id: channel.server_id.clone(),
            channel_id: channel_id.clone(),
            parent_message_id: body.parent_message_id,
            title,
            created_by: user.id.clone(),
            created_at: now(),
        };
        store.threads.insert(thread.id.clone(), thread.clone());
        let first_msg = if let Some(text) = initial_content {
            let msg = Message {
                id: new_id(),
                channel_id: thread.id.clone(),
                author_id: user.id.clone(),
                content: text,
                created_at: now(),
                edited_at: None,
                reply_to: None,
                reactions: HashMap::new(),
                attachments: Vec::new(),
                pinned: false,
            };
            store.insert_message(thread.id.clone(), msg.clone());
            store.message_view(&msg, &user.id)
        } else {
            None
        };
        (build_thread_view(&store, &thread), first_msg)
    };
    state.persist();
    state.emit(Event::ThreadCreate { server_id: view.server_id.clone(), thread: view.clone() });
    if let Some(msg) = first_msg {
        state.emit(Event::ThreadMessageCreate {
            server_id: view.server_id.clone(),
            thread_id: view.id.clone(),
            channel_id: view.channel_id.clone(),
            message: msg,
        });
    }
    Ok(Json(view))
}

#[derive(Debug, Deserialize)]
pub struct ThreadMessagesQuery {
    pub limit: Option<usize>,
}

/// Lists messages inside a discussion thread (`GET /api/threads/{id}/messages`).
pub async fn list_thread_messages(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(thread_id): Path<String>,
    Query(query): Query<ThreadMessagesQuery>,
) -> ApiResult<Json<Vec<MessageView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let thread = store.threads.get(&thread_id).ok_or(ApiError::NotFound("thread"))?;
    let channel = store.channel(&thread.channel_id).ok_or(ApiError::NotFound("channel"))?;
    require_member(&store, &channel.server_id, &user.id)?;
    if !store.can_view_channel(channel, &user.id) {
        return Err(ApiError::Forbidden("you cannot access this channel"));
    }
    let messages = store.messages.get(&thread_id).cloned().unwrap_or_default();
    let limit = query.limit.unwrap_or(100).clamp(1, 200);
    let start = messages.len().saturating_sub(limit);
    let views = messages[start..].iter().filter_map(|m| store.message_view(m, &user.id)).collect();
    Ok(Json(views))
}

/// Posts a reply into a discussion thread (`POST /api/threads/{id}/messages`).
pub async fn post_thread_message(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(thread_id): Path<String>,
    Json(body): Json<CreateMessageRequest>,
) -> ApiResult<Json<MessageView>> {
    let attachments = validate_attachments(&body.attachments)?;
    let content = if attachments.is_empty() || !body.content.trim().is_empty() {
        clean_text(&body.content, 2000, "message")?
    } else if body.content.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest("message cannot contain control characters".into()));
    } else {
        String::new()
    };
    let (view, server_id, channel_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let thread = store.threads.get(&thread_id).cloned().ok_or(ApiError::NotFound("thread"))?;
        let channel = store.channel(&thread.channel_id).cloned().ok_or(ApiError::NotFound("channel"))?;
        require_writable_text_channel(&store, &channel, &user.id)?;
        let msg = Message {
            id: new_id(),
            channel_id: thread_id.clone(),
            author_id: user.id.clone(),
            content,
            created_at: now(),
            edited_at: None,
            reply_to: None,
            reactions: HashMap::new(),
            attachments,
            pinned: false,
        };
        store.insert_message(thread_id.clone(), msg.clone());
        let view = store.message_view(&msg, &user.id).ok_or(ApiError::Internal)?;
        (view, channel.server_id, thread.channel_id)
    };
    state.persist();
    state.emit(Event::ThreadMessageCreate { server_id, thread_id, channel_id, message: view.clone() });
    Ok(Json(view))
}

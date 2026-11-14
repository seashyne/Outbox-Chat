use super::{clean_text, server_view, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, Channel, ChannelKind, CreateServerRequest, Event, Role, Server, ServerSummary,
    ServerView,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use std::collections::HashMap;
use std::sync::Arc;

/// Public server directory - lets a second user discover and join servers.
pub async fn list_servers(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
) -> ApiResult<Json<Vec<ServerSummary>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let mut servers: Vec<ServerSummary> = store
        .servers
        .values()
        .map(|s| ServerSummary {
            id: s.id.clone(),
            name: s.name.clone(),
            icon: s.icon.clone(),
            member_count: store.members.get(&s.id).map(HashMap::len).unwrap_or(0),
            joined: store.is_member(&s.id, &user.id),
        })
        .collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(servers))
}

pub async fn create_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<CreateServerRequest>,
) -> ApiResult<Json<ServerView>> {
    let name = clean_text(&body.name, 48, "server name")?;
    let icon = body
        .icon
        .map(|i| i.trim().chars().take(4).collect::<String>())
        .filter(|i| !i.is_empty())
        .unwrap_or_else(|| name.chars().next().unwrap().to_uppercase().collect());

    let server = Server {
        id: new_id(),
        name,
        icon,
        owner_id: user.id.clone(),
        created_at: now(),
    };
    let general = Channel {
        id: new_id(),
        server_id: server.id.clone(),
        name: "general".into(),
        kind: ChannelKind::Text,
        topic: "ช่องทั่วไป".into(),
        position: 0,
        created_at: now(),
    };
    let view = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let mut members = HashMap::new();
        members.insert(user.id.clone(), Role::Owner);
        store.members.insert(server.id.clone(), members);
        store.channels.insert(general.id.clone(), general);
        store.servers.insert(server.id.clone(), server.clone());
        server_view(&store, &user.id, &server)
    };
    state.persist();
    state.emit(Event::ServerCreate {
        server: server.clone(),
    });
    Ok(Json(view))
}

pub async fn join_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<ServerView>> {
    let (view, joined) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let server = store
            .servers
            .get(&server_id)
            .cloned()
            .ok_or(ApiError::NotFound("server"))?;
        let members = store.members.entry(server_id.clone()).or_default();
        let joined = !members.contains_key(&user.id);
        members.entry(user.id.clone()).or_insert(Role::Member);
        (server_view(&store, &user.id, &server), joined)
    };
    state.persist();
    if joined {
        state.emit(Event::MemberJoin {
            server_id,
            user: user.public(),
        });
    }
    Ok(Json(view))
}

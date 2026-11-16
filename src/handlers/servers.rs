//! Server directory, template-backed creation, server settings, and role assignment handlers.

use super::server_templates::{
    apply_roles_patch, build_template_channels, clean_optional_text, resolve_template, validate_color,
};
use super::{clean_text, server_view, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, CreateServerRequest, Event, Role, Server, ServerRolesConfig, ServerSummary,
    ServerView, UpdateMemberRoleRequest, UpdateServerRequest,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use std::collections::HashMap;
use std::sync::Arc;

/// Lists all servers with membership flags, metadata, and member counts.
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
            description: s.description.clone(),
            accent_color: s.accent_color.clone(),
            member_count: store.members.get(&s.id).map(HashMap::len).unwrap_or(0),
            joined: store.is_member(&s.id, &user.id),
        })
        .collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(servers))
}

/// Creates a new server from a starter template with custom metadata and role config.
pub async fn create_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<CreateServerRequest>,
) -> ApiResult<Json<ServerView>> {
    let name = clean_text(&body.name, 48, "server name")?;
    let spec = resolve_template(body.template.as_deref())?;
    let icon = body
        .icon
        .map(|i| i.trim().chars().take(4).collect::<String>())
        .filter(|i| !i.is_empty())
        .unwrap_or_else(|| name.chars().next().unwrap().to_uppercase().collect());
    let description = match body.description.as_deref() {
        Some(raw) => clean_optional_text(raw, 180, "server description")?,
        None => spec.description.to_string(),
    };
    let accent_color = match body.accent_color.as_deref() {
        Some(raw) => validate_color(raw, "accent_color")?,
        None => spec.accent_color.to_string(),
    };
    let mut roles_config = ServerRolesConfig {
        admin_label: spec.admin_label.to_string(),
        member_label: spec.member_label.to_string(),
        ..ServerRolesConfig::default()
    };
    if let Some(ref patch) = body.roles_config {
        apply_roles_patch(&mut roles_config, patch)?;
    }

    let server = Server {
        id: new_id(),
        name,
        icon,
        description,
        accent_color,
        roles_config,
        owner_id: user.id.clone(),
        created_at: now(),
    };
    let channels = build_template_channels(&server.id, &spec);
    let view = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let mut members = HashMap::new();
        members.insert(user.id.clone(), Role::Owner);
        store.members.insert(server.id.clone(), members);
        for channel in channels {
            store.channels.insert(channel.id.clone(), channel);
        }
        store.servers.insert(server.id.clone(), server.clone());
        server_view(&store, &user.id, &server)
    };
    state.persist();
    state.emit(Event::ServerCreate { server });
    Ok(Json(view))
}

/// Updates server name, icon, description, accent color, or role configuration (owner/admin).
pub async fn update_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Json(body): Json<UpdateServerRequest>,
) -> ApiResult<Json<ServerView>> {
    let (server, view) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let role = store
            .role(&server_id, &user.id)
            .ok_or(ApiError::Forbidden("you are not a member of this server"))?;
        if !role.can_manage() {
            return Err(ApiError::Forbidden("only server owners and admins can edit server settings"));
        }
        let server = store
            .servers
            .get_mut(&server_id)
            .ok_or(ApiError::NotFound("server"))?;
        if let Some(ref name) = body.name {
            server.name = clean_text(name, 48, "server name")?;
        }
        if let Some(ref icon_raw) = body.icon {
            let trimmed: String = icon_raw.trim().chars().take(4).collect();
            if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
                return Err(ApiError::BadRequest("icon must be 1-4 characters".into()));
            }
            server.icon = trimmed;
        }
        if let Some(ref desc) = body.description {
            server.description = clean_optional_text(desc, 180, "server description")?;
        }
        if let Some(ref color) = body.accent_color {
            server.accent_color = validate_color(color, "accent_color")?;
        }
        if let Some(ref patch) = body.roles_config {
            apply_roles_patch(&mut server.roles_config, patch)?;
        }
        let updated = server.clone();
        let view = server_view(&store, &user.id, &updated);
        (updated, view)
    };
    state.persist();
    state.emit(Event::ServerUpdate { server });
    Ok(Json(view))
}

/// Promotes or demotes a non-owner server member between `admin` and `member` (owner only).
pub async fn update_member_role(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path((server_id, target_user_id)): Path<(String, String)>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if body.role == Role::Owner {
        return Err(ApiError::BadRequest("cannot assign owner role directly".into()));
    }
    let view = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let server = store
            .servers
            .get(&server_id)
            .cloned()
            .ok_or(ApiError::NotFound("server"))?;
        if server.owner_id != user.id {
            return Err(ApiError::Forbidden("only the server owner can change member roles"));
        }
        if target_user_id == server.owner_id {
            return Err(ApiError::BadRequest("cannot change the server owner role".into()));
        }
        let members = store
            .members
            .get_mut(&server_id)
            .ok_or(ApiError::NotFound("server"))?;
        let slot = members
            .get_mut(&target_user_id)
            .ok_or(ApiError::NotFound("member"))?;
        *slot = body.role;
        server_view(&store, &user.id, &server)
    };
    state.persist();
    state.emit(Event::MemberRoleUpdate {
        server_id: server_id.clone(),
        user_id: target_user_id.clone(),
        role: body.role,
    });
    Ok(Json(serde_json::json!({
        "success": true,
        "server_id": server_id,
        "user_id": target_user_id,
        "role": body.role,
        "server": view,
    })))
}

/// Adds the authenticated user as a `member` of `server_id`.
pub async fn join_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<ServerView>> {
    let (view, joined) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let server = store.servers.get(&server_id).cloned().ok_or(ApiError::NotFound("server"))?;
        let members = store.members.entry(server_id.clone()).or_default();
        let joined = !members.contains_key(&user.id);
        members.entry(user.id.clone()).or_insert(Role::Member);
        (server_view(&store, &user.id, &server), joined)
    };
    state.persist();
    if joined {
        state.emit(Event::MemberJoin { server_id, user: user.public() });
    }
    Ok(Json(view))
}

/// Removes a non-owner member from `server_id`.
pub async fn leave_server(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let server = store.servers.get(&server_id).ok_or(ApiError::NotFound("server"))?;
        if server.owner_id == user.id {
            return Err(ApiError::BadRequest("server owner cannot leave the server".into()));
        }
        if !store.is_member(&server_id, &user.id) {
            return Err(ApiError::BadRequest("you are not a member of this server".into()));
        }
        if let Some(members) = store.members.get_mut(&server_id) {
            members.remove(&user.id);
        }
    }
    state.persist();
    state.emit(Event::MemberLeave { server_id: server_id.clone(), user_id: user.id.clone() });
    Ok(Json(serde_json::json!({ "success": true, "server_id": server_id })))
}

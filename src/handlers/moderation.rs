//! Server moderation handlers: kick, ban/unban, temporary timeouts, and audit logs.

use super::{require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, AuditLogEntry, BanMemberRequest, BanView, Event, Role, Server, ServerBan, Store,
    TimeoutMemberRequest, User,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, SecondsFormat, Utc};
use std::sync::Arc;

/// Appends an entry to a server's audit log, keeping the most recent 200 records.
pub(crate) fn record_audit(
    store: &mut Store,
    server_id: &str,
    actor: &User,
    action: &str,
    target_id: &str,
    target_name: &str,
    detail: String,
) {
    let list = store.audit_logs.entry(server_id.to_string()).or_default();
    list.push(AuditLogEntry {
        id: new_id(),
        actor_id: actor.id.clone(),
        actor_name: actor.display_name.clone(),
        action: action.to_string(),
        target_id: target_id.to_string(),
        target_name: target_name.to_string(),
        detail,
        created_at: now(),
    });
    if list.len() > 200 {
        let excess = list.len() - 200;
        list.drain(0..excess);
    }
}

fn display_name(store: &Store, user_id: &str) -> String {
    store
        .users
        .get(user_id)
        .map(|u| u.display_name.clone())
        .unwrap_or_else(|| user_id.to_string())
}

fn require_manager(store: &Store, server_id: &str, actor_id: &str) -> ApiResult<Role> {
    if !store.servers.contains_key(server_id) {
        return Err(ApiError::NotFound("server"));
    }
    require_member(store, server_id, actor_id)?;
    let role = store.role(server_id, actor_id).unwrap_or(Role::Member);
    if !role.can_manage() {
        return Err(ApiError::Forbidden("only server owners and admins can moderate members"));
    }
    Ok(role)
}

fn resolve_target(store: &Store, server_id: &str, actor_id: &str, target_id: &str) -> ApiResult<Server> {
    let actor_role = require_manager(store, server_id, actor_id)?;
    let server = store.servers.get(server_id).cloned().ok_or(ApiError::NotFound("server"))?;
    if target_id == actor_id {
        return Err(ApiError::BadRequest("cannot moderate your own account".into()));
    }
    if target_id == server.owner_id {
        return Err(ApiError::Forbidden("cannot moderate the server owner"));
    }
    if store.role(server_id, target_id).is_some_and(Role::can_manage) && actor_role != Role::Owner {
        return Err(ApiError::Forbidden("only the server owner can moderate admins"));
    }
    Ok(server)
}

/// Kicks a member out of the server (`POST /api/servers/{id}/members/{uid}/kick`).
pub async fn kick_member(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path((server_id, target_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        resolve_target(&store, &server_id, &actor.id, &target_id)?;
        if !store.is_member(&server_id, &target_id) {
            return Err(ApiError::NotFound("member"));
        }
        if let Some(members) = store.members.get_mut(&server_id) {
            members.remove(&target_id);
        }
        store.timeouts.remove(&format!("{server_id}:{target_id}"));
        let name = display_name(&store, &target_id);
        record_audit(&mut store, &server_id, &actor, "member_kick", &target_id, &name, String::new());
    }
    state.persist();
    state.emit(Event::MemberLeave { server_id, user_id: target_id });
    Ok(StatusCode::NO_CONTENT)
}

/// Bans a user from a server (`POST /api/servers/{id}/members/{uid}/ban`).
pub async fn ban_member(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path((server_id, target_id)): Path<(String, String)>,
    body: Option<Json<BanMemberRequest>>,
) -> ApiResult<Json<ServerBan>> {
    let reason: String = body
        .and_then(|Json(b)| b.reason)
        .unwrap_or_default()
        .trim()
        .chars()
        .take(200)
        .collect();
    let (ban, was_member) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        resolve_target(&store, &server_id, &actor.id, &target_id)?;
        if !store.users.contains_key(&target_id) {
            return Err(ApiError::NotFound("user"));
        }
        let was_member = store.members.get_mut(&server_id).and_then(|m| m.remove(&target_id)).is_some();
        store.timeouts.remove(&format!("{server_id}:{target_id}"));
        let ban = ServerBan { user_id: target_id.clone(), banned_by: actor.id.clone(), reason: reason.clone(), created_at: now() };
        store.bans.entry(server_id.clone()).or_default().insert(target_id.clone(), ban.clone());
        let name = display_name(&store, &target_id);
        record_audit(&mut store, &server_id, &actor, "member_ban", &target_id, &name, reason);
        (ban, was_member)
    };
    state.persist();
    if was_member {
        state.emit(Event::MemberLeave { server_id, user_id: target_id });
    }
    Ok(Json(ban))
}

/// Removes a ban from a server (`DELETE /api/servers/{id}/bans/{uid}`).
pub async fn unban_member(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path((server_id, target_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        require_manager(&store, &server_id, &actor.id)?;
        let removed = store.bans.get_mut(&server_id).and_then(|b| b.remove(&target_id)).is_some();
        if !removed {
            return Err(ApiError::NotFound("ban"));
        }
        let name = display_name(&store, &target_id);
        record_audit(&mut store, &server_id, &actor, "member_unban", &target_id, &name, String::new());
    }
    state.persist();
    Ok(StatusCode::NO_CONTENT)
}

/// Lists all banned users in a server (`GET /api/servers/{id}/bans`).
pub async fn list_bans(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<Vec<BanView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    require_manager(&store, &server_id, &actor.id)?;
    let mut views: Vec<BanView> = store
        .bans
        .get(&server_id)
        .map(|map| {
            map.values()
                .filter_map(|ban| {
                    let user = store.users.get(&ban.user_id)?.public();
                    let banned_by_name = store.users.get(&ban.banned_by).map(|u| u.display_name.clone()).unwrap_or_else(|| "ผู้ดูแล".into());
                    Some(BanView { user, reason: ban.reason.clone(), banned_by_name, created_at: ban.created_at.clone() })
                })
                .collect()
        })
        .unwrap_or_default();
    views.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(views))
}

/// Applies or clears a temporary mute timeout (`POST /api/servers/{id}/members/{uid}/timeout`).
pub async fn timeout_member(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path((server_id, target_id)): Path<(String, String)>,
    Json(body): Json<TimeoutMemberRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if body.minutes > 10_080 {
        return Err(ApiError::BadRequest("timeout duration must be 0-10080 minutes".into()));
    }
    let timeout_until = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        resolve_target(&store, &server_id, &actor.id, &target_id)?;
        if !store.is_member(&server_id, &target_id) {
            return Err(ApiError::NotFound("member"));
        }
        let key = format!("{server_id}:{target_id}");
        let until = if body.minutes == 0 {
            store.timeouts.remove(&key);
            None
        } else {
            let iso = (Utc::now() + Duration::minutes(i64::from(body.minutes))).to_rfc3339_opts(SecondsFormat::Millis, true);
            store.timeouts.insert(key, iso.clone());
            Some(iso)
        };
        let name = display_name(&store, &target_id);
        let action = if body.minutes == 0 { "member_timeout_clear" } else { "member_timeout" };
        let detail = if body.minutes == 0 { "cleared".into() } else { format!("{}m", body.minutes) };
        record_audit(&mut store, &server_id, &actor, action, &target_id, &name, detail);
        until
    };
    state.persist();
    Ok(Json(serde_json::json!({ "user_id": target_id, "timeout_until": timeout_until })))
}

/// Lists recent moderation and administration audit logs (`GET /api/servers/{id}/audit`).
pub async fn list_audit_logs(
    State(state): State<Arc<AppState>>,
    Auth(actor): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<Vec<AuditLogEntry>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    require_manager(&store, &server_id, &actor.id)?;
    let logs = store
        .audit_logs
        .get(&server_id)
        .map(|list| list.iter().rev().take(100).cloned().collect())
        .unwrap_or_default();
    Ok(Json(logs))
}

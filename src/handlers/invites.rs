//! Server invite link handlers: create with expiry/max-use limits, list, preview, join, revoke.

use super::{require_member, server_view, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    new_id, now, CreateInviteRequest, Event, InvitePreview, InviteView, Role, ServerInvite,
    ServerView,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use std::sync::Arc;

fn is_expired(expires_at: Option<&str>) -> bool {
    let Some(raw) = expires_at else {
        return false;
    };
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true)
}

fn is_exhausted(max_uses: Option<u32>, uses: u32) -> bool {
    max_uses.is_some_and(|max| uses >= max)
}

fn to_view(store: &crate::model::Store, inv: &ServerInvite) -> InviteView {
    let creator_name = store
        .users
        .get(&inv.created_by)
        .map(|u| u.display_name.clone())
        .unwrap_or_else(|| "สมาชิก".to_string());
    InviteView {
        code: inv.code.clone(),
        server_id: inv.server_id.clone(),
        created_by: inv.created_by.clone(),
        creator_name,
        created_at: inv.created_at.clone(),
        expires_at: inv.expires_at.clone(),
        max_uses: inv.max_uses,
        uses: inv.uses,
        expired: is_expired(inv.expires_at.as_deref()),
        exhausted: is_exhausted(inv.max_uses, inv.uses),
    }
}

/// Lists all invite links created for server `{id}` (for existing members).
pub async fn list_invites(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
) -> ApiResult<Json<Vec<InviteView>>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    require_member(&store, &server_id, &user.id)?;
    let mut views: Vec<InviteView> = store
        .invites
        .values()
        .filter(|inv| inv.server_id == server_id)
        .map(|inv| to_view(&store, inv))
        .collect();
    views.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(views))
}

/// Creates a shareable server invite link with optional expiry hours and max use count.
pub async fn create_invite(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Json(body): Json<CreateInviteRequest>,
) -> ApiResult<Json<InviteView>> {
    let expires_at = match body.expires_in_hours {
        Some(hrs) if hrs > 0.0 && hrs <= 720.0 && hrs.is_finite() => {
            let secs = (hrs * 3600.0).round() as i64;
            Some((Utc::now() + Duration::seconds(secs)).to_rfc3339_opts(SecondsFormat::Millis, true))
        }
        Some(_) => return Err(ApiError::BadRequest("invalid invite expiration".into())),
        None => None,
    };
    let max_uses = match body.max_uses {
        Some(0) => return Err(ApiError::BadRequest("max_uses must be at least 1".into())),
        Some(n) if n <= 1000 => Some(n),
        Some(_) => return Err(ApiError::BadRequest("max_uses exceeds limit".into())),
        None => None,
    };

    let view = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        require_member(&store, &server_id, &user.id)?;
        let code: String = new_id().chars().take(8).collect();
        let inv = ServerInvite {
            code: code.clone(),
            server_id,
            created_by: user.id.clone(),
            created_at: now(),
            expires_at,
            max_uses,
            uses: 0,
        };
        store.invites.insert(code, inv.clone());
        to_view(&store, &inv)
    };
    state.persist();
    Ok(Json(view))
}

/// Revokes an active invite link (creator, admin, or owner).
pub async fn delete_invite(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(code): Path<String>,
) -> ApiResult<StatusCode> {
    {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let inv = store.invites.get(&code).ok_or(ApiError::NotFound("invite"))?;
        let is_creator = inv.created_by == user.id;
        let can_manage = store.role(&inv.server_id, &user.id).is_some_and(Role::can_manage);
        if !is_creator && !can_manage {
            return Err(ApiError::Forbidden("insufficient permissions to revoke invite"));
        }
        store.invites.remove(&code);
    }
    state.persist();
    Ok(StatusCode::NO_CONTENT)
}

/// Returns public metadata for an invite code so users can preview the server before joining.
pub async fn preview_invite(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> ApiResult<Json<InvitePreview>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let inv = store.invites.get(&code).ok_or(ApiError::NotFound("invite"))?;
    let srv = store.servers.get(&inv.server_id).ok_or(ApiError::NotFound("server"))?;
    let member_count = store.members.get(&srv.id).map(|m| m.len()).unwrap_or(0);
    let valid = !is_expired(inv.expires_at.as_deref()) && !is_exhausted(inv.max_uses, inv.uses);
    Ok(Json(InvitePreview {
        code: inv.code.clone(),
        server_id: srv.id.clone(),
        server_name: srv.name.clone(),
        server_icon: srv.icon.clone(),
        server_description: srv.description.clone(),
        accent_color: srv.accent_color.clone(),
        member_count,
        expires_at: inv.expires_at.clone(),
        max_uses: inv.max_uses,
        uses: inv.uses,
        valid,
    }))
}

/// Redeems an invite code, checks expiry and max uses, and joins the target server.
pub async fn join_by_invite(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(code): Path<String>,
) -> ApiResult<Json<ServerView>> {
    let (view, joined_server_id) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let inv = store.invites.get(&code).cloned().ok_or(ApiError::NotFound("invite"))?;
        if is_expired(inv.expires_at.as_deref()) {
            return Err(ApiError::BadRequest("invite link has expired".into()));
        }
        if is_exhausted(inv.max_uses, inv.uses) {
            return Err(ApiError::BadRequest("invite link has reached max uses".into()));
        }
        let srv = store.servers.get(&inv.server_id).cloned().ok_or(ApiError::NotFound("server"))?;
        let already = store.is_member(&srv.id, &user.id);
        let mut joined = None;
        if !already {
            store.members.entry(srv.id.clone()).or_default().insert(user.id.clone(), Role::Member);
            if let Some(record) = store.invites.get_mut(&code) {
                record.uses += 1;
            }
            joined = Some(srv.id.clone());
        }
        (server_view(&store, &user.id, &srv), joined)
    };
    if let Some(server_id) = joined_server_id {
        state.persist();
        state.emit(Event::MemberJoin {
            server_id,
            user: user.public(),
        });
    }
    Ok(Json(view))
}

//! Friends, direct messaging (DM), and per-server profile REST handlers.

use super::users::parse_image_url;
use super::{clean_text, require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    dm_channel_id, friend_pair_key, now, Channel, ChannelKind, Event, FriendEdge, FriendEntryView,
    FriendRequestPayload, FriendStatus, FriendsListResponse, ServerProfile, Store,
    UpdateServerProfileRequest,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use std::sync::Arc;

fn clean_optional_bio(raw: &str, max: usize, what: &str) -> ApiResult<Option<String>> {
    if raw.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest(format!(
            "{what} cannot contain control characters"
        )));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max {
        return Err(ApiError::BadRequest(format!(
            "{what} must be 0-{max} characters"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

fn ensure_dm_channel(store: &mut Store, a: &str, b: &str) -> Channel {
    let cid = dm_channel_id(a, b);
    if let Some(ch) = store.channels.get(&cid) {
        return ch.clone();
    }
    let ch = Channel {
        id: cid.clone(),
        server_id: cid.clone(),
        name: "แชทส่วนตัว".into(),
        kind: ChannelKind::Text,
        topic: String::new(),
        position: 0,
        created_at: now(),
    };
    store.channels.insert(cid, ch.clone());
    ch
}

fn build_friends_response(store: &Store, me_id: &str) -> FriendsListResponse {
    let mut friends = Vec::new();
    let mut incoming = Vec::new();
    let mut outgoing = Vec::new();
    for edge in store.friends.values() {
        if edge.from_id != me_id && edge.to_id != me_id {
            continue;
        }
        let other_id = if edge.from_id == me_id {
            &edge.to_id
        } else {
            &edge.from_id
        };
        let Some(other) = store.users.get(other_id) else {
            continue;
        };
        let view = FriendEntryView {
            user: other.public(),
            status: edge.status,
            direction: if edge.status == FriendStatus::Accepted {
                "friend"
            } else if edge.to_id == me_id {
                "incoming"
            } else {
                "outgoing"
            },
            dm_channel_id: dm_channel_id(me_id, other_id),
            created_at: edge.created_at.clone(),
        };
        match edge.status {
            FriendStatus::Accepted => friends.push(view),
            FriendStatus::Pending if edge.to_id == me_id => incoming.push(view),
            FriendStatus::Pending => outgoing.push(view),
        }
    }
    friends.sort_by(|a, b| a.user.display_name.cmp(&b.user.display_name));
    FriendsListResponse {
        friends,
        incoming,
        outgoing,
    }
}

/// Lists accepted friends, incoming requests, and outgoing requests for the caller.
pub async fn list_friends(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
) -> ApiResult<Json<FriendsListResponse>> {
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    Ok(Json(build_friends_response(&store, &user.id)))
}

/// Sends a friend request by `@username` (auto-accepting mutual requests).
pub async fn request_friend(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Json(body): Json<FriendRequestPayload>,
) -> ApiResult<Json<FriendsListResponse>> {
    let handle = body.username.trim().trim_start_matches('@');
    let clean = clean_text(handle, 32, "username")?;
    let (target_id, res) = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let target = store
            .users
            .values()
            .find(|u| !u.bot && u.username.eq_ignore_ascii_case(&clean))
            .cloned()
            .ok_or(ApiError::NotFound("user"))?;
        if target.id == user.id {
            return Err(ApiError::BadRequest("cannot add yourself as friend".into()));
        }
        let key = friend_pair_key(&user.id, &target.id);
        match store.friends.get_mut(&key) {
            Some(edge) if edge.status == FriendStatus::Accepted => {
                return Err(ApiError::Conflict("already friends".into()));
            }
            Some(edge) if edge.from_id == user.id => {
                return Err(ApiError::Conflict("friend request already sent".into()));
            }
            Some(edge) => {
                edge.status = FriendStatus::Accepted;
                ensure_dm_channel(&mut store, &user.id, &target.id);
            }
            None => {
                store.friends.insert(
                    key,
                    FriendEdge {
                        from_id: user.id.clone(),
                        to_id: target.id.clone(),
                        status: FriendStatus::Pending,
                        created_at: now(),
                    },
                );
            }
        }
        let res = build_friends_response(&store, &user.id);
        (target.id, res)
    };
    state.persist();
    state.emit(Event::FriendUpdate { to: user.id });
    state.emit(Event::FriendUpdate { to: target_id });
    Ok(Json(res))
}

/// Accepts an incoming pending friend request from `{user_id}`.
pub async fn accept_friend(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(other_id): Path<String>,
) -> ApiResult<Json<FriendsListResponse>> {
    let res = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let key = friend_pair_key(&user.id, &other_id);
        let edge = store.friends.get_mut(&key).ok_or(ApiError::NotFound("friend request"))?;
        if edge.to_id != user.id || edge.status != FriendStatus::Pending {
            return Err(ApiError::BadRequest("no pending incoming request".into()));
        }
        edge.status = FriendStatus::Accepted;
        ensure_dm_channel(&mut store, &user.id, &other_id);
        build_friends_response(&store, &user.id)
    };
    state.persist();
    state.emit(Event::FriendUpdate { to: user.id });
    state.emit(Event::FriendUpdate { to: other_id });
    Ok(Json(res))
}

/// Removes a friend or declines/cancels a pending friend request with `{user_id}`.
pub async fn remove_friend(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(other_id): Path<String>,
) -> ApiResult<Json<FriendsListResponse>> {
    let res = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let key = friend_pair_key(&user.id, &other_id);
        store.friends.remove(&key).ok_or(ApiError::NotFound("friend"))?;
        build_friends_response(&store, &user.id)
    };
    state.persist();
    state.emit(Event::FriendUpdate { to: user.id });
    state.emit(Event::FriendUpdate { to: other_id });
    Ok(Json(res))
}

/// Opens or creates a private 1-on-1 DM channel with a friend or shared-server peer.
pub async fn open_dm(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(other_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    if other_id == user.id {
        return Err(ApiError::BadRequest("cannot open DM with yourself".into()));
    }
    let ch = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        let other = store.users.get(&other_id).ok_or(ApiError::NotFound("user"))?;
        if other.bot {
            return Err(ApiError::BadRequest("cannot open DM with bot".into()));
        }
        let is_friend = store
            .friends
            .get(&friend_pair_key(&user.id, &other_id))
            .is_some_and(|e| e.status == FriendStatus::Accepted);
        let shares_server = store
            .members
            .values()
            .any(|m| m.contains_key(&user.id) && m.contains_key(&other_id));
        if !is_friend && !shares_server {
            return Err(ApiError::Forbidden("add friend first to send private messages"));
        }
        ensure_dm_channel(&mut store, &user.id, &other_id)
    };
    state.persist();
    Ok(Json(serde_json::json!({ "channel": ch })))
}

/// Updates caller's per-server nickname, avatar, banner, or bio for server `{id}`.
pub async fn update_server_profile(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(server_id): Path<String>,
    Json(body): Json<UpdateServerProfileRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let profile = {
        let mut store = state.store.write().map_err(|_| ApiError::Internal)?;
        require_member(&store, &server_id, &user.id)?;
        let key = format!("{server_id}:{}", user.id);
        let mut cur = store.server_profiles.get(&key).cloned().unwrap_or_default();
        if let Some(nick) = body.nickname.as_deref() {
            cur.nickname = clean_optional_bio(nick, 32, "server nickname")?;
        }
        if let Some(av) = body.avatar_url.as_deref() {
            cur.avatar_url = parse_image_url(av, 65_536)?;
        }
        if let Some(bn) = body.banner_url.as_deref() {
            cur.banner_url = parse_image_url(bn, 120_000)?;
        }
        if let Some(bio) = body.bio.as_deref() {
            cur.bio = clean_optional_bio(bio, 160, "server bio")?;
        }
        let empty = cur == ServerProfile::default();
        if empty {
            store.server_profiles.remove(&key);
        } else {
            store.server_profiles.insert(key, cur.clone());
        }
        cur
    };
    state.persist();
    state.emit(Event::ServerProfileUpdate {
        server_id,
        user_id: user.id,
        profile: profile.clone(),
    });
    Ok(Json(serde_json::json!({ "profile": profile })))
}

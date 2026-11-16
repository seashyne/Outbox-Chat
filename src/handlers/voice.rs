use super::{require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{ChannelKind, Event, Id};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Serialize)]
pub struct VoiceStateResponse {
    pub channel_id: Id,
    pub users: Vec<Id>,
}

pub async fn voice_join(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
) -> ApiResult<Json<VoiceStateResponse>> {
    // Voice presence is cleaned up when the socket closes, so joining without
    // a live gateway connection would leave a ghost participant behind.
    let connected = state
        .online
        .read()
        .map(|online| online.contains_key(&user.id))
        .unwrap_or(false);
    if !connected {
        return Err(ApiError::BadRequest(
            "voice requires an active WebSocket connection".into(),
        ));
    }

    let server_id = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        let channel = store
            .channel(&channel_id)
            .cloned()
            .ok_or(ApiError::NotFound("channel"))?;
        require_member(&store, &channel.server_id, &user.id)?;
        if channel.kind != ChannelKind::Voice {
            return Err(ApiError::BadRequest("not a voice channel".into()));
        }
        channel.server_id
    };

    // A user can only sit in one voice channel at a time.
    for (sid, cid, users) in state.leave_all_voice(&user.id) {
        state.emit(Event::VoiceState {
            server_id: sid,
            channel_id: cid,
            users,
        });
    }

    let users = {
        let mut voice = state.voice.write().map_err(|_| ApiError::Internal)?;
        let entry = voice.entry(channel_id.clone()).or_default();
        if !entry.contains(&user.id) {
            entry.push(user.id.clone());
        }
        entry.clone()
    };
    state.emit(Event::VoiceState {
        server_id,
        channel_id: channel_id.clone(),
        users: users.clone(),
    });
    Ok(Json(VoiceStateResponse { channel_id, users }))
}

#[derive(Debug, Serialize)]
pub struct RtcIceResponse {
    #[serde(rename = "iceServers")]
    pub ice_servers: Vec<serde_json::Value>,
    #[serde(rename = "turnEnabled")]
    pub turn_enabled: bool,
}

pub async fn rtc_ice(_auth: Auth) -> Json<RtcIceResponse> {
    if let Ok(raw) = std::env::var("ICE_SERVERS_JSON") {
        if let Ok(servers) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
            if !servers.is_empty() {
                let turn_enabled = raw.contains("turn:") || raw.contains("turns:");
                return Json(RtcIceResponse {
                    ice_servers: servers,
                    turn_enabled,
                });
            }
        }
    }
    Json(RtcIceResponse {
        ice_servers: vec![serde_json::json!({
            "urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]
        })],
        turn_enabled: false,
    })
}

pub async fn voice_leave(
    State(state): State<Arc<AppState>>,
    Auth(current_user): Auth,
    Path(channel_id): Path<String>,
) -> ApiResult<Json<VoiceStateResponse>> {
    let server_id = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        store
            .channel(&channel_id)
            .map(|c| c.server_id.clone())
            .ok_or(ApiError::NotFound("channel"))?
    };
    let users = {
        let mut voice = state.voice.write().map_err(|_| ApiError::Internal)?;
        let entry = voice.entry(channel_id.clone()).or_default();
        entry.retain(|id| id != &current_user.id);
        let snapshot = entry.clone();
        if entry.is_empty() {
            voice.remove(&channel_id);
        }
        snapshot
    };
    state.emit(Event::VoiceState {
        server_id,
        channel_id: channel_id.clone(),
        users: users.clone(),
    });
    Ok(Json(VoiceStateResponse { channel_id, users }))
}

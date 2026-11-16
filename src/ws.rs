//! WebSocket gateway: one connection per client, fanned out through a tokio
//! broadcast channel. Events scoped to a server are filtered by membership.

use crate::error::{ApiError, ApiResult};
use crate::model::{ClientEvent, Event, User};
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

#[derive(Debug, Deserialize)]
pub struct WsParams {
    pub token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsParams>,
) -> ApiResult<Response> {
    let user = {
        let store = state.store.read().map_err(|_| ApiError::Internal)?;
        store
            .tokens
            .get(&params.token)
            .and_then(|id| store.users.get(id))
            .cloned()
            .ok_or(ApiError::Unauthorized)?
    };
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user)))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, user: User) {
    let user_id = user.id.clone();
    let public = user.public();
    let (mut sink, mut stream) = socket.split();
    let mut events_rx = state.events.subscribe();

    state.set_online(&user_id, true);
    state.emit(Event::Presence {
        online: state.online_ids(),
    });

    // All writes go through one owner task; every producer gets a cheap clone.
    let (outbound_tx, mut outbound_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(payload) = outbound_rx.recv().await {
            if sink.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let hello = serde_json::json!({
        "type": "ready",
        "user": public,
        "online": state.online_ids(),
        "heartbeat_interval": 25_000u64,
    });
    let _ = outbound_tx.send(hello.to_string());

    // Fan-out: broadcast -> this socket, with per-server authorization.
    let event_state = state.clone();
    let event_user = user_id.clone();
    let event_tx = outbound_tx.clone();
    let fanout = tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(event) => {
                    if let Some(server_id) = event.server_id() {
                        if !event_state.is_member(server_id, &event_user) {
                            continue;
                        }
                    }
                    if let Ok(payload) = serde_json::to_string(&event) {
                        if event_tx.send(payload).is_err() {
                            break;
                        }
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });

    // Keep intermediaries from closing an idle connection.
    let heartbeat_tx = outbound_tx.clone();
    let heartbeat = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(25));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let payload = serde_json::json!({ "type": "heartbeat" }).to_string();
            if heartbeat_tx.send(payload).is_err() {
                break;
            }
        }
    });

    // Client -> server commands.
    while let Some(Ok(frame)) = stream.next().await {
        match frame {
            Message::Text(text) => {
                let raw = text.to_string();
                match serde_json::from_str::<ClientEvent>(&raw) {
                    Ok(ClientEvent::Typing { channel_id }) => {
                        let scoped = {
                            let store = state.store.read().ok();
                            store.and_then(|s| {
                                s.channel(&channel_id).and_then(|c| {
                                    s.is_member(&c.server_id, &user_id)
                                        .then(|| c.server_id.clone())
                                })
                            })
                        };
                        if let Some(server_id) = scoped {
                            state.emit(Event::Typing {
                                server_id,
                                channel_id,
                                user: public.clone(),
                            });
                        }
                    }
                    Ok(ClientEvent::Status { status }) => {
                        let status_val = status.trim().chars().take(32).collect::<String>();
                        if !status_val.is_empty() {
                            if let Ok(mut store) = state.store.write() {
                                if let Some(u) = store.users.get_mut(&user_id) {
                                    u.settings.status = status_val.clone();
                                }
                            }
                            state.persist();
                            state.emit(Event::UserStatus {
                                user_id: user_id.clone(),
                                status: status_val,
                            });
                        }
                    }
                    Ok(ClientEvent::Ping) => {
                        let _ = outbound_tx.send(serde_json::json!({ "type": "pong" }).to_string());
                    }
                    Err(_) => {} // ignore malformed frames
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // --- disconnect cleanup -------------------------------------------------
    fanout.abort();
    heartbeat.abort();
    state.set_online(&user_id, false);
    for (server_id, channel_id, users) in state.leave_all_voice(&user_id) {
        state.emit(Event::VoiceState {
            server_id,
            channel_id,
            users,
        });
    }
    state.emit(Event::Presence {
        online: state.online_ids(),
    });
    drop(outbound_tx);
    let _ = writer.await;
}

//! Realtime WebSocket server-to-client and client-to-server event payloads.

use super::{Channel, Id, MessageView, PublicUser, Role, Server};
use serde::{Deserialize, Serialize};

/// Realtime events pushed from server to connected WebSocket clients.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    MessageCreate { server_id: Id, message: MessageView },
    MessageDelete { server_id: Id, channel_id: Id, message_id: Id },
    MessageUpdate { server_id: Id, message: MessageView, actor_id: Id },
    ChannelCreate { server_id: Id, channel: Channel },
    ChannelDelete { server_id: Id, channel_id: Id },
    ServerCreate { server: Server },
    ServerUpdate { server: Server },
    MemberRoleUpdate { server_id: Id, user_id: Id, role: Role },
    MemberJoin { server_id: Id, user: PublicUser },
    MemberLeave { server_id: Id, user_id: Id },
    Typing { server_id: Id, channel_id: Id, user: PublicUser },
    Presence { online: Vec<Id> },
    VoiceState { server_id: Id, channel_id: Id, users: Vec<Id> },
    RtcSignal {
        server_id: Id,
        channel_id: Id,
        from: Id,
        to: Id,
        signal: serde_json::Value,
    },
    MeetingState {
        server_id: Id,
        channel_id: Id,
        user_id: Id,
        muted: bool,
        deafened: bool,
        video: bool,
        speaking: bool,
        data_saver: bool,
    },
    UserUpdate { user: PublicUser },
    UserStatus { user_id: Id, status: String },
}

impl Event {
    /// Returns the server ID used for membership filtering, or `None` for global events.
    pub fn server_id(&self) -> Option<&str> {
        match self {
            Event::MessageCreate { server_id, .. }
            | Event::MessageDelete { server_id, .. }
            | Event::MessageUpdate { server_id, .. }
            | Event::ChannelCreate { server_id, .. }
            | Event::ChannelDelete { server_id, .. }
            | Event::MemberJoin { server_id, .. }
            | Event::MemberLeave { server_id, .. }
            | Event::MemberRoleUpdate { server_id, .. }
            | Event::Typing { server_id, .. }
            | Event::VoiceState { server_id, .. }
            | Event::RtcSignal { server_id, .. }
            | Event::MeetingState { server_id, .. } => Some(server_id),
            Event::ServerCreate { server } | Event::ServerUpdate { server } => Some(&server.id),
            Event::Presence { .. } | Event::UserUpdate { .. } | Event::UserStatus { .. } => None,
        }
    }

    /// Returns a specific recipient user ID when this event is peer-targeted (e.g. WebRTC signaling).
    pub fn target_user_id(&self) -> Option<&str> {
        match self {
            Event::RtcSignal { to, .. } => Some(to),
            _ => None,
        }
    }
}

/// Commands accepted from connected WebSocket clients.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    Typing { channel_id: Id },
    Status { status: String },
    RtcSignal {
        channel_id: Id,
        to: Id,
        signal: serde_json::Value,
    },
    MeetingState {
        channel_id: Id,
        #[serde(default)]
        muted: bool,
        #[serde(default)]
        deafened: bool,
        #[serde(default)]
        video: bool,
        #[serde(default)]
        speaking: bool,
        #[serde(default = "default_true")]
        data_saver: bool,
    },
    Ping,
}

fn default_true() -> bool {
    true
}

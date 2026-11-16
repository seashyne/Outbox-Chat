//! REST API request/response DTOs and WebSocket event definitions.

use super::{Channel, ChannelKind, Id, MessageView, PublicUser, Role, Server, UserSettings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterResponse {
    pub token: String,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(default)]
    pub kind: ChannelKind,
    #[serde(default)]
    pub topic: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessageRequest {
    pub content: String,
    #[serde(default)]
    pub reply_to: Option<Id>,
}

#[derive(Debug, Deserialize)]
pub struct ReactionRequest {
    pub emoji: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerMemberView {
    pub id: Id,
    pub user_id: Id,
    pub username: String,
    pub display_name: String,
    pub color: String,
    pub bot: bool,
    pub role: Role,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    #[serde(default)]
    pub settings: Option<UserSettingsPatch>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub custom_colors: Option<HashMap<String, String>>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserSettingsPatch {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub custom_colors: Option<HashMap<String, String>>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServerView {
    pub id: Id,
    pub name: String,
    pub icon: String,
    pub owner_id: Id,
    pub created_at: String,
    pub role: Role,
    pub channels: Vec<Channel>,
    pub members: Vec<PublicUser>,
}

#[derive(Debug, Serialize)]
pub struct ServerSummary {
    pub id: Id,
    pub name: String,
    pub icon: String,
    pub member_count: usize,
    pub joined: bool,
}

#[derive(Debug, Serialize)]
pub struct Bootstrap {
    pub me: PublicUser,
    pub settings: UserSettings,
    pub servers: Vec<ServerView>,
    pub channels: HashMap<Id, Vec<Channel>>,
    pub members: HashMap<Id, Vec<ServerMemberView>>,
    pub online: Vec<Id>,
    pub voice: HashMap<Id, Vec<Id>>,
    pub default_server_id: Option<Id>,
    pub default_channel_id: Option<Id>,
}

#[derive(Debug, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub service: &'static str,
    pub users: usize,
    pub servers: usize,
    pub messages: usize,
    pub online: usize,
    pub note: &'static str,
}

/// Realtime events pushed from server to connected WebSocket clients.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    MessageCreate {
        server_id: Id,
        message: MessageView,
    },
    MessageDelete {
        server_id: Id,
        channel_id: Id,
        message_id: Id,
    },
    MessageUpdate {
        server_id: Id,
        message: MessageView,
        actor_id: Id,
    },
    ChannelCreate {
        server_id: Id,
        channel: Channel,
    },
    ChannelDelete {
        server_id: Id,
        channel_id: Id,
    },
    ServerCreate {
        server: Server,
    },
    MemberJoin {
        server_id: Id,
        user: PublicUser,
    },
    MemberLeave {
        server_id: Id,
        user_id: Id,
    },
    Typing {
        server_id: Id,
        channel_id: Id,
        user: PublicUser,
    },
    Presence {
        online: Vec<Id>,
    },
    VoiceState {
        server_id: Id,
        channel_id: Id,
        users: Vec<Id>,
    },
    UserUpdate {
        user: PublicUser,
    },
    UserStatus {
        user_id: Id,
        status: String,
    },
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
            | Event::Typing { server_id, .. }
            | Event::VoiceState { server_id, .. } => Some(server_id),
            Event::ServerCreate { server } => Some(&server.id),
            Event::Presence { .. }
            | Event::UserUpdate { .. }
            | Event::UserStatus { .. } => None,
        }
    }
}

/// Commands accepted from connected WebSocket clients.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    Typing { channel_id: Id },
    Status { status: String },
    Ping,
}

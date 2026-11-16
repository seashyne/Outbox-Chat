//! Core domain types for Outbox Chat.
//!
//! Splits data entities (`mod.rs`), persistence/indexing store (`store.rs`),
//! and REST/WebSocket wire payloads (`payloads.rs`).

mod payloads;
mod store;

pub use payloads::*;
pub use store::Store;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub type Id = String;

/// Generates a compact 32-char UUIDv4 identifier.
pub fn new_id() -> Id {
    Uuid::new_v4().simple().to_string()
}

/// Generates a 64-char hex bearer session token from two UUIDv4s.
pub fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Returns the current UTC timestamp in RFC 3339 millisecond precision.
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Default avatar palette colors assigned to new users.
pub const AVATAR_COLORS: [&str; 8] = [
    "#5865f2", "#eb459e", "#ed4245", "#faa61a", "#23a559", "#1abc9c", "#3498db", "#9b59b6",
];

/// Channel communication type.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    #[default]
    Text,
    Voice,
}

/// Member permission level within a server.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Admin,
    Member,
}

impl Role {
    /// Returns true if this role may create/delete channels or moderate messages.
    pub fn can_manage(self) -> bool {
        matches!(self, Role::Owner | Role::Admin)
    }
}

/// Persisted user preferences and appearance configuration.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_colors: HashMap<String, String>,
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_status() -> String {
    "online".to_string()
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            custom_colors: HashMap::new(),
            status: default_status(),
        }
    }
}

/// Stored user record. Secrets (`token`, `password_hash`, `password_salt`)
/// must never be serialized to other clients — always project via `public()`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub color: String,
    pub token: String,
    pub bot: bool,
    pub created_at: String,
    #[serde(default)]
    pub password_hash: String,
    #[serde(default)]
    pub password_salt: String,
    #[serde(default)]
    pub settings: UserSettings,
}

impl User {
    /// Projects non-sensitive public fields safe for REST and WebSocket payloads.
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id.clone(),
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            color: self.color.clone(),
            bot: self.bot,
        }
    }
}

/// Publicly visible user identity without credentials or settings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicUser {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub color: String,
    pub bot: bool,
}

/// Configurable display labels, badge colors, and member permissions for server roles.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerRolesConfig {
    #[serde(default = "default_owner_label")]
    pub owner_label: String,
    #[serde(default = "default_admin_label")]
    pub admin_label: String,
    #[serde(default = "default_member_label")]
    pub member_label: String,
    #[serde(default = "default_admin_color")]
    pub admin_color: String,
    #[serde(default = "default_member_color")]
    pub member_color: String,
    #[serde(default = "default_true")]
    pub allow_member_create_channel: bool,
}

fn default_owner_label() -> String {
    "เจ้าของเซิร์ฟเวอร์".to_string()
}

fn default_admin_label() -> String {
    "ผู้ดูแลระบบ".to_string()
}

fn default_member_label() -> String {
    "สมาชิก".to_string()
}

fn default_admin_color() -> String {
    "#f59e0b".to_string()
}

fn default_member_color() -> String {
    "#94a3b8".to_string()
}

fn default_accent_color() -> String {
    "#5865f2".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for ServerRolesConfig {
    fn default() -> Self {
        Self {
            owner_label: default_owner_label(),
            admin_label: default_admin_label(),
            member_label: default_member_label(),
            admin_color: default_admin_color(),
            member_color: default_member_color(),
            allow_member_create_channel: true,
        }
    }
}

/// Guild / workspace container holding channels and members.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Server {
    pub id: Id,
    pub name: String,
    /// Clean short text initials used as the server rail badge.
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default)]
    pub roles_config: ServerRolesConfig,
    pub owner_id: Id,
    pub created_at: String,
}

/// Text or voice channel belonging to a server.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Channel {
    pub id: Id,
    pub server_id: Id,
    pub name: String,
    pub kind: ChannelKind,
    pub topic: String,
    pub position: i64,
    pub created_at: String,
}

/// Persisted chat message stored chronologically per channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: Id,
    pub channel_id: Id,
    pub author_id: Id,
    pub content: String,
    pub created_at: String,
    pub edited_at: Option<String>,
    #[serde(default)]
    pub reply_to: Option<Id>,
    /// Clean reaction token -> user IDs that toggled it on.
    #[serde(default)]
    pub reactions: HashMap<String, Vec<Id>>,
}

/// Compact quoted snippet of a replied-to message.
#[derive(Clone, Debug, Serialize)]
pub struct ReplyPreview {
    pub id: Id,
    pub author: PublicUser,
    pub content: String,
}

/// Aggregated reaction counter returned in message views.
#[derive(Clone, Debug, Serialize)]
pub struct ReactionView {
    pub emoji: String,
    pub count: usize,
    pub me: bool,
    pub users: Vec<Id>,
}

/// Hydrated message payload sent to clients with resolved author, reply, and reactions.
#[derive(Clone, Debug, Serialize)]
pub struct MessageView {
    pub id: Id,
    pub channel_id: Id,
    pub author: PublicUser,
    pub content: String,
    pub created_at: String,
    pub edited_at: Option<String>,
    pub reply: Option<ReplyPreview>,
    pub reactions: Vec<ReactionView>,
}

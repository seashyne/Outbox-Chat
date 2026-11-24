//! Extended Phase 2 & Phase 3 domain types: channel permissions, categories,
//! message threads, server moderation (bans, timeouts, audit logs), and media gallery.

use super::{Attachment, Id, PublicUser};
use serde::{Deserialize, Serialize};

/// Channel visibility policy controlling who can see and read the channel.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChannelVisibility {
    #[default]
    Public,
    Admin,
}

/// Request payload for `PATCH /api/channels/{id}` (edit channel details, category, or permissions).
#[derive(Debug, Deserialize, Default)]
pub struct UpdateChannelRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub visibility: Option<ChannelVisibility>,
    #[serde(default)]
    pub read_only: Option<bool>,
    #[serde(default)]
    pub slowmode_seconds: Option<u32>,
}

/// Focused discussion thread attached to a channel (optionally anchored to a parent message).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChannelThread {
    pub id: Id,
    pub server_id: Id,
    pub channel_id: Id,
    #[serde(default)]
    pub parent_message_id: Option<Id>,
    pub title: String,
    pub created_by: Id,
    pub created_at: String,
}

/// Client-facing summary for a thread with message count and latest activity timestamp.
#[derive(Clone, Debug, Serialize)]
pub struct ThreadView {
    pub id: Id,
    pub server_id: Id,
    pub channel_id: Id,
    pub parent_message_id: Option<Id>,
    pub title: String,
    pub created_by: Id,
    pub creator_name: String,
    pub created_at: String,
    pub message_count: usize,
    pub last_message_at: Option<String>,
}

/// Request payload for `POST /api/channels/{id}/threads`.
#[derive(Debug, Deserialize)]
pub struct CreateThreadRequest {
    pub title: String,
    #[serde(default)]
    pub parent_message_id: Option<Id>,
    #[serde(default)]
    pub content: Option<String>,
}

/// Persisted server ban entry preventing blocked users from rejoining.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerBan {
    pub user_id: Id,
    pub banned_by: Id,
    #[serde(default)]
    pub reason: String,
    pub created_at: String,
}

/// Client-facing view of a banned user with actor metadata.
#[derive(Clone, Debug, Serialize)]
pub struct BanView {
    pub user: PublicUser,
    pub reason: String,
    pub banned_by_name: String,
    pub created_at: String,
}

/// Request payload for `POST /api/servers/{id}/members/{uid}/ban`.
#[derive(Debug, Deserialize, Default)]
pub struct BanMemberRequest {
    #[serde(default)]
    pub reason: Option<String>,
}

/// Request payload for `POST /api/servers/{id}/members/{uid}/timeout`.
#[derive(Debug, Deserialize)]
pub struct TimeoutMemberRequest {
    pub minutes: u32,
}

/// Server moderation or channel administration audit log entry.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: Id,
    pub actor_id: Id,
    pub actor_name: String,
    pub action: String,
    pub target_id: Id,
    pub target_name: String,
    pub detail: String,
    pub created_at: String,
}

/// Gallery item returned by `GET /api/channels/{id}/media`.
#[derive(Clone, Debug, Serialize)]
pub struct MediaGalleryItem {
    pub message_id: Id,
    pub channel_id: Id,
    pub author_name: String,
    pub created_at: String,
    pub attachment: Attachment,
}

//! Social models for per-server member profiles, friend relationships, and DMs.

use super::{Id, PublicUser};
use serde::{Deserialize, Serialize};

/// Per-server profile customization that overrides global defaults within one server.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ServerProfile {
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
}

/// Request payload for `PATCH /api/servers/{id}/profile`.
#[derive(Debug, Deserialize, Default)]
pub struct UpdateServerProfileRequest {
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
}

/// Friendship state between two distinct user accounts.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FriendStatus {
    Pending,
    Accepted,
}

/// Stored bidirectional friendship / pending request record keyed by sorted user IDs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FriendEdge {
    pub from_id: Id,
    pub to_id: Id,
    pub status: FriendStatus,
    pub created_at: String,
}

/// Client-facing summary for an accepted friend or pending request.
#[derive(Clone, Debug, Serialize)]
pub struct FriendEntryView {
    pub user: PublicUser,
    pub status: FriendStatus,
    pub direction: &'static str,
    pub dm_channel_id: String,
    pub created_at: String,
}

/// Response payload for `GET /api/friends`.
#[derive(Debug, Serialize)]
pub struct FriendsListResponse {
    pub friends: Vec<FriendEntryView>,
    pub incoming: Vec<FriendEntryView>,
    pub outgoing: Vec<FriendEntryView>,
}

/// Request payload for `POST /api/friends/request`.
#[derive(Debug, Deserialize)]
pub struct FriendRequestPayload {
    pub username: String,
}

/// Returns a deterministic sorted pair key `"{min}:{max}"` for two user IDs.
pub fn friend_pair_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

/// Returns the deterministic 1-on-1 DM channel/virtual-server identifier `"dm:{min}:{max}"`.
pub fn dm_channel_id(a: &str, b: &str) -> String {
    format!("dm:{}", friend_pair_key(a, b))
}

/// Persisted image or file attachment included inside a chat or DM message.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Attachment {
    pub id: Id,
    pub name: String,
    pub mime: String,
    pub size: usize,
    pub data_url: String,
}

/// Client upload input for a message attachment.
#[derive(Clone, Debug, Deserialize)]
pub struct AttachmentInput {
    pub name: String,
    pub mime: String,
    #[serde(default)]
    pub size: Option<usize>,
    pub data_url: String,
}

/// Server invite link with optional expiry timestamp and maximum use limit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerInvite {
    pub code: String,
    pub server_id: Id,
    pub created_by: Id,
    pub created_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub max_uses: Option<u32>,
    #[serde(default)]
    pub uses: u32,
}

/// Request payload for `POST /api/servers/{id}/invites`.
#[derive(Debug, Deserialize, Default)]
pub struct CreateInviteRequest {
    #[serde(default)]
    pub expires_in_hours: Option<f64>,
    #[serde(default)]
    pub max_uses: Option<u32>,
}

/// Detailed invite view returned to server members.
#[derive(Clone, Debug, Serialize)]
pub struct InviteView {
    pub code: String,
    pub server_id: Id,
    pub created_by: Id,
    pub creator_name: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub expired: bool,
    pub exhausted: bool,
}

/// Public invite preview returned by `GET /api/invites/{code}`.
#[derive(Clone, Debug, Serialize)]
pub struct InvitePreview {
    pub code: String,
    pub server_id: Id,
    pub server_name: String,
    pub server_icon: String,
    pub server_description: String,
    pub accent_color: String,
    pub member_count: usize,
    pub expires_at: Option<String>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub valid: bool,
}

/// Request payload for `PATCH /api/messages/{id}`.
#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

/// Custom image sticker belonging to a server.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerSticker {
    pub id: Id,
    pub server_id: Id,
    pub name: String,
    pub data_url: String,
    pub created_by: Id,
    pub created_at: String,
}

/// Request payload for `POST /api/servers/{id}/stickers`.
#[derive(Debug, Deserialize)]
pub struct CreateStickerRequest {
    pub name: String,
    pub data_url: String,
}

/// Automatic URL metadata preview returned by `GET /api/links/preview`.
#[derive(Clone, Debug, Serialize)]
pub struct LinkPreviewResponse {
    pub url: String,
    pub domain: String,
    pub title: String,
    pub description: String,
    pub image: Option<String>,
}

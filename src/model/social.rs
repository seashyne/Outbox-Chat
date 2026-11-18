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

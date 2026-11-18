//! REST API request/response DTOs and WebSocket event definitions.

use super::{
    Channel, ChannelKind, Id, PublicUser, Role, ServerProfile, ServerRolesConfig, UserSettings,
};
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

#[derive(Debug, Deserialize, Default, Clone)]
pub struct ServerRolesConfigPatch {
    #[serde(default)]
    pub owner_label: Option<String>,
    #[serde(default)]
    pub admin_label: Option<String>,
    #[serde(default)]
    pub member_label: Option<String>,
    #[serde(default)]
    pub admin_color: Option<String>,
    #[serde(default)]
    pub member_color: Option<String>,
    #[serde(default)]
    pub allow_member_create_channel: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CreateServerRequest {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub roles_config: Option<ServerRolesConfigPatch>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub roles_config: Option<ServerRolesConfigPatch>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: Role,
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
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub status_text: String,
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
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserSettingsPatch {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub custom_colors: Option<HashMap<String, String>>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub status_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServerView {
    pub id: Id,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub accent_color: String,
    pub roles_config: ServerRolesConfig,
    pub owner_id: Id,
    pub created_at: String,
    pub role: Role,
    pub channels: Vec<Channel>,
    pub members: Vec<PublicUser>,
    pub member_roles: HashMap<Id, Role>,
    #[serde(default)]
    pub member_profiles: HashMap<Id, ServerProfile>,
}

#[derive(Debug, Serialize)]
pub struct ServerSummary {
    pub id: Id,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub accent_color: String,
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

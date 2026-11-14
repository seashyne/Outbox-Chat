//! Domain types for Outbox Chat.
//!
//! Everything is serializable: the same structs are used for the on-disk JSON
//! store, the REST responses and the WebSocket event payloads.

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub type Id = String;

pub fn new_id() -> Id {
    Uuid::new_v4().simple().to_string()
}

pub fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub const AVATAR_COLORS: [&str; 8] = [
    "#5865f2", "#eb459e", "#ed4245", "#faa61a", "#23a559", "#1abc9c", "#3498db", "#9b59b6",
];

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    #[default]
    Text,
    Voice,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Admin,
    Member,
}

impl Role {
    pub fn can_manage(self) -> bool {
        matches!(self, Role::Owner | Role::Admin)
    }
}

/// Stored user. `token` must never be sent to other clients - use `PublicUser`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub color: String,
    pub token: String,
    pub bot: bool,
    pub created_at: String,
}

impl User {
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicUser {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub color: String,
    pub bot: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Server {
    pub id: Id,
    pub name: String,
    /// Emoji used as the server icon in the rail.
    pub icon: String,
    pub owner_id: Id,
    pub created_at: String,
}

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
    /// emoji -> user_ids that reacted with it
    #[serde(default)]
    pub reactions: HashMap<String, Vec<Id>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReplyPreview {
    pub id: Id,
    pub author: PublicUser,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReactionView {
    pub emoji: String,
    pub count: usize,
    pub me: bool,
    pub users: Vec<Id>,
}

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

/// The whole persisted database. One JSON file keeps the project dependency-free
/// (no SQLite/Postgres), while the shape maps 1:1 onto a relational schema.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Store {
    pub users: HashMap<Id, User>,
    pub tokens: HashMap<String, Id>,
    pub servers: HashMap<Id, Server>,
    pub channels: HashMap<Id, Channel>,
    /// channel_id -> chronological messages
    pub messages: HashMap<Id, Vec<Message>>,
    /// server_id -> (user_id -> role)
    pub members: HashMap<Id, HashMap<Id, Role>>,
    /// In-memory lookup: message_id -> channel_id (rebuilt on load/seed).
    #[serde(skip)]
    pub message_index: HashMap<Id, Id>,
}

impl Store {
    pub fn rebuild_index(&mut self) {
        self.message_index.clear();
        for (channel_id, list) in &self.messages {
            for message in list {
                self.message_index
                    .insert(message.id.clone(), channel_id.clone());
            }
        }
    }

    pub fn locate_message(&self, message_id: &str) -> Option<(Id, usize)> {
        if let Some(channel_id) = self.message_index.get(message_id) {
            if let Some(list) = self.messages.get(channel_id) {
                if let Some(index) = list.iter().position(|m| m.id == message_id) {
                    return Some((channel_id.clone(), index));
                }
            }
        }
        // Fallback scan if index wasn't populated (e.g. Store constructed directly in tests).
        self.messages.iter().find_map(|(cid, list)| {
            list.iter()
                .position(|m| m.id == message_id)
                .map(|index| (cid.clone(), index))
        })
    }

    pub fn insert_message(&mut self, channel_id: Id, message: Message) {
        self.message_index
            .insert(message.id.clone(), channel_id.clone());
        self.messages.entry(channel_id).or_default().push(message);
    }

    pub fn remove_message(&mut self, channel_id: &str, index: usize) -> Option<Message> {
        let list = self.messages.get_mut(channel_id)?;
        if index >= list.len() {
            return None;
        }
        let removed = list.remove(index);
        self.message_index.remove(&removed.id);
        Some(removed)
    }

    pub fn message_view(&self, message: &Message, viewer_id: &str) -> Option<MessageView> {
        let author = self.users.get(&message.author_id)?.public();
        let reply = message.reply_to.as_ref().and_then(|reply_id| {
            let target = self
                .messages
                .get(&message.channel_id)?
                .iter()
                .find(|m| m.id == *reply_id)?;
            Some(ReplyPreview {
                id: target.id.clone(),
                author: self.users.get(&target.author_id)?.public(),
                content: target.content.chars().take(120).collect(),
            })
        });
        let mut reactions: Vec<ReactionView> = message
            .reactions
            .iter()
            .filter(|(_, users)| !users.is_empty())
            .map(|(emoji, users)| ReactionView {
                emoji: emoji.clone(),
                count: users.len(),
                me: users.iter().any(|id| id == viewer_id),
                users: users.clone(),
            })
            .collect();
        reactions.sort_by(|a, b| a.emoji.cmp(&b.emoji));
        Some(MessageView {
            id: message.id.clone(),
            channel_id: message.channel_id.clone(),
            author,
            content: message.content.clone(),
            created_at: message.created_at.clone(),
            edited_at: message.edited_at.clone(),
            reply,
            reactions,
        })
    }

    pub fn channel(&self, id: &str) -> Option<&Channel> {
        self.channels.get(id)
    }

    pub fn is_member(&self, server_id: &str, user_id: &str) -> bool {
        self.members
            .get(server_id)
            .is_some_and(|members| members.contains_key(user_id))
    }

    pub fn role(&self, server_id: &str, user_id: &str) -> Option<Role> {
        self.members.get(server_id)?.get(user_id).copied()
    }

    /// Ships with a demo server so the UI is not empty on first launch.
    pub fn seeded() -> Self {
        let mut store = Store::default();
        let bot = User {
            id: "outbox-bot".into(),
            username: "outbox-bot".into(),
            display_name: "Outbox Bot".into(),
            color: "#5865f2".into(),
            token: new_token(),
            bot: true,
            created_at: now(),
        };
        store.tokens.insert(bot.token.clone(), bot.id.clone());
        store.users.insert(bot.id.clone(), bot.clone());

        let server = Server {
            id: "demo".into(),
            name: "Outbox HQ".into(),
            icon: "🚀".into(),
            owner_id: bot.id.clone(),
            created_at: now(),
        };
        store.servers.insert(server.id.clone(), server.clone());

        let channels = [
            (
                "general",
                ChannelKind::Text,
                "ยินดีต้อนรับ! ที่นี่คือห้องคุยรวมของ Outbox HQ",
            ),
            (
                "team-chat",
                ChannelKind::Text,
                "คุยเรื่องงาน ไอเดียใหม่ ๆ หรืออะไรก็ได้",
            ),
            ("random", ChannelKind::Text, "แชร์เรื่องสนุก ๆ ได้ตามสบาย"),
            ("Lounge", ChannelKind::Voice, "ห้องเสียงสำหรับนั่งคุยกัน"),
        ];
        for (i, (name, kind, topic)) in channels.iter().enumerate() {
            let channel = Channel {
                id: format!("demo-{i}"),
                server_id: server.id.clone(),
                name: (*name).into(),
                kind: *kind,
                topic: (*topic).into(),
                position: i as i64,
                created_at: now(),
            };
            store.channels.insert(channel.id.clone(), channel);
        }

        let mut members = HashMap::new();
        members.insert(bot.id.clone(), Role::Owner);
        store.members.insert(server.id.clone(), members);

        let greetings = [
            "ยินดีต้อนรับสู่ **Outbox Chat** 👋 มารู้จักกันและคุยกันได้เลยนะ",
            "ลองเปิดอีกหน้าต่าง ใช้ชื่ออื่น แล้วพิมพ์ข้อความดูสิ — เพื่อนจะเห็นทันที ⚡",
            "สร้างเซิร์ฟเวอร์หรือช่องใหม่ได้จากปุ่ม + ด้านซ้าย หรือกดห้องเสียงเพื่อดูว่าใครอยู่บ้าง",
        ];
        let messages: Vec<Message> = greetings
            .iter()
            .enumerate()
            .map(|(i, content)| Message {
                id: format!("seed-{i}"),
                channel_id: "demo-0".into(),
                author_id: bot.id.clone(),
                content: (*content).into(),
                created_at: now(),
                edited_at: None,
                reply_to: None,
                reactions: if i == 0 {
                    HashMap::from([
                        ("👋".to_string(), vec![bot.id.clone()]),
                        ("💜".to_string(), vec![bot.id.clone()]),
                    ])
                } else {
                    HashMap::new()
                },
            })
            .collect();
        store.messages.insert("demo-0".into(), messages);
        store.rebuild_index();
        store
    }
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct RegisterResponse {
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
    pub servers: Vec<ServerView>,
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

// ---------------------------------------------------------------------------
// Realtime events (server -> client) and client commands (client -> server)
// ---------------------------------------------------------------------------

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
    ServerCreate {
        server: Server,
    },
    MemberJoin {
        server_id: Id,
        user: PublicUser,
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
}

impl Event {
    /// Events scoped to a server are only delivered to its members.
    pub fn server_id(&self) -> Option<&str> {
        match self {
            Event::MessageCreate { server_id, .. }
            | Event::MessageDelete { server_id, .. }
            | Event::MessageUpdate { server_id, .. }
            | Event::ChannelCreate { server_id, .. }
            | Event::MemberJoin { server_id, .. }
            | Event::Typing { server_id, .. }
            | Event::VoiceState { server_id, .. } => Some(server_id),
            Event::ServerCreate { server } => Some(&server.id),
            Event::Presence { .. } => None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    Typing { channel_id: Id },
    Ping,
}

//! In-memory database store, lookup indexing, and default seeded data.
//!
//! Serializes 1:1 to `data/store.json` without native SQL dependencies while
//! keeping a relational table shape (`users`, `servers`, `channels`, `messages`, `members`).

use super::{
    new_token, now, AuditLogEntry, Channel, ChannelKind, ChannelThread, ChannelVisibility,
    FriendEdge, Id, Message, MessageView, ReactionView, ReplyPreview, Role, Server, ServerBan,
    ServerInvite, ServerProfile, ServerRolesConfig, ServerSticker, User, UserSettings,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Full persisted application database.
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
    /// "{min_uid}:{max_uid}" -> FriendEdge
    #[serde(default)]
    pub friends: HashMap<String, FriendEdge>,
    /// "{server_id}:{user_id}" -> ServerProfile
    #[serde(default)]
    pub server_profiles: HashMap<String, ServerProfile>,
    /// invite code -> ServerInvite
    #[serde(default)]
    pub invites: HashMap<String, ServerInvite>,
    /// server_id -> custom server stickers
    #[serde(default)]
    pub stickers: HashMap<Id, Vec<ServerSticker>>,
    /// thread_id -> ChannelThread
    #[serde(default)]
    pub threads: HashMap<Id, ChannelThread>,
    /// server_id -> (user_id -> ServerBan)
    #[serde(default)]
    pub bans: HashMap<Id, HashMap<Id, ServerBan>>,
    /// "{server_id}:{user_id}" -> ISO timestamp until muted
    #[serde(default)]
    pub timeouts: HashMap<String, String>,
    /// server_id -> audit log entries (newest last)
    #[serde(default)]
    pub audit_logs: HashMap<Id, Vec<AuditLogEntry>>,
    /// In-memory lookup: message_id -> channel_id (rebuilt on load/seed).
    #[serde(skip)]
    pub message_index: HashMap<Id, Id>,
    /// In-memory cooldown tracker: "{channel_id}:{user_id}" -> unix seconds of last message.
    #[serde(skip)]
    pub slowmode_last: HashMap<String, i64>,
}

impl Store {
    /// Rebuilds the in-memory `message_index` after loading `store.json` from disk.
    pub fn rebuild_index(&mut self) {
        self.message_index.clear();
        for (channel_id, list) in &self.messages {
            for message in list {
                self.message_index
                    .insert(message.id.clone(), channel_id.clone());
            }
        }
    }

    /// Resolves `(channel_id, vec_index)` for `message_id`, falling back to a scan
    /// if the index was not yet populated (e.g. unit-test stores).
    pub fn locate_message(&self, message_id: &str) -> Option<(Id, usize)> {
        if let Some(channel_id) = self.message_index.get(message_id) {
            if let Some(list) = self.messages.get(channel_id) {
                if let Some(index) = list.iter().position(|m| m.id == message_id) {
                    return Some((channel_id.clone(), index));
                }
            }
        }
        self.messages.iter().find_map(|(cid, list)| {
            list.iter()
                .position(|m| m.id == message_id)
                .map(|index| (cid.clone(), index))
        })
    }

    /// Appends a message to `channel_id` and updates `message_index`.
    pub fn insert_message(&mut self, channel_id: Id, message: Message) {
        self.message_index
            .insert(message.id.clone(), channel_id.clone());
        self.messages.entry(channel_id).or_default().push(message);
    }

    /// Removes a message by vector index and clears it from `message_index`.
    pub fn remove_message(&mut self, channel_id: &str, index: usize) -> Option<Message> {
        let list = self.messages.get_mut(channel_id)?;
        if index >= list.len() {
            return None;
        }
        let removed = list.remove(index);
        self.message_index.remove(&removed.id);
        Some(removed)
    }

    /// Hydrates a `Message` into a client-facing `MessageView` for `viewer_id`.
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
        let thread_meta = self.threads.values().find_map(|t| {
            if t.parent_message_id.as_deref() != Some(&message.id) {
                return None;
            }
            let count = self.messages.get(&t.id).map(|l| l.len()).unwrap_or(0);
            Some((t.id.clone(), t.title.clone(), count))
        });
        let (thread_id, thread_title, thread_count) = match thread_meta {
            Some((id, title, count)) => (Some(id), Some(title), count),
            None => (None, None, 0),
        };
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
            attachments: message.attachments.clone(),
            pinned: message.pinned,
            thread_id,
            thread_title,
            thread_count,
        })
    }

    /// Returns true if `user_id` is allowed to see and read `channel`.
    pub fn can_view_channel(&self, channel: &Channel, user_id: &str) -> bool {
        if !self.is_member(&channel.server_id, user_id) {
            return false;
        }
        if channel.visibility == ChannelVisibility::Admin {
            return self
                .role(&channel.server_id, user_id)
                .is_some_and(Role::can_manage);
        }
        true
    }

    /// Looks up a channel by ID.
    pub fn channel(&self, id: &str) -> Option<&Channel> {
        self.channels.get(id)
    }

    /// Returns true if `user_id` is a member of `server_id` or a participant of DM `dm:{a}:{b}`.
    pub fn is_member(&self, server_id: &str, user_id: &str) -> bool {
        if let Some(pair) = server_id.strip_prefix("dm:") {
            let mut parts = pair.split(':');
            return matches!(
                (parts.next(), parts.next(), parts.next()),
                (Some(a), Some(b), None) if a == user_id || b == user_id
            );
        }
        self.members
            .get(server_id)
            .is_some_and(|members| members.contains_key(user_id))
    }

    /// Returns the role of `user_id` in `server_id`, if any.
    pub fn role(&self, server_id: &str, user_id: &str) -> Option<Role> {
        self.members.get(server_id)?.get(user_id).copied()
    }

    /// Creates the default seeded `Outbox HQ` server with clean text channels and greetings.
    pub fn seeded() -> Self {
        let mut store = Store::default();
        let bot = User {
            id: "outbox-bot".into(),
            username: "outbox-bot".into(),
            display_name: "Outbox Bot".into(),
            color: "#5865f2".into(),
            avatar_url: None,
            banner_url: None,
            bio: String::new(),
            status_text: String::new(),
            token: new_token(),
            bot: true,
            created_at: now(),
            password_hash: String::new(),
            password_salt: String::new(),
            settings: UserSettings::default(),
        };
        store.tokens.insert(bot.token.clone(), bot.id.clone());
        store.users.insert(bot.id.clone(), bot.clone());

        let server = Server {
            id: "demo".into(),
            name: "Outbox HQ".into(),
            icon: "HQ".into(),
            description: "พื้นที่พูดคุยหลักสำหรับทีม Outbox".into(),
            accent_color: "#5865f2".into(),
            roles_config: ServerRolesConfig::default(),
            owner_id: bot.id.clone(),
            created_at: now(),
        };
        store.servers.insert(server.id.clone(), server.clone());

        let channels = [
            ("general", ChannelKind::Text, "ยินดีต้อนรับ! ที่นี่คือห้องคุยรวมของ Outbox HQ"),
            ("team-chat", ChannelKind::Text, "คุยเรื่องงาน ไอเดียใหม่ ๆ หรืออะไรก็ได้"),
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
                category: None,
                visibility: ChannelVisibility::Public,
                read_only: false,
                slowmode_seconds: 0,
                position: i as i64,
                created_at: now(),
            };
            store.channels.insert(channel.id.clone(), channel);
        }

        let mut members = HashMap::new();
        members.insert(bot.id.clone(), Role::Owner);
        store.members.insert(server.id.clone(), members);

        let greetings = [
            "ยินดีต้อนรับสู่ **Outbox Chat** มารู้จักกันและคุยกันได้เลยนะ",
            "ลองเปิดอีกหน้าต่าง ใช้ชื่ออื่น แล้วพิมพ์ข้อความดูสิ — เพื่อนจะเห็นทันที",
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
                reactions: HashMap::new(),
                attachments: Vec::new(),
                pinned: false,
            })
            .collect();
        store.messages.insert("demo-0".into(), messages);
        store.rebuild_index();
        store
    }
}

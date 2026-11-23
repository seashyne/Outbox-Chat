//! Shared application state: in-memory store, online presence, voice presence,
//! event fan-out and JSON persistence.

use crate::model::{Event, Id, Store};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use tokio::sync::broadcast;

pub struct AppState {
    pub store: RwLock<Store>,
    /// user_id -> number of live WebSocket connections (multi-tab friendly)
    pub online: RwLock<HashMap<Id, usize>>,
    /// channel_id -> user_ids currently in that voice channel (ephemeral)
    pub voice: RwLock<HashMap<Id, Vec<Id>>>,
    pub events: broadcast::Sender<Event>,
    pub data_path: PathBuf,
    persist_lock: Mutex<()>,
}

impl AppState {
    pub fn new(data_path: PathBuf) -> Self {
        let store = load_store(&data_path).unwrap_or_else(Store::seeded);
        let (events, _) = broadcast::channel::<Event>(512);
        Self {
            store: RwLock::new(store),
            online: RwLock::new(HashMap::new()),
            voice: RwLock::new(HashMap::new()),
            events,
            data_path,
            persist_lock: Mutex::new(()),
        }
    }

    /// Atomic-ish write: dump to `.tmp` then rename, so a crash cannot leave a
    /// half-written database behind. Serialized by `persist_lock` so concurrent
    /// requests never race on the `.tmp` file or overwrite newer state.
    pub fn persist(&self) {
        let _guard = self.persist_lock.lock().unwrap_or_else(|e| e.into_inner());
        let json = match self.store.read() {
            Ok(store) => serde_json::to_string_pretty(&*store).unwrap_or_default(),
            Err(poisoned) => {
                serde_json::to_string_pretty(&*poisoned.into_inner()).unwrap_or_default()
            }
        };
        if json.is_empty() {
            return;
        }
        if let Some(parent) = self.data_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let tmp = self.data_path.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() && fs::rename(&tmp, &self.data_path).is_err() {
            let _ = fs::remove_file(&tmp);
        }
    }

    pub fn emit(&self, event: Event) {
        // No subscribers is a normal state (e.g. REST-only clients).
        let _ = self.events.send(event);
    }

    pub fn is_member(&self, server_id: &str, user_id: &str) -> bool {
        self.store
            .read()
            .map(|store| store.is_member(server_id, user_id))
            .unwrap_or(false)
    }

    pub fn online_ids(&self) -> Vec<Id> {
        self.online
            .read()
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn set_online(&self, user_id: &str, connected: bool) {
        if let Ok(mut map) = self.online.write() {
            if connected {
                *map.entry(user_id.to_string()).or_insert(0) += 1;
            } else if let Some(count) = map.get_mut(user_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(user_id);
                }
            }
        }
    }

    /// Remove a user from every voice channel (called on socket disconnect).
    pub fn leave_all_voice(&self, user_id: &str) -> Vec<(Id, Id, Vec<Id>)> {
        let mut changed = Vec::new();
        if let Ok(mut voice) = self.voice.write() {
            let channel_ids: Vec<Id> = voice
                .iter()
                .filter(|(_, users)| users.iter().any(|u| u == user_id))
                .map(|(id, _)| id.clone())
                .collect();
            for channel_id in channel_ids {
                if let Some(users) = voice.get_mut(&channel_id) {
                    users.retain(|u| u != user_id);
                    let snapshot = users.clone();
                    if let Some(server_id) =
                        self.store.read().ok().and_then(|store| {
                            store.channel(&channel_id).map(|c| c.server_id.clone())
                        })
                    {
                        changed.push((server_id, channel_id.clone(), snapshot));
                    }
                    if users.is_empty() {
                        voice.remove(&channel_id);
                    }
                }
            }
        }
        changed
    }

    pub fn voice_snapshot(&self) -> HashMap<Id, Vec<Id>> {
        self.voice.read().map(|v| v.clone()).unwrap_or_default()
    }
}

fn load_store(path: &Path) -> Option<Store> {
    let raw = fs::read_to_string(path).ok()?;
    let mut store: Store = serde_json::from_str(&raw).ok()?;
    if store.users.is_empty() {
        return None;
    }
    store.rebuild_index();
    Some(store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{now, Channel, ChannelKind, Store};

    #[test]
    fn seeded_store_is_usable() {
        let store = Store::seeded();
        assert_eq!(store.servers.len(), 1);
        assert_eq!(store.channels.len(), 4);
        assert!(store.messages["demo-0"].len() >= 3);
        assert!(store.is_member("demo", "outbox-bot"));
        let view = store
            .message_view(&store.messages["demo-0"][0], "outbox-bot")
            .unwrap();
        assert_eq!(view.author.display_name, "Outbox Bot");
    }

    #[test]
    fn presence_counts_multiple_tabs() {
        let state = AppState::new(PathBuf::from("data/test-store.json"));
        state.set_online("u1", true);
        state.set_online("u1", true);
        state.set_online("u1", false);
        assert_eq!(state.online_ids(), vec!["u1".to_string()]);
        state.set_online("u1", false);
        assert!(state.online_ids().is_empty());
    }

    #[test]
    fn voice_is_single_channel_per_user() {
        let state = AppState::new(PathBuf::from("data/test-store.json"));
        {
            let mut store = state.store.write().unwrap();
            for id in ["c1", "c2"] {
                store.channels.insert(
                    id.into(),
                    Channel {
                        id: id.into(),
                        server_id: "demo".into(),
                        name: id.into(),
                        kind: ChannelKind::Voice,
                        topic: String::new(),
                        position: 0,
                        created_at: now(),
                    },
                );
            }
        }
        {
            let mut voice = state.voice.write().unwrap();
            voice.insert("c1".into(), vec!["u1".into()]);
            voice.insert("c2".into(), vec!["u1".into()]);
        }
        let changed = state.leave_all_voice("u1");
        assert_eq!(changed.len(), 2);
        assert!(state.voice_snapshot().is_empty());
    }

    #[test]
    fn message_index_insert_locate_remove() {
        use crate::model::Message;

        let mut store = Store::seeded();
        assert_eq!(store.locate_message("seed-0"), Some(("demo-0".into(), 0)));

        let msg = Message {
            id: "msg-custom-1".into(),
            channel_id: "demo-1".into(),
            author_id: "outbox-bot".into(),
            content: "hello index".into(),
            created_at: now(),
            edited_at: None,
            reply_to: None,
            reactions: HashMap::new(),
            attachments: Vec::new(),
        };
        store.insert_message("demo-1".into(), msg);
        assert_eq!(
            store.locate_message("msg-custom-1"),
            Some(("demo-1".into(), 0))
        );

        let removed = store.remove_message("demo-1", 0);
        assert!(removed.is_some());
        assert_eq!(store.locate_message("msg-custom-1"), None);
    }
}

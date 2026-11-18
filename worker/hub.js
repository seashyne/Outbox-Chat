/**
 * OutboxHub Durable Object: manages SQLite persistence, in-memory store queries,
 * and delegates HTTP/WebSocket handling to `router.js`.
 */

import { DurableObject } from "cloudflare:workers";
import { handleWsDisconnect, handleWsMessage, routeHubRequest } from "./router.js";
import { seededStore } from "./seed.js";
import { defaultRolesConfig, normalizeServerFields } from "./server_templates.js";
import {
  HttpError,
  cmp,
  defaultSettings,
  eventServerId,
  jsonResponse,
  publicUser,
} from "./utils.js";

/** Single-coordinator Durable Object backing Outbox Chat on Cloudflare Workers. */
export class OutboxHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = null;
    this.voice = {};
    this.messageIndex = new Map();

    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      const rows = this.ctx.storage.sql.exec("SELECT key, value FROM kv").toArray();
      const map = new Map(rows.map((row) => [row.key, row.value]));
      if (map.has("store")) {
        this.store = JSON.parse(map.get("store"));
        let updated = false;
        if (this.store.servers?.demo && this.store.servers.demo.icon !== "HQ") {
          this.store.servers.demo.icon = "HQ";
          updated = true;
        }
        for (const user of Object.values(this.store.users || {})) {
          if (!user.settings) {
            user.settings = defaultSettings();
            updated = true;
          }
        }
        for (const srv of Object.values(this.store.servers || {})) {
          if (normalizeServerFields(srv)) updated = true;
        }
        if (updated) this.persistStore();
      } else {
        this.store = seededStore();
        this.persistStore();
      }
      this.store.friends = this.store.friends || {};
      this.store.server_profiles = this.store.server_profiles || {};
      this.voice = map.has("voice") ? JSON.parse(map.get("voice")) : {};
      this.rebuildIndex();
    });
  }

  persistStore() {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      "store",
      JSON.stringify(this.store)
    );
  }

  persistVoice() {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      "voice",
      JSON.stringify(this.voice)
    );
  }

  rebuildIndex() {
    this.messageIndex.clear();
    for (const [channelId, list] of Object.entries(this.store.messages || {})) {
      for (const message of list) this.messageIndex.set(message.id, channelId);
    }
  }

  locateMessage(messageId) {
    const indexedChannelId = this.messageIndex.get(messageId);
    if (indexedChannelId && this.store.messages[indexedChannelId]) {
      const idx = this.store.messages[indexedChannelId].findIndex((m) => m.id === messageId);
      if (idx !== -1) return [indexedChannelId, idx];
    }
    for (const [channelId, list] of Object.entries(this.store.messages)) {
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx !== -1) return [channelId, idx];
    }
    return null;
  }

  isMember(serverId, userId) {
    if (typeof serverId === "string" && serverId.startsWith("dm:")) {
      const parts = serverId.slice(3).split(":");
      return parts.length === 2 && (parts[0] === userId || parts[1] === userId);
    }
    return Boolean(this.store.members?.[serverId]?.[userId]);
  }

  role(serverId, userId) {
    return this.store.members?.[serverId]?.[userId] || null;
  }

  sortedChannels(serverId) {
    return Object.values(this.store.channels)
      .filter((c) => c.server_id === serverId)
      .sort((a, b) => {
        const kindDiff = (a.kind === "voice" ? 1 : 0) - (b.kind === "voice" ? 1 : 0);
        if (kindDiff !== 0) return kindDiff;
        return a.position !== b.position ? a.position - b.position : cmp(a.created_at, b.created_at);
      });
  }

  serverView(userId, server) {
    const memberRolesMap = this.store.members[server.id] || {};
    const members = Object.keys(memberRolesMap)
      .map((id) => this.store.users[id])
      .filter(Boolean)
      .map(publicUser)
      .sort((a, b) => cmp(a.display_name, b.display_name));
    const memberProfiles = {};
    for (const id of Object.keys(memberRolesMap)) {
      const prof = this.store.server_profiles?.[`${server.id}:${id}`];
      if (prof) memberProfiles[id] = prof;
    }

    return {
      id: server.id,
      name: server.name,
      icon: server.icon,
      description: server.description || "",
      accent_color: server.accent_color || "#5865f2",
      roles_config: server.roles_config || defaultRolesConfig(),
      owner_id: server.owner_id,
      created_at: server.created_at,
      role: this.role(server.id, userId) || "member",
      channels: this.sortedChannels(server.id),
      members,
      member_roles: { ...memberRolesMap },
      member_profiles: memberProfiles,
    };
  }

  messageView(message, viewerId) {
    const authorUser = this.store.users[message.author_id];
    if (!authorUser) return null;
    let reply = null;
    if (message.reply_to) {
      const target = (this.store.messages[message.channel_id] || []).find(
        (m) => m.id === message.reply_to
      );
      if (target && this.store.users[target.author_id]) {
        reply = {
          id: target.id,
          author: publicUser(this.store.users[target.author_id]),
          content: [...target.content].slice(0, 120).join(""),
        };
      }
    }
    const reactions = Object.entries(message.reactions || {})
      .filter(([, users]) => users.length > 0)
      .map(([emoji, users]) => ({
        emoji,
        count: users.length,
        me: users.includes(viewerId),
        users: [...users],
      }))
      .sort((a, b) => cmp(a.emoji, b.emoji));

    return {
      id: message.id,
      channel_id: message.channel_id,
      author: publicUser(authorUser),
      content: message.content,
      created_at: message.created_at,
      edited_at: message.edited_at ?? null,
      reply,
      reactions,
    };
  }

  authenticate(request) {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const userId = token ? this.store.tokens[token] : null;
    const user = userId ? this.store.users[userId] : null;
    if (!user) throw new HttpError(401, "invalid or missing token");
    return user;
  }

  requireMember(serverId, userId) {
    if (!this.isMember(serverId, userId)) {
      throw new HttpError(403, "you are not a member of this server");
    }
  }

  onlineIds(excludeWs = null) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      const meta = ws.deserializeAttachment();
      if (meta?.userId) ids.add(meta.userId);
    }
    return [...ids].sort(cmp);
  }

  voiceSnapshot() {
    const snapshot = {};
    for (const [channelId, users] of Object.entries(this.voice)) {
      if (users.length > 0) snapshot[channelId] = [...users];
    }
    return snapshot;
  }

  leaveAllVoice(userId) {
    const changes = [];
    for (const channelId of Object.keys(this.voice)) {
      const list = this.voice[channelId];
      const filtered = list.filter((id) => id !== userId);
      if (filtered.length !== list.length) {
        if (filtered.length === 0) delete this.voice[channelId];
        else this.voice[channelId] = filtered;
        const serverId = this.store.channels[channelId]?.server_id;
        if (serverId) changes.push({ serverId, channelId, users: filtered });
      }
    }
    if (changes.length > 0) this.persistVoice();
    return changes;
  }

  emit(event, excludeWs = null) {
    const payload = JSON.stringify(event);
    const serverId = eventServerId(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      const meta = ws.deserializeAttachment();
      if (!meta?.userId) continue;
      if (event.to && meta.userId !== event.to) continue;
      if (serverId && !this.isMember(serverId, meta.userId)) continue;
      try {
        ws.send(payload);
      } catch {
        // Closed sockets are cleaned up by webSocketClose/webSocketError.
      }
    }
  }

  async fetch(request) {
    return routeHubRequest(this, request);
  }

  async webSocketMessage(ws, raw) {
    handleWsMessage(this, ws, raw);
  }

  async webSocketClose(ws) {
    handleWsDisconnect(this, ws);
  }

  async webSocketError(ws) {
    handleWsDisconnect(this, ws);
  }

  handleHealth() {
    const messages = Object.values(this.store.messages).reduce((sum, list) => sum + list.length, 0);
    return jsonResponse({
      status: "ok",
      service: "outbox-chat",
      users: Object.keys(this.store.users).length,
      servers: Object.keys(this.store.servers).length,
      messages,
      online: this.onlineIds().length,
      note: "Outbox Chat พร้อมใช้งาน",
    });
  }
}

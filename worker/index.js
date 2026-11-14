import { DurableObject } from "cloudflare:workers";

const AVATAR_COLORS = [
  "#5865f2",
  "#eb459e",
  "#ed4245",
  "#faa61a",
  "#23a559",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const textEncoder = new TextEncoder();

const newId = () => crypto.randomUUID().replace(/-/g, "");
const newToken = () => `${newId()}${newId()}`;
const nowIso = () => new Date().toISOString();

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    color: user.color,
    bot: Boolean(user.bot),
  };
}

function cleanText(raw, max, what) {
  if (typeof raw !== "string") {
    throw new HttpError(400, `${what} must be 1-${max} characters`);
  }
  const value = raw.trim();
  const len = [...value].length;
  if (len === 0 || len > max) {
    throw new HttpError(400, `${what} must be 1-${max} characters`);
  }
  return value;
}

const SLUG_CHAR_RE = /^[\p{L}\p{N}\u0E31-\u0E3A\u0E47-\u0E4E_]$/u;

function slug(raw) {
  if (typeof raw !== "string") {
    throw new HttpError(400, "channel name must be 1-32 letters, digits, '-' or '_'");
  }
  let value = "";
  let prevDash = false;
  for (const ch of raw.trim().toLowerCase()) {
    if (SLUG_CHAR_RE.test(ch)) {
      value += ch;
      prevDash = false;
    } else if (!prevDash && value.length > 0) {
      value += "-";
      prevDash = true;
    }
  }
  value = value.replace(/^-+|-+$/g, "");
  const len = [...value].length;
  if (len === 0 || len > 32) {
    throw new HttpError(400, "channel name must be 1-32 letters, digits, '-' or '_'");
  }
  return value;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

async function readJson(request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new HttpError(400, "invalid JSON payload");
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "invalid JSON payload");
  }
}

function seededStore() {
  const created = nowIso();
  const bot = {
    id: "outbox-bot",
    username: "outbox-bot",
    display_name: "Outbox Bot",
    color: "#5865f2",
    token: newToken(),
    bot: true,
    created_at: created,
  };

  const server = {
    id: "demo",
    name: "Outbox HQ",
    icon: "🚀",
    owner_id: bot.id,
    created_at: created,
  };

  const channelSpecs = [
    ["general", "text", "ยินดีต้อนรับ! ที่นี่คือห้องคุยรวมของ Outbox HQ"],
    ["team-chat", "text", "คุยเรื่องงาน ไอเดียใหม่ ๆ หรืออะไรก็ได้"],
    ["random", "text", "แชร์เรื่องสนุก ๆ ได้ตามสบาย"],
    ["Lounge", "voice", "ห้องเสียงสำหรับนั่งคุยกัน"],
  ];

  const channels = {};
  channelSpecs.forEach(([name, kind, topic], index) => {
    const id = `demo-${index}`;
    channels[id] = {
      id,
      server_id: server.id,
      name,
      kind,
      topic,
      position: index,
      created_at: nowIso(),
    };
  });

  const greetings = [
    "ยินดีต้อนรับสู่ **Outbox Chat** 👋 มารู้จักกันและคุยกันได้เลยนะ",
    "ลองเปิดอีกหน้าต่าง ใช้ชื่ออื่น แล้วพิมพ์ข้อความดูสิ — เพื่อนจะเห็นทันที ⚡",
    "สร้างเซิร์ฟเวอร์หรือช่องใหม่ได้จากปุ่ม + ด้านซ้าย หรือกดห้องเสียงเพื่อดูว่าใครอยู่บ้าง",
  ];

  const messages = {
    "demo-0": greetings.map((content, index) => ({
      id: `seed-${index}`,
      channel_id: "demo-0",
      author_id: bot.id,
      content,
      created_at: nowIso(),
      edited_at: null,
      reply_to: null,
      reactions: index === 0 ? { "👋": [bot.id], "💜": [bot.id] } : {},
    })),
  };

  return {
    users: { [bot.id]: bot },
    tokens: { [bot.token]: bot.id },
    servers: { [server.id]: server },
    channels,
    messages,
    members: { [server.id]: { [bot.id]: "owner" } },
  };
}

function eventServerId(event) {
  if (event.type === "presence") return null;
  if (event.type === "server_create") return event.server.id;
  return event.server_id || null;
}

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
      } else {
        this.store = seededStore();
        this.persistStore();
      }
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
      for (const message of list) {
        this.messageIndex.set(message.id, channelId);
      }
    }
  }

  locateMessage(messageId) {
    const indexedChannelId = this.messageIndex.get(messageId);
    if (indexedChannelId) {
      const list = this.store.messages[indexedChannelId];
      if (list) {
        const index = list.findIndex((m) => m.id === messageId);
        if (index !== -1) return [indexedChannelId, index];
      }
    }
    for (const [channelId, list] of Object.entries(this.store.messages)) {
      const index = list.findIndex((m) => m.id === messageId);
      if (index !== -1) return [channelId, index];
    }
    return null;
  }

  isMember(serverId, userId) {
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
        if (a.position !== b.position) return a.position - b.position;
        return cmp(a.created_at, b.created_at);
      });
  }

  serverView(userId, server) {
    const memberIds = Object.keys(this.store.members[server.id] || {});
    const members = memberIds
      .map((id) => this.store.users[id])
      .filter(Boolean)
      .map(publicUser)
      .sort((a, b) => cmp(a.display_name, b.display_name));

    return {
      id: server.id,
      name: server.name,
      icon: server.icon,
      owner_id: server.owner_id,
      created_at: server.created_at,
      role: this.role(server.id, userId) || "member",
      channels: this.sortedChannels(server.id),
      members,
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
    if (!token) throw new HttpError(401, "invalid or missing token");
    const userId = this.store.tokens[token];
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
        if (filtered.length === 0) {
          delete this.voice[channelId];
        } else {
          this.voice[channelId] = filtered;
        }
        const serverId = this.store.channels[channelId]?.server_id;
        if (serverId) {
          changes.push({ serverId, channelId, users: filtered });
        }
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
      if (serverId && !this.isMember(serverId, meta.userId)) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket may already be closing; webSocketClose/webSocketError cleans up.
      }
    }
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (method === "GET" && path === "/api/ws") {
        return this.handleWsUpgrade(url);
      }
      if (method === "GET" && path === "/api/health") {
        return this.handleHealth();
      }
      if (method === "POST" && path === "/api/register") {
        return await this.handleRegister(request);
      }
      if (method === "GET" && path === "/api/bootstrap") {
        return this.handleBootstrap(request);
      }
      if (method === "GET" && path === "/api/servers") {
        return this.handleListServers(request);
      }
      if (method === "POST" && path === "/api/servers") {
        return await this.handleCreateServer(request);
      }

      let match;
      if (method === "POST" && (match = path.match(/^\/api\/servers\/([^/]+)\/channels$/))) {
        return await this.handleCreateChannel(request, decodeURIComponent(match[1]));
      }
      if (method === "POST" && (match = path.match(/^\/api\/servers\/([^/]+)\/join$/))) {
        return this.handleJoinServer(request, decodeURIComponent(match[1]));
      }
      if (method === "GET" && (match = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
        return this.handleListMessages(request, decodeURIComponent(match[1]), url);
      }
      if (method === "POST" && (match = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
        return await this.handlePostMessage(request, decodeURIComponent(match[1]));
      }
      if (method === "DELETE" && (match = path.match(/^\/api\/messages\/([^/]+)$/))) {
        return this.handleDeleteMessage(request, decodeURIComponent(match[1]));
      }
      if (method === "POST" && (match = path.match(/^\/api\/messages\/([^/]+)\/reactions$/))) {
        return await this.handleToggleReaction(request, decodeURIComponent(match[1]));
      }
      if (method === "POST" && (match = path.match(/^\/api\/channels\/([^/]+)\/voice\/join$/))) {
        return this.handleVoiceJoin(request, decodeURIComponent(match[1]));
      }
      if (method === "POST" && (match = path.match(/^\/api\/channels\/([^/]+)\/voice\/leave$/))) {
        return this.handleVoiceLeave(request, decodeURIComponent(match[1]));
      }

      throw new HttpError(404, "route not found");
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonResponse({ error: err.message, status: err.status }, err.status);
      }
      console.error("[outbox-hub] internal error:", err);
      return jsonResponse({ error: "internal server error", status: 500 }, 500);
    }
  }

  handleWsUpgrade(url) {
    const token = (url.searchParams.get("token") || "").trim();
    const userId = token ? this.store.tokens[token] : null;
    const user = userId ? this.store.users[userId] : null;
    if (!user) {
      throw new HttpError(401, "invalid or missing token");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: user.id });

    const online = [...new Set([...this.onlineIds(), user.id])].sort(cmp);
    server.send(
      JSON.stringify({
        type: "ready",
        user: publicUser(user),
        online,
        heartbeat_interval: 25000,
      })
    );
    this.emit({ type: "presence", online });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (!meta?.userId) return;
    const user = this.store.users[meta.userId];
    if (!user) return;

    let payload;
    try {
      payload = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    if (payload?.type === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong" }));
      } catch {}
      return;
    }

    if (payload?.type === "typing" && typeof payload.channel_id === "string") {
      const channel = this.store.channels[payload.channel_id];
      if (channel && this.isMember(channel.server_id, user.id)) {
        this.emit({
          type: "typing",
          server_id: channel.server_id,
          channel_id: channel.id,
          user: publicUser(user),
        });
      }
    }
  }

  async webSocketClose(ws) {
    this.handleSocketDisconnect(ws);
  }

  async webSocketError(ws) {
    this.handleSocketDisconnect(ws);
  }

  handleSocketDisconnect(ws) {
    const meta = ws.deserializeAttachment();
    if (!meta?.userId) return;
    const userId = meta.userId;
    const online = this.onlineIds(ws);

    if (!online.includes(userId)) {
      for (const { serverId, channelId, users } of this.leaveAllVoice(userId)) {
        this.emit(
          { type: "voice_state", server_id: serverId, channel_id: channelId, users },
          ws
        );
      }
    }
    this.emit({ type: "presence", online }, ws);
  }

  handleHealth() {
    const users = Object.keys(this.store.users).length;
    const servers = Object.keys(this.store.servers).length;
    const messages = Object.values(this.store.messages).reduce((sum, list) => sum + list.length, 0);
    return jsonResponse({
      status: "ok",
      service: "outbox-chat",
      users,
      servers,
      messages,
      online: this.onlineIds().length,
      note: "Outbox Chat พร้อมใช้งาน",
    });
  }

  async handleRegister(request) {
    const body = await readJson(request);
    const username = cleanText(body.username, 32, "username");
    const lowered = username.toLowerCase();
    const taken = Object.values(this.store.users).some(
      (u) => u.username.toLowerCase() === lowered
    );
    if (taken) {
      throw new HttpError(409, "username is already taken");
    }

    const byteLen = textEncoder.encode(username).length;
    const user = {
      id: newId(),
      username,
      display_name: username,
      color: AVATAR_COLORS[byteLen % AVATAR_COLORS.length],
      token: newToken(),
      bot: false,
      created_at: nowIso(),
    };

    this.store.tokens[user.token] = user.id;
    this.store.users[user.id] = user;

    let joinedDemo = false;
    if (this.store.members.demo) {
      this.store.members.demo[user.id] = "member";
      joinedDemo = true;
    }

    this.persistStore();
    if (joinedDemo) {
      this.emit({
        type: "member_join",
        server_id: "demo",
        user: publicUser(user),
      });
    }

    return jsonResponse({ token: user.token, user: publicUser(user) });
  }

  handleBootstrap(request) {
    const currentUser = this.authenticate(request);
    const me = publicUser(currentUser);
    const mine = Object.values(this.store.servers)
      .filter((s) => this.isMember(s.id, me.id))
      .sort((a, b) => cmp(a.created_at, b.created_at));

    const servers = mine.map((s) => this.serverView(me.id, s));
    const default_server_id = servers[0]?.id ?? null;
    const default_channel_id =
      servers[0]?.channels.find((c) => c.kind === "text")?.id ?? null;

    return jsonResponse({
      me,
      servers,
      online: this.onlineIds(),
      voice: this.voiceSnapshot(),
      default_server_id,
      default_channel_id,
    });
  }

  handleListServers(request) {
    const user = this.authenticate(request);
    const servers = Object.values(this.store.servers)
      .map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        member_count: Object.keys(this.store.members[s.id] || {}).length,
        joined: this.isMember(s.id, user.id),
      }))
      .sort((a, b) => cmp(a.name, b.name));
    return jsonResponse(servers);
  }

  async handleCreateServer(request) {
    const user = this.authenticate(request);
    const body = await readJson(request);
    const name = cleanText(body.name, 48, "server name");
    const customIcon =
      typeof body.icon === "string" ? [...body.icon.trim()].slice(0, 4).join("") : "";
    const icon = customIcon || [...name][0].toUpperCase();

    const server = {
      id: newId(),
      name,
      icon,
      owner_id: user.id,
      created_at: nowIso(),
    };
    const general = {
      id: newId(),
      server_id: server.id,
      name: "general",
      kind: "text",
      topic: "ช่องทั่วไป",
      position: 0,
      created_at: nowIso(),
    };

    this.store.members[server.id] = { [user.id]: "owner" };
    this.store.channels[general.id] = general;
    this.store.servers[server.id] = server;
    const view = this.serverView(user.id, server);

    this.persistStore();
    this.emit({ type: "server_create", server });
    return jsonResponse(view);
  }

  handleJoinServer(request, serverId) {
    const user = this.authenticate(request);
    const server = this.store.servers[serverId];
    if (!server) throw new HttpError(404, "server not found");

    if (!this.store.members[serverId]) this.store.members[serverId] = {};
    const joined = !this.store.members[serverId][user.id];
    if (joined) this.store.members[serverId][user.id] = "member";

    const view = this.serverView(user.id, server);
    this.persistStore();
    if (joined) {
      this.emit({
        type: "member_join",
        server_id: serverId,
        user: publicUser(user),
      });
    }
    return jsonResponse(view);
  }

  async handleCreateChannel(request, serverId) {
    const user = this.authenticate(request);
    const body = await readJson(request);
    const kind = body.kind === undefined ? "text" : body.kind;
    if (kind !== "text" && kind !== "voice") {
      throw new HttpError(400, "invalid channel kind");
    }

    const name = kind === "text" ? slug(body.name) : cleanText(body.name, 32, "channel name");
    const topic =
      typeof body.topic === "string" ? [...body.topic.trim()].slice(0, 180).join("") : "";

    if (!this.store.servers[serverId]) throw new HttpError(404, "server not found");
    this.requireMember(serverId, user.id);

    const position = Object.values(this.store.channels).filter(
      (c) => c.server_id === serverId && c.kind === kind
    ).length;

    const channel = {
      id: newId(),
      server_id: serverId,
      name,
      kind,
      topic,
      position,
      created_at: nowIso(),
    };
    this.store.channels[channel.id] = channel;
    this.persistStore();
    this.emit({ type: "channel_create", server_id: serverId, channel });
    return jsonResponse(channel);
  }

  handleListMessages(request, channelId, url) {
    const user = this.authenticate(request);
    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");
    this.requireMember(channel.server_id, user.id);
    if (channel.kind !== "text") {
      throw new HttpError(400, "voice channels do not have a message history");
    }

    let messages = [...(this.store.messages[channelId] || [])];
    const before = url.searchParams.get("before");
    if (before) {
      const index = messages.findIndex((m) => m.id === before);
      if (index !== -1) messages = messages.slice(0, index);
    }

    const rawLimit = url.searchParams.get("limit");
    let limit = 60;
    if (rawLimit !== null && rawLimit !== "") {
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpError(400, "invalid limit");
      }
      limit = Math.min(Math.max(parsed, 1), 200);
    }

    const start = Math.max(messages.length - limit, 0);
    const views = messages
      .slice(start)
      .map((m) => this.messageView(m, user.id))
      .filter(Boolean);
    return jsonResponse(views);
  }

  async handlePostMessage(request, channelId) {
    const user = this.authenticate(request);
    const body = await readJson(request);
    const content = cleanText(body.content, 2000, "message");

    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");
    this.requireMember(channel.server_id, user.id);
    if (channel.kind !== "text") {
      throw new HttpError(400, "cannot post messages to a voice channel");
    }

    const replyTo =
      typeof body.reply_to === "string" &&
      (this.store.messages[channelId] || []).some((m) => m.id === body.reply_to)
        ? body.reply_to
        : null;

    const message = {
      id: newId(),
      channel_id: channelId,
      author_id: user.id,
      content,
      created_at: nowIso(),
      edited_at: null,
      reply_to: replyTo,
      reactions: {},
    };

    if (!this.store.messages[channelId]) this.store.messages[channelId] = [];
    this.store.messages[channelId].push(message);
    this.messageIndex.set(message.id, channelId);

    const view = this.messageView(message, user.id);
    if (!view) throw new HttpError(500, "internal server error");

    this.persistStore();
    this.emit({ type: "message_create", server_id: channel.server_id, message: view });
    return jsonResponse(view);
  }

  handleDeleteMessage(request, messageId) {
    const user = this.authenticate(request);
    const located = this.locateMessage(messageId);
    if (!located) throw new HttpError(404, "message not found");
    const [channelId, index] = located;

    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");

    const message = this.store.messages[channelId][index];
    const userRole = this.role(channel.server_id, user.id);
    const canManage = userRole === "owner" || userRole === "admin";
    if (message.author_id !== user.id && !canManage) {
      throw new HttpError(403, "only the author or a server admin can delete this message");
    }

    this.store.messages[channelId].splice(index, 1);
    this.messageIndex.delete(messageId);
    this.persistStore();
    this.emit({
      type: "message_delete",
      server_id: channel.server_id,
      channel_id: channelId,
      message_id: messageId,
    });
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  async handleToggleReaction(request, messageId) {
    const user = this.authenticate(request);
    const body = await readJson(request);
    const rawEmoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
    const emoji = [...rawEmoji].slice(0, 8).join("");
    if (!emoji) throw new HttpError(400, "emoji is required");

    const located = this.locateMessage(messageId);
    if (!located) throw new HttpError(404, "message not found");
    const [channelId, index] = located;

    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");
    this.requireMember(channel.server_id, user.id);

    const message = this.store.messages[channelId]?.[index];
    if (!message) throw new HttpError(404, "message not found");

    if (!message.reactions) message.reactions = {};
    const users = message.reactions[emoji] || [];
    const existingIndex = users.indexOf(user.id);
    if (existingIndex !== -1) {
      users.splice(existingIndex, 1);
    } else {
      users.push(user.id);
    }
    if (users.length === 0) {
      delete message.reactions[emoji];
    } else {
      message.reactions[emoji] = users;
    }

    const view = this.messageView(message, user.id);
    if (!view) throw new HttpError(500, "internal server error");

    this.persistStore();
    this.emit({
      type: "message_update",
      server_id: channel.server_id,
      message: view,
      actor_id: user.id,
    });
    return jsonResponse(view);
  }

  handleVoiceJoin(request, channelId) {
    const user = this.authenticate(request);
    if (!this.onlineIds().includes(user.id)) {
      throw new HttpError(400, "voice requires an active WebSocket connection");
    }

    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");
    this.requireMember(channel.server_id, user.id);
    if (channel.kind !== "voice") {
      throw new HttpError(400, "not a voice channel");
    }

    for (const { serverId, channelId: leftCid, users } of this.leaveAllVoice(user.id)) {
      this.emit({ type: "voice_state", server_id: serverId, channel_id: leftCid, users });
    }

    const entry = this.voice[channelId] || [];
    if (!entry.includes(user.id)) entry.push(user.id);
    this.voice[channelId] = entry;
    this.persistVoice();

    const users = [...entry];
    this.emit({
      type: "voice_state",
      server_id: channel.server_id,
      channel_id: channelId,
      users,
    });
    return jsonResponse({ channel_id: channelId, users });
  }

  handleVoiceLeave(request, channelId) {
    const user = this.authenticate(request);
    const channel = this.store.channels[channelId];
    if (!channel) throw new HttpError(404, "channel not found");

    const entry = (this.voice[channelId] || []).filter((id) => id !== user.id);
    if (entry.length === 0) {
      delete this.voice[channelId];
    } else {
      this.voice[channelId] = entry;
    }
    this.persistVoice();

    const users = [...entry];
    this.emit({
      type: "voice_state",
      server_id: channel.server_id,
      channel_id: channelId,
      users,
    });
    return jsonResponse({ channel_id: channelId, users });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const stub = env.OUTBOX_HUB.get(env.OUTBOX_HUB.idFromName("global"));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * Messaging, clean reaction tokens, and voice room presence handlers
 * for the OutboxHub Durable Object.
 */

import { validateAttachments } from "./handlers_files.js";
import {
  CORS_HEADERS,
  HttpError,
  cleanText,
  jsonResponse,
  newId,
  nowIso,
  readJson,
} from "./utils.js";

const ALLOWED_REACTIONS = ["+1", "Like", "Ack", "Done", "Help", "Idea"];

/** Fetches paginated message history for a text channel. */
export function handleListMessages(hub, request, channelId, url) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");
  if (channel.kind !== "text") {
    throw new HttpError(400, "voice channels do not have a message history");
  }

  let messages = [...(hub.store.messages[channelId] || [])];
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
    .map((m) => hub.messageView(m, user.id))
    .filter(Boolean);
  return jsonResponse(views);
}

/** Posts a new message (or reply) to a text channel and emits `message_create`. */
export async function handlePostMessage(hub, request, channelId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const attachments = validateAttachments(body.attachments);
  const rawContent = typeof body.content === "string" ? body.content : "";
  let content = "";
  if (attachments.length === 0 || rawContent.trim()) {
    content = cleanText(rawContent, 2000, "message");
  } else if (/[\x00-\x1F\x7F]/.test(rawContent)) {
    throw new HttpError(400, "message cannot contain control characters");
  }

  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");
  if (channel.kind !== "text") {
    throw new HttpError(400, "cannot post messages to a voice channel");
  }
  const role = hub.role(channel.server_id, user.id);
  const isManager = role === "owner" || role === "admin";
  if (!channelId.startsWith("dm:") && hub.activeTimeoutUntil(channel.server_id, user.id)) {
    throw new HttpError(403, "you are currently timed out in this server");
  }
  if (channel.read_only && !isManager) throw new HttpError(403, "this channel is read-only");
  if ((channel.slowmode_seconds || 0) > 0 && !isManager) {
    const nowSec = Math.floor(Date.now() / 1000);
    const key = `${channelId}:${user.id}`;
    const lastSec = hub.slowmodeLast.get(key);
    if (lastSec !== undefined) {
      const elapsed = nowSec - lastSec;
      if (elapsed < channel.slowmode_seconds) {
        throw new HttpError(429, `slowmode active: wait ${channel.slowmode_seconds - elapsed}s`);
      }
    }
    hub.slowmodeLast.set(key, nowSec);
  }

  const replyTo =
    typeof body.reply_to === "string" &&
    (hub.store.messages[channelId] || []).some((m) => m.id === body.reply_to)
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
    attachments,
    pinned: false,
  };

  if (!hub.store.messages[channelId]) hub.store.messages[channelId] = [];
  hub.store.messages[channelId].push(message);
  hub.messageIndex.set(message.id, channelId);

  const view = hub.messageView(message, user.id);
  if (!view) throw new HttpError(500, "internal server error");

  hub.persistStore();
  hub.emit({ type: "message_create", server_id: channel.server_id, message: view });
  return jsonResponse(view);
}

/** Deletes a message (author, admin, or owner) and emits `message_delete`. */
export function handleDeleteMessage(hub, request, messageId) {
  const user = hub.authenticate(request);
  const located = hub.locateMessage(messageId);
  if (!located) throw new HttpError(404, "message not found");
  const [channelId, index] = located;

  const parentId = hub.store.threads?.[channelId]?.channel_id || channelId;
  const channel = hub.store.channels[parentId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");

  const message = hub.store.messages[channelId][index];
  const userRole = hub.role(channel.server_id, user.id);
  const canManage = userRole === "owner" || userRole === "admin";
  if (message.author_id !== user.id && !canManage) {
    throw new HttpError(403, "only the author or a server admin can delete this message");
  }

  hub.store.messages[channelId].splice(index, 1);
  hub.messageIndex.delete(messageId);
  hub.persistStore();
  hub.emit({
    type: "message_delete",
    server_id: channel.server_id,
    channel_id: channelId,
    message_id: messageId,
  });
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Toggles one of the supported clean text reaction tokens on a message. */
export async function handleToggleReaction(hub, request, messageId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const rawEmoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  const emoji = [...rawEmoji].slice(0, 8).join("");
  if (!ALLOWED_REACTIONS.includes(emoji)) {
    throw new HttpError(400, "only clean text reactions are supported");
  }

  const located = hub.locateMessage(messageId);
  if (!located) throw new HttpError(404, "message not found");
  const [channelId, index] = located;

  const parentId = hub.store.threads?.[channelId]?.channel_id || channelId;
  const channel = hub.store.channels[parentId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");

  const message = hub.store.messages[channelId]?.[index];
  if (!message) throw new HttpError(404, "message not found");

  if (!message.reactions) message.reactions = {};
  const users = message.reactions[emoji] || [];
  const existingIndex = users.indexOf(user.id);
  if (existingIndex !== -1) users.splice(existingIndex, 1);
  else users.push(user.id);

  if (users.length === 0) delete message.reactions[emoji];
  else message.reactions[emoji] = users;

  const view = hub.messageView(message, user.id);
  if (!view) throw new HttpError(500, "internal server error");

  hub.persistStore();
  hub.emit({
    type: "message_update",
    server_id: channel.server_id,
    message: view,
    actor_id: user.id,
  });
  return jsonResponse(view);
}

/** Joins a voice channel (requires active WebSocket connection). */
export function handleVoiceJoin(hub, request, channelId) {
  const user = hub.authenticate(request);
  if (!hub.onlineIds().includes(user.id)) {
    throw new HttpError(400, "voice requires an active WebSocket connection");
  }

  const parentId = hub.store.threads?.[channelId]?.channel_id || channelId;
  const channel = hub.store.channels[parentId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");
  if (channel.kind !== "voice" && !channel.id.startsWith("dm:")) throw new HttpError(400, "not a voice channel");

  for (const { serverId, channelId: leftCid, users } of hub.leaveAllVoice(user.id)) {
    hub.emit({ type: "voice_state", server_id: serverId, channel_id: leftCid, users });
  }

  const entry = hub.voice[channelId] || [];
  if (!entry.includes(user.id)) entry.push(user.id);
  hub.voice[channelId] = entry;
  hub.persistVoice();

  const users = [...entry];
  hub.emit({ type: "voice_state", server_id: channel.server_id, channel_id: channelId, users });
  return jsonResponse({ channel_id: channelId, users });
}

/** Leaves a voice channel and broadcasts updated occupancy. */
export function handleVoiceLeave(hub, request, channelId) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");

  const entry = (hub.voice[channelId] || []).filter((id) => id !== user.id);
  if (entry.length === 0) delete hub.voice[channelId];
  else hub.voice[channelId] = entry;
  hub.persistVoice();

  const users = [...entry];
  hub.emit({ type: "voice_state", server_id: channel.server_id, channel_id: channelId, users });
  return jsonResponse({ channel_id: channelId, users });
}

/**
 * Returns WebRTC ICE/TURN servers for authenticated meeting participants.
 * Mints short-lived Cloudflare Realtime TURN credentials when `CF_TURN_TOKEN_ID`
 * and `CF_TURN_API_TOKEN` secrets are configured on the Worker.
 */
export async function handleRtcIce(hub, request) {
  hub.authenticate(request);
  const env = hub.env || {};
  const tokenId = env.CF_TURN_TOKEN_ID;
  const apiToken = env.CF_TURN_API_TOKEN;

  if (tokenId && apiToken) {
    try {
      const resp = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(tokenId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );
      if (resp.ok) {
        const payload = await resp.json();
        if (Array.isArray(payload?.iceServers) && payload.iceServers.length) {
          return jsonResponse({ iceServers: payload.iceServers, turnEnabled: true });
        }
      }
    } catch {}
  }

  if (env.ICE_SERVERS_JSON) {
    try {
      const parsed = JSON.parse(env.ICE_SERVERS_JSON);
      if (Array.isArray(parsed) && parsed.length) {
        return jsonResponse({ iceServers: parsed, turnEnabled: /turns?:/i.test(env.ICE_SERVERS_JSON) });
      }
    } catch {}
  }

  return jsonResponse({
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }],
    turnEnabled: false,
  });
}

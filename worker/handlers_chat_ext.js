/**
 * Extended Phase 1 chat handlers for OutboxHub Durable Object:
 * message editing, pinning, cross-channel search, custom server stickers, and link previews.
 */

import { parseImageUrl } from "./handlers_friends.js";
import {
  CORS_HEADERS,
  HttpError,
  cleanText,
  cmp,
  jsonResponse,
  newId,
  nowIso,
  readJson,
} from "./utils.js";

/** Edits a message (author only), sets `edited_at`, and broadcasts `message_update`. */
export async function handleEditMessage(hub, request, messageId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const content = cleanText(body.content, 2000, "message");

  const located = hub.locateMessage(messageId);
  if (!located) throw new HttpError(404, "message not found");
  const [channelId, index] = located;
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);

  const message = hub.store.messages[channelId]?.[index];
  if (!message) throw new HttpError(404, "message not found");
  if (message.author_id !== user.id) {
    throw new HttpError(403, "only the author can edit this message");
  }

  message.content = content;
  message.edited_at = nowIso();
  const view = hub.messageView(message, user.id);
  hub.persistStore();
  hub.emit({ type: "message_update", server_id: channel.server_id, message: view, actor_id: user.id });
  return jsonResponse(view);
}

/** Toggles pin state on a message and broadcasts `message_update`. */
export function handleTogglePinMessage(hub, request, messageId) {
  const user = hub.authenticate(request);
  const located = hub.locateMessage(messageId);
  if (!located) throw new HttpError(404, "message not found");
  const [channelId, index] = located;
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);

  const message = hub.store.messages[channelId]?.[index];
  if (!message) throw new HttpError(404, "message not found");
  message.pinned = !message.pinned;

  const view = hub.messageView(message, user.id);
  hub.persistStore();
  hub.emit({ type: "message_update", server_id: channel.server_id, message: view, actor_id: user.id });
  return jsonResponse(view);
}

/** Lists pinned messages in a channel (newest first). */
export function handleListPinnedMessages(hub, request, channelId) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);

  const list = [...(hub.store.messages[channelId] || [])]
    .reverse()
    .filter((m) => m.pinned)
    .slice(0, 50)
    .map((m) => hub.messageView(m, user.id))
    .filter(Boolean);
  return jsonResponse(list);
}

/** Searches messages across all text channels in a server (`GET /api/servers/{id}/search?q=...`). */
export function handleSearchServerMessages(hub, request, serverId, url) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const needle = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (!needle) return jsonResponse([]);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "40", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 40;

  const textChannelIds = Object.values(hub.store.channels)
    .filter((c) => c.server_id === serverId && c.kind === "text")
    .map((c) => c.id);

  const hits = [];
  for (const cid of textChannelIds) {
    for (const msg of hub.store.messages[cid] || []) {
      const author = hub.store.users[msg.author_id];
      const authorMatch = author && (
        author.display_name.toLowerCase().includes(needle) ||
        author.username.toLowerCase().includes(needle)
      );
      if ((msg.content || "").toLowerCase().includes(needle) || authorMatch) {
        const view = hub.messageView(msg, user.id);
        if (view) hits.push(view);
      }
    }
  }
  hits.sort((a, b) => cmp(b.created_at, a.created_at));
  return jsonResponse(hits.slice(0, limit));
}

/** Lists custom stickers for a server. */
export function handleListStickers(hub, request, serverId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  return jsonResponse([...(hub.store.stickers?.[serverId] || [])]);
}

/** Creates a custom server sticker (`POST /api/servers/{id}/stickers`). */
export async function handleCreateSticker(hub, request, serverId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const body = await readJson(request);
  const name = cleanText(body.name, 24, "sticker name");
  const dataUrl = parseImageUrl(body.data_url, 65536);
  if (!dataUrl) throw new HttpError(400, "sticker image is required");

  hub.store.stickers = hub.store.stickers || {};
  const list = hub.store.stickers[serverId] || [];
  if (list.length >= 24) throw new HttpError(400, "maximum 24 stickers per server");

  const sticker = {
    id: newId(),
    server_id: serverId,
    name,
    data_url: dataUrl,
    created_by: user.id,
    created_at: nowIso(),
  };
  list.push(sticker);
  hub.store.stickers[serverId] = list;
  hub.persistStore();
  return jsonResponse(sticker);
}

/** Deletes a custom server sticker (creator, admin, or owner). */
export function handleDeleteSticker(hub, request, serverId, stickerId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const list = hub.store.stickers?.[serverId] || [];
  const idx = list.findIndex((s) => s.id === stickerId);
  if (idx === -1) throw new HttpError(404, "sticker not found");
  const role = hub.role(serverId, user.id);
  const canManage = role === "owner" || role === "admin";
  if (list[idx].created_by !== user.id && !canManage) {
    throw new HttpError(403, "insufficient permissions to delete sticker");
  }
  list.splice(idx, 1);
  hub.persistStore();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Generates safe link preview metadata (`GET /api/links/preview?url=...`). */
export function handlePreviewLink(hub, request, url) {
  hub.authenticate(request);
  const raw = (url.searchParams.get("url") || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(400, "only http/https URLs are supported");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(400, "only http/https URLs are supported");
  }
  const domain = parsed.hostname.toLowerCase();
  if (
    !domain.includes(".") ||
    domain === "localhost" ||
    domain.startsWith("127.") ||
    domain.startsWith("10.") ||
    domain.startsWith("192.168.")
  ) {
    throw new HttpError(400, "invalid or private URL");
  }

  let ytId = null;
  if (domain.includes("youtube.com")) ytId = parsed.searchParams.get("v");
  else if (domain === "youtu.be") ytId = parsed.pathname.replace(/^\/+/, "").split("/")[0];
  if (ytId && !/^[A-Za-z0-9_-]{6,}$/.test(ytId)) ytId = null;

  if (ytId) {
    return jsonResponse({
      url: raw,
      domain,
      title: `YouTube Video (${ytId})`,
      description: `วิดีโอจาก ${domain}`,
      image: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    });
  }
  const slug = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/[-_]/g, " ");
  return jsonResponse({
    url: raw,
    domain,
    title: slug ? `${domain} — ${slug}` : domain,
    description: `ลิงก์เว็บไซต์จาก ${domain}`,
    image: null,
  });
}

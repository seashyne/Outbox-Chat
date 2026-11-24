/**
 * Channel update (categories, visibility, read-only, slowmode) and
 * discussion thread handlers for OutboxHub Durable Object.
 */

import { validateAttachments } from "./handlers_files.js";
import { recordAudit } from "./handlers_moderation.js";
import { HttpError, cleanText, cmp, jsonResponse, newId, nowIso, readJson, slug } from "./utils.js";

function buildThreadView(hub, thread) {
  const creator = hub.store.users[thread.created_by];
  const msgs = hub.store.messages[thread.id] || [];
  const last = msgs.length ? msgs[msgs.length - 1].created_at : null;
  return {
    id: thread.id,
    server_id: thread.server_id,
    channel_id: thread.channel_id,
    parent_message_id: thread.parent_message_id ?? null,
    title: thread.title,
    created_by: thread.created_by,
    creator_name: creator ? creator.display_name : "สมาชิก",
    created_at: thread.created_at,
    message_count: msgs.length,
    last_message_at: last,
  };
}

function requireWritableText(hub, channel, userId) {
  hub.requireMember(channel.server_id, userId);
  if (!hub.canViewChannel(channel, userId)) throw new HttpError(403, "you cannot access this channel");
  if (channel.kind !== "text") throw new HttpError(400, "threads require a text channel");
  const role = hub.role(channel.server_id, userId);
  const isManager = role === "owner" || role === "admin";
  if (!channel.id.startsWith("dm:") && hub.activeTimeoutUntil(channel.server_id, userId)) {
    throw new HttpError(403, "you are currently timed out in this server");
  }
  if (channel.read_only && !isManager) throw new HttpError(403, "this channel is read-only");
}

/** Updates channel details, category, visibility, read-only, or slowmode (`PATCH /api/channels/{id}`). */
export async function handleUpdateChannel(hub, request, channelId) {
  const actor = hub.authenticate(request);
  if (channelId.startsWith("dm:")) throw new HttpError(400, "cannot edit a direct message channel");
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, actor.id);
  const role = hub.role(channel.server_id, actor.id);
  if (role !== "owner" && role !== "admin") {
    throw new HttpError(403, "only server owners and admins can edit channels");
  }

  const body = await readJson(request);
  if (body.slowmode_seconds !== undefined && body.slowmode_seconds !== null) {
    const secs = Number(body.slowmode_seconds);
    if (!Number.isInteger(secs) || secs < 0 || secs > 21600) {
      throw new HttpError(400, "slowmode must be 0-21600 seconds");
    }
    channel.slowmode_seconds = secs;
  }
  if (typeof body.name === "string") {
    channel.name = channel.kind === "text" ? slug(body.name) : cleanText(body.name, 32, "channel name");
  }
  if (typeof body.topic === "string") {
    channel.topic = [...body.topic.trim()].slice(0, 180).join("");
  }
  if (typeof body.category === "string") {
    const trimmed = [...body.category.trim()].slice(0, 32).join("");
    channel.category = trimmed || null;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "public" && body.visibility !== "admin") {
      throw new HttpError(400, "invalid channel visibility");
    }
    channel.visibility = body.visibility;
  }
  if (typeof body.read_only === "boolean") channel.read_only = body.read_only;

  const visLabel = channel.visibility === "admin" ? "Admin" : "Public";
  const detail = `vis=${visLabel},ro=${Boolean(channel.read_only)},slow=${channel.slowmode_seconds || 0}s`;
  recordAudit(hub, channel.server_id, actor, "channel_update", channel.id, channel.name, detail);
  hub.persistStore();
  hub.emit({ type: "channel_update", server_id: channel.server_id, channel });
  return jsonResponse(channel);
}

/** Lists threads under a channel (`GET /api/channels/{id}/threads`). */
export function handleListThreads(hub, request, channelId) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");

  const views = Object.values(hub.store.threads || {})
    .filter((t) => t.channel_id === channelId)
    .map((t) => buildThreadView(hub, t))
    .sort((a, b) => cmp(b.last_message_at || b.created_at, a.last_message_at || a.created_at));
  return jsonResponse(views);
}

/** Creates a thread in a channel or anchored to a parent message (`POST /api/channels/{id}/threads`). */
export async function handleCreateThread(hub, request, channelId) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  requireWritableText(hub, channel, user.id);

  const body = await readJson(request);
  const title = cleanText(body.title, 80, "thread title");
  const hasContent = typeof body.content === "string" && body.content.trim().length > 0;
  const initialContent = hasContent ? cleanText(body.content, 2000, "message") : null;

  let parentMessageId = null;
  if (typeof body.parent_message_id === "string" && body.parent_message_id.trim()) {
    parentMessageId = body.parent_message_id.trim();
    const exists = (hub.store.messages[channelId] || []).some((m) => m.id === parentMessageId);
    if (!exists) throw new HttpError(404, "message not found");
    const dup = Object.values(hub.store.threads || {}).some((t) => t.parent_message_id === parentMessageId);
    if (dup) throw new HttpError(409, "a thread already exists for this message");
  }

  hub.store.threads = hub.store.threads || {};
  const thread = {
    id: newId(),
    server_id: channel.server_id,
    channel_id: channelId,
    parent_message_id: parentMessageId,
    title,
    created_by: user.id,
    created_at: nowIso(),
  };
  hub.store.threads[thread.id] = thread;

  let firstMsgView = null;
  if (initialContent) {
    const msg = {
      id: newId(),
      channel_id: thread.id,
      author_id: user.id,
      content: initialContent,
      created_at: nowIso(),
      edited_at: null,
      reply_to: null,
      reactions: {},
      attachments: [],
      pinned: false,
    };
    hub.insertMessage(thread.id, msg);
    firstMsgView = hub.messageView(msg, user.id);
  }

  const view = buildThreadView(hub, thread);
  hub.persistStore();
  hub.emit({ type: "thread_create", server_id: view.server_id, thread: view });
  if (firstMsgView) {
    hub.emit({
      type: "thread_message_create",
      server_id: view.server_id,
      thread_id: view.id,
      channel_id: view.channel_id,
      message: firstMsgView,
    });
  }
  return jsonResponse(view);
}

/** Lists messages inside a thread (`GET /api/threads/{id}/messages`). */
export function handleListThreadMessages(hub, request, threadId, url) {
  const user = hub.authenticate(request);
  const thread = hub.store.threads?.[threadId];
  if (!thread) throw new HttpError(404, "thread not found");
  const channel = hub.store.channels[thread.channel_id];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");

  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;
  const list = hub.store.messages[threadId] || [];
  const start = Math.max(0, list.length - limit);
  return jsonResponse(list.slice(start).map((m) => hub.messageView(m, user.id)).filter(Boolean));
}

/** Posts a reply inside a discussion thread (`POST /api/threads/{id}/messages`). */
export async function handlePostThreadMessage(hub, request, threadId) {
  const user = hub.authenticate(request);
  const thread = hub.store.threads?.[threadId];
  if (!thread) throw new HttpError(404, "thread not found");
  const channel = hub.store.channels[thread.channel_id];
  if (!channel) throw new HttpError(404, "channel not found");
  requireWritableText(hub, channel, user.id);

  const body = await readJson(request);
  const attachments = validateAttachments(body.attachments);
  const rawContent = typeof body.content === "string" ? body.content : "";
  let content = "";
  if (!attachments.length || rawContent.trim()) {
    content = cleanText(rawContent, 2000, "message");
  } else if (/[\x00-\x1F\x7F]/.test(rawContent)) {
    throw new HttpError(400, "message cannot contain control characters");
  }

  const msg = {
    id: newId(),
    channel_id: threadId,
    author_id: user.id,
    content,
    created_at: nowIso(),
    edited_at: null,
    reply_to: null,
    reactions: {},
    attachments,
    pinned: false,
  };
  hub.insertMessage(threadId, msg);
  const view = hub.messageView(msg, user.id);
  hub.persistStore();
  hub.emit({
    type: "thread_message_create",
    server_id: channel.server_id,
    thread_id: threadId,
    channel_id: thread.channel_id,
    message: view,
  });
  return jsonResponse(view);
}

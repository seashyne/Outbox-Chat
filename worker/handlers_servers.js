/**
 * Server and channel management handlers for the OutboxHub Durable Object.
 */

import {
  HttpError,
  cleanText,
  cmp,
  jsonResponse,
  newId,
  nowIso,
  publicUser,
  readJson,
  slug,
} from "./utils.js";

/** Lists all servers with membership flags and member counts. */
export function handleListServers(hub, request) {
  const user = hub.authenticate(request);
  const servers = Object.values(hub.store.servers)
    .map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      member_count: Object.keys(hub.store.members[s.id] || {}).length,
      joined: hub.isMember(s.id, user.id),
    }))
    .sort((a, b) => cmp(a.name, b.name));
  return jsonResponse(servers);
}

/** Creates a new server with a default `#general` text channel. */
export async function handleCreateServer(hub, request) {
  const user = hub.authenticate(request);
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

  hub.store.members[server.id] = { [user.id]: "owner" };
  hub.store.channels[general.id] = general;
  hub.store.servers[server.id] = server;
  const view = hub.serverView(user.id, server);

  hub.persistStore();
  hub.emit({ type: "server_create", server });
  return jsonResponse(view);
}

/** Adds the authenticated user as a member of `serverId`. */
export function handleJoinServer(hub, request, serverId) {
  const user = hub.authenticate(request);
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");

  if (!hub.store.members[serverId]) hub.store.members[serverId] = {};
  const joined = !hub.store.members[serverId][user.id];
  if (joined) hub.store.members[serverId][user.id] = "member";

  const view = hub.serverView(user.id, server);
  hub.persistStore();
  if (joined) {
    hub.emit({ type: "member_join", server_id: serverId, user: publicUser(user) });
  }
  return jsonResponse(view);
}

/** Removes a non-owner member from `serverId` and broadcasts `member_leave`. */
export function handleLeaveServer(hub, request, serverId) {
  const user = hub.authenticate(request);
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");
  if (server.owner_id === user.id) {
    throw new HttpError(400, "server owner cannot leave the server");
  }
  if (!hub.isMember(serverId, user.id)) {
    throw new HttpError(400, "you are not a member of this server");
  }

  if (hub.store.members[serverId]) {
    delete hub.store.members[serverId][user.id];
  }
  hub.leaveAllVoice(user.id);

  hub.persistStore();
  hub.emit({ type: "member_leave", server_id: serverId, user_id: user.id });
  return jsonResponse({ success: true, server_id: serverId });
}

/** Creates a text or voice channel inside `serverId`. */
export async function handleCreateChannel(hub, request, serverId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const kind = body.kind === undefined ? "text" : body.kind;
  if (kind !== "text" && kind !== "voice") {
    throw new HttpError(400, "invalid channel kind");
  }

  const name = kind === "text" ? slug(body.name) : cleanText(body.name, 32, "channel name");
  const topic = typeof body.topic === "string" ? [...body.topic.trim()].slice(0, 180).join("") : "";

  if (!hub.store.servers[serverId]) throw new HttpError(404, "server not found");
  hub.requireMember(serverId, user.id);

  const position = Object.values(hub.store.channels).filter(
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
  hub.store.channels[channel.id] = channel;
  hub.persistStore();
  hub.emit({ type: "channel_create", server_id: serverId, channel });
  return jsonResponse(channel);
}

/** Deletes a channel (owner/admin only) and cleans up its messages and voice state. */
export function handleDeleteChannel(hub, request, channelId) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);

  const role = hub.role(channel.server_id, user.id);
  if (role !== "owner" && role !== "admin") {
    throw new HttpError(403, "only server owners and admins can delete channels");
  }

  delete hub.store.channels[channelId];
  delete hub.store.messages[channelId];
  for (const [mId, cId] of hub.messageIndex.entries()) {
    if (cId === channelId) hub.messageIndex.delete(mId);
  }
  delete hub.voice[channelId];

  hub.persistStore();
  hub.persistVoice();
  hub.emit({ type: "channel_delete", server_id: channel.server_id, channel_id: channelId });
  return jsonResponse({ success: true, channel_id: channelId });
}

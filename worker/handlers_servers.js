/**
 * Server and channel management handlers for the OutboxHub Durable Object.
 */

import {
  applyRolesPatch,
  buildTemplateChannels,
  cleanOptionalText,
  defaultRolesConfig,
  resolveTemplate,
  validateColor,
} from "./server_templates.js";
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

/** Lists all servers with membership flags, metadata, and member counts. */
export function handleListServers(hub, request) {
  const user = hub.authenticate(request);
  const servers = Object.values(hub.store.servers)
    .map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      description: s.description || "",
      accent_color: s.accent_color || "#5865f2",
      member_count: Object.keys(hub.store.members[s.id] || {}).length,
      joined: hub.isMember(s.id, user.id),
    }))
    .sort((a, b) => cmp(a.name, b.name));
  return jsonResponse(servers);
}

/** Creates a new server from a starter template with custom metadata and role config. */
export async function handleCreateServer(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const name = cleanText(body.name, 48, "server name");
  const spec = resolveTemplate(body.template);
  const customIcon =
    typeof body.icon === "string" ? [...body.icon.trim()].slice(0, 4).join("") : "";
  const icon = customIcon || [...name][0].toUpperCase();
  const description =
    body.description !== undefined
      ? cleanOptionalText(body.description, 180, "server description")
      : spec.description;
  const accentColor =
    body.accent_color !== undefined
      ? validateColor(body.accent_color, "accent_color")
      : spec.accent_color;
  const rolesConfig = {
    ...defaultRolesConfig(),
    admin_label: spec.admin_label,
    member_label: spec.member_label,
  };
  if (body.roles_config !== undefined) applyRolesPatch(rolesConfig, body.roles_config);

  const server = {
    id: newId(),
    name,
    icon,
    description,
    accent_color: accentColor,
    roles_config: rolesConfig,
    owner_id: user.id,
    created_at: nowIso(),
  };

  hub.store.members[server.id] = { [user.id]: "owner" };
  for (const ch of buildTemplateChannels(server.id, spec)) {
    hub.store.channels[ch.id] = ch;
  }
  hub.store.servers[server.id] = server;
  const view = hub.serverView(user.id, server);

  hub.persistStore();
  hub.emit({ type: "server_create", server });
  return jsonResponse(view);
}

/** Updates server name, icon, description, accent color, or role configuration (owner/admin). */
export async function handleUpdateServer(hub, request, serverId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");
  hub.requireMember(serverId, user.id);

  const role = hub.role(serverId, user.id);
  if (role !== "owner" && role !== "admin") {
    throw new HttpError(403, "only server owners and admins can edit server settings");
  }

  if (body.name !== undefined) server.name = cleanText(body.name, 48, "server name");
  if (body.icon !== undefined) {
    if (typeof body.icon !== "string" || /[\x00-\x1F\x7F]/.test(body.icon)) {
      throw new HttpError(400, "icon must be 1-4 characters");
    }
    const trimmed = [...body.icon.trim()].slice(0, 4).join("");
    if (!trimmed) throw new HttpError(400, "icon must be 1-4 characters");
    server.icon = trimmed;
  }
  if (body.description !== undefined) {
    server.description = cleanOptionalText(body.description, 180, "server description");
  }
  if (body.accent_color !== undefined) {
    server.accent_color = validateColor(body.accent_color, "accent_color");
  }
  if (body.roles_config !== undefined) {
    server.roles_config = server.roles_config || defaultRolesConfig();
    applyRolesPatch(server.roles_config, body.roles_config);
  }

  const view = hub.serverView(user.id, server);
  hub.persistStore();
  hub.emit({ type: "server_update", server });
  return jsonResponse(view);
}

/** Promotes or demotes a non-owner member between `admin` and `member` (owner only). */
export async function handleUpdateMemberRole(hub, request, serverId, targetUserId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  if (body.role !== "admin" && body.role !== "member") {
    throw new HttpError(400, "role must be admin or member");
  }
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");
  if (server.owner_id !== user.id) {
    throw new HttpError(403, "only the server owner can change member roles");
  }
  if (targetUserId === server.owner_id) {
    throw new HttpError(400, "cannot change the server owner role");
  }
  const members = hub.store.members[serverId];
  if (!members || !members[targetUserId]) {
    throw new HttpError(404, "member not found");
  }
  members[targetUserId] = body.role;
  const view = hub.serverView(user.id, server);

  hub.persistStore();
  hub.emit({
    type: "member_role_update",
    server_id: serverId,
    user_id: targetUserId,
    role: body.role,
  });
  return jsonResponse({
    success: true,
    server_id: serverId,
    user_id: targetUserId,
    role: body.role,
    server: view,
  });
}

/** Adds the authenticated user as a member of `serverId`. */
export function handleJoinServer(hub, request, serverId) {
  const user = hub.authenticate(request);
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");
  if (hub.store.bans?.[serverId]?.[user.id]) {
    throw new HttpError(403, "you are banned from this server");
  }

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

  if (hub.store.members[serverId]) delete hub.store.members[serverId][user.id];
  hub.leaveAllVoice(user.id);
  hub.persistStore();
  hub.emit({ type: "member_leave", server_id: serverId, user_id: user.id });
  return jsonResponse({ success: true, server_id: serverId });
}

/** Creates a text or voice channel inside `serverId`, enforcing role creation policy. */
export async function handleCreateChannel(hub, request, serverId) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const kind = body.kind === undefined ? "text" : body.kind;
  if (kind !== "text" && kind !== "voice") throw new HttpError(400, "invalid channel kind");

  const name = kind === "text" ? slug(body.name) : cleanText(body.name, 32, "channel name");
  const topic = typeof body.topic === "string" ? [...body.topic.trim()].slice(0, 180).join("") : "";
  const server = hub.store.servers[serverId];
  if (!server) throw new HttpError(404, "server not found");
  hub.requireMember(serverId, user.id);

  const role = hub.role(serverId, user.id);
  const allowCreate = server.roles_config?.allow_member_create_channel !== false;
  if (role !== "owner" && role !== "admin" && !allowCreate) {
    throw new HttpError(403, "only server owners and admins can create channels");
  }

  const position = Object.values(hub.store.channels).filter(
    (c) => c.server_id === serverId && c.kind === kind
  ).length;
  const rawCategory = typeof body.category === "string" ? [...body.category.trim()].slice(0, 32).join("") : "";
  const channel = {
    id: newId(),
    server_id: serverId,
    name,
    kind,
    topic,
    category: rawCategory || null,
    visibility: "public",
    read_only: false,
    slowmode_seconds: 0,
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

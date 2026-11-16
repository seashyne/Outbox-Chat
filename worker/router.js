/**
 * HTTP REST router and WebSocket Hibernation handlers for OutboxHub.
 */

import {
  handleBootstrap,
  handleGetSettings,
  handleLogin,
  handleLogout,
  handleRegister,
  handleUpdateProfile,
  handleUpdateSettings,
} from "./handlers_auth.js";
import {
  handleCreateChannel,
  handleCreateServer,
  handleDeleteChannel,
  handleJoinServer,
  handleLeaveServer,
  handleListServers,
  handleUpdateMemberRole,
  handleUpdateServer,
} from "./handlers_servers.js";
import {
  handleDeleteMessage,
  handleListMessages,
  handlePostMessage,
  handleToggleReaction,
  handleVoiceJoin,
  handleVoiceLeave,
} from "./handlers_messages.js";
import {
  CORS_HEADERS,
  HttpError,
  cmp,
  defaultSettings,
  jsonResponse,
  publicUser,
} from "./utils.js";

/** Dispatches REST and WebSocket upgrade requests for the Durable Object. */
export async function routeHubRequest(hub, request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (method === "GET" && path === "/api/ws") return handleWsUpgrade(hub, url);
    if (method === "GET" && path === "/api/health") return hub.handleHealth();
    if (method === "POST" && path === "/api/register") return await handleRegister(hub, request);
    if (method === "POST" && path === "/api/login") return await handleLogin(hub, request);
    if (method === "POST" && path === "/api/logout") return handleLogout(hub, request);
    if (method === "GET" && path === "/api/bootstrap") return handleBootstrap(hub, request);
    if (method === "GET" && path === "/api/users/@me/settings") return handleGetSettings(hub, request);
    if (method === "PATCH" && path === "/api/users/@me/settings") return await handleUpdateSettings(hub, request);
    if (method === "PATCH" && path === "/api/users/@me") return await handleUpdateProfile(hub, request);
    if (method === "GET" && path === "/api/servers") return handleListServers(hub, request);
    if (method === "POST" && path === "/api/servers") return await handleCreateServer(hub, request);

    let m;
    if (method === "PATCH" && (m = path.match(/^\/api\/servers\/([^/]+)$/))) {
      return await handleUpdateServer(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "PATCH" && (m = path.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/role$/))) {
      return await handleUpdateMemberRole(
        hub,
        request,
        decodeURIComponent(m[1]),
        decodeURIComponent(m[2])
      );
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/channels$/))) {
      return await handleCreateChannel(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/join$/))) {
      return handleJoinServer(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/leave$/))) {
      return handleLeaveServer(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/channels\/([^/]+)$/))) {
      return handleDeleteChannel(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
      return handleListMessages(hub, request, decodeURIComponent(m[1]), url);
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
      return await handlePostMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/messages\/([^/]+)$/))) {
      return handleDeleteMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/messages\/([^/]+)\/reactions$/))) {
      return await handleToggleReaction(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/voice\/join$/))) {
      return handleVoiceJoin(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/voice\/leave$/))) {
      return handleVoiceLeave(hub, request, decodeURIComponent(m[1]));
    }
    throw new HttpError(404, "route not found");
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message, status: err.status }, err.status);
    console.error("[outbox-hub] internal error:", err);
    return jsonResponse({ error: "internal server error", status: 500 }, 500);
  }
}

/** Authenticates WebSocket token query param and registers socket with hibernation state. */
export function handleWsUpgrade(hub, url) {
  const token = (url.searchParams.get("token") || "").trim();
  const userId = token ? hub.store.tokens[token] : null;
  const user = userId ? hub.store.users[userId] : null;
  if (!user) throw new HttpError(401, "invalid or missing token");

  const [client, server] = Object.values(new WebSocketPair());
  hub.ctx.acceptWebSocket(server);
  server.serializeAttachment({ userId: user.id });

  const online = [...new Set([...hub.onlineIds(), user.id])].sort(cmp);
  server.send(JSON.stringify({ type: "ready", user: publicUser(user), online, heartbeat_interval: 25000 }));
  hub.emit({ type: "presence", online });
  return new Response(null, { status: 101, webSocket: client });
}

/** Handles incoming WebSocket frames (`ping`, `status`, `typing`). */
export function handleWsMessage(hub, ws, raw) {
  const meta = ws.deserializeAttachment();
  const user = meta?.userId ? hub.store.users[meta.userId] : null;
  if (!user) return;

  let payload;
  try {
    payload = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return;
  }

  if (payload?.type === "ping") {
    try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
    return;
  }
  if (payload?.type === "status" && typeof payload.status === "string") {
    const statusVal = payload.status.trim().slice(0, 32);
    if (statusVal) {
      user.settings = user.settings || defaultSettings();
      user.settings.status = statusVal;
      hub.persistStore();
      hub.emit({ type: "user_status", user_id: user.id, status: statusVal });
    }
    return;
  }
  if (payload?.type === "typing" && typeof payload.channel_id === "string") {
    const channel = hub.store.channels[payload.channel_id];
    if (channel && hub.isMember(channel.server_id, user.id)) {
      hub.emit({ type: "typing", server_id: channel.server_id, channel_id: channel.id, user: publicUser(user) });
    }
  }
}

/** Cleans up voice occupancy and broadcasts updated presence on socket disconnect. */
export function handleWsDisconnect(hub, ws) {
  const meta = ws.deserializeAttachment();
  if (!meta?.userId) return;
  const online = hub.onlineIds(ws);
  if (!online.includes(meta.userId)) {
    for (const { serverId, channelId, users } of hub.leaveAllVoice(meta.userId)) {
      hub.emit({ type: "voice_state", server_id: serverId, channel_id: channelId, users }, ws);
    }
  }
  hub.emit({ type: "presence", online }, ws);
}

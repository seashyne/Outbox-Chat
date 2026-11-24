/**
 * HTTP REST router and WebSocket Hibernation handlers for OutboxHub.
 */

import { handleBootstrap, handleGetSettings, handleLogin, handleLogout, handleRegister, handleUpdateProfile, handleUpdateSettings } from "./handlers_auth.js";
import { handleCreateChannel, handleCreateServer, handleDeleteChannel, handleJoinServer, handleLeaveServer, handleListServers, handleUpdateMemberRole, handleUpdateServer } from "./handlers_servers.js";
import { handleCreateSticker, handleDeleteSticker, handleEditMessage, handleListPinnedMessages, handleListStickers, handlePreviewLink, handleSearchServerMessages, handleTogglePinMessage } from "./handlers_chat_ext.js";
import { handleCreateInvite, handleDeleteInvite, handleJoinByInvite, handleListInvites, handlePreviewInvite } from "./handlers_invites.js";
import { handleAcceptFriend, handleListFriends, handleOpenDm, handleRemoveFriend, handleRequestFriend, handleUpdateServerProfile } from "./handlers_friends.js";
import { handleGetFile, handleListChannelMedia, handleUploadFile } from "./handlers_files.js";
import { handleBanMember, handleKickMember, handleListAuditLogs, handleListBans, handleTimeoutMember, handleUnbanMember } from "./handlers_moderation.js";
import { handleCreateThread, handleListThreadMessages, handleListThreads, handlePostThreadMessage, handleUpdateChannel } from "./handlers_threads.js";
import { handleWsUpgrade } from "./ws_gateway.js";
import {
  handleDeleteMessage,
  handleListMessages,
  handlePostMessage,
  handleRtcIce,
  handleToggleReaction,
  handleVoiceJoin,
  handleVoiceLeave,
} from "./handlers_messages.js";
import { CORS_HEADERS, HttpError, jsonResponse } from "./utils.js";

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
    if (method === "PATCH" && (m = path.match(/^\/api\/servers\/([^/]+)\/profile$/))) {
      return await handleUpdateServerProfile(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && path === "/api/friends") return handleListFriends(hub, request);
    if (method === "POST" && path === "/api/friends/request") return await handleRequestFriend(hub, request);
    if (method === "POST" && (m = path.match(/^\/api\/friends\/([^/]+)\/accept$/))) {
      return handleAcceptFriend(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/friends\/([^/]+)$/))) {
      return handleRemoveFriend(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/dm\/([^/]+)$/))) {
      return handleOpenDm(hub, request, decodeURIComponent(m[1]));
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
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/kick$/))) {
      return handleKickMember(hub, request, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/ban$/))) {
      return await handleBanMember(hub, request, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/timeout$/))) {
      return await handleTimeoutMember(hub, request, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/servers\/([^/]+)\/bans$/))) {
      return handleListBans(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/servers\/([^/]+)\/bans\/([^/]+)$/))) {
      return handleUnbanMember(hub, request, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/servers\/([^/]+)\/audit$/))) {
      return handleListAuditLogs(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/join$/))) {
      return handleJoinServer(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/leave$/))) {
      return handleLeaveServer(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/servers\/([^/]+)\/invites$/))) {
      return handleListInvites(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/invites$/))) {
      return await handleCreateInvite(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/invites\/([^/]+)$/))) {
      return handlePreviewInvite(hub, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/invites\/([^/]+)$/))) {
      return handleDeleteInvite(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/invites\/([^/]+)\/join$/))) {
      return handleJoinByInvite(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "PATCH" && (m = path.match(/^\/api\/channels\/([^/]+)$/))) {
      return await handleUpdateChannel(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/channels\/([^/]+)$/))) {
      return handleDeleteChannel(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/channels\/([^/]+)\/media$/))) {
      return handleListChannelMedia(hub, request, decodeURIComponent(m[1]), url);
    }
    if (method === "GET" && (m = path.match(/^\/api\/channels\/([^/]+)\/threads$/))) {
      return handleListThreads(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/threads$/))) {
      return await handleCreateThread(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/threads\/([^/]+)\/messages$/))) {
      return handleListThreadMessages(hub, request, decodeURIComponent(m[1]), url);
    }
    if (method === "POST" && (m = path.match(/^\/api\/threads\/([^/]+)\/messages$/))) {
      return await handlePostThreadMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && path === "/api/files") {
      return await handleUploadFile(hub, request);
    }
    if (method === "GET" && (m = path.match(/^\/api\/files\/([^/]+)$/))) {
      return handleGetFile(hub, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
      return handleListMessages(hub, request, decodeURIComponent(m[1]), url);
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
      return await handlePostMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/channels\/([^/]+)\/pins$/))) {
      return handleListPinnedMessages(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "PATCH" && (m = path.match(/^\/api\/messages\/([^/]+)$/))) {
      return await handleEditMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/messages\/([^/]+)\/pin$/))) {
      return handleTogglePinMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/messages\/([^/]+)$/))) {
      return handleDeleteMessage(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/messages\/([^/]+)\/reactions$/))) {
      return await handleToggleReaction(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && (m = path.match(/^\/api\/servers\/([^/]+)\/search$/))) {
      return handleSearchServerMessages(hub, request, decodeURIComponent(m[1]), url);
    }
    if (method === "GET" && (m = path.match(/^\/api\/servers\/([^/]+)\/stickers$/))) {
      return handleListStickers(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/servers\/([^/]+)\/stickers$/))) {
      return await handleCreateSticker(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/servers\/([^/]+)\/stickers\/([^/]+)$/))) {
      return handleDeleteSticker(hub, request, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (method === "GET" && path === "/api/links/preview") {
      return handlePreviewLink(hub, request, url);
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/voice\/join$/))) {
      return handleVoiceJoin(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/api\/channels\/([^/]+)\/voice\/leave$/))) {
      return handleVoiceLeave(hub, request, decodeURIComponent(m[1]));
    }
    if (method === "GET" && path === "/api/rtc/ice") {
      return await handleRtcIce(hub, request);
    }
    throw new HttpError(404, "route not found");
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message, status: err.status }, err.status);
    console.error("[outbox-hub] internal error:", err);
    return jsonResponse({ error: "internal server error", status: 500 }, 500);
  }
}

/**
 * Moderation handlers for OutboxHub Durable Object:
 * kick, ban/unban, list bans, temporary timeouts, and server audit logs.
 */

import { CORS_HEADERS, HttpError, cmp, jsonResponse, newId, nowIso, publicUser, readJson } from "./utils.js";

/** Appends a moderation/channel admin audit entry (keeps last 200 per server). */
export function recordAudit(hub, serverId, actor, action, targetId, targetName, detail = "") {
  hub.store.audit_logs = hub.store.audit_logs || {};
  const list = hub.store.audit_logs[serverId] || [];
  list.push({
    id: newId(),
    actor_id: actor.id,
    actor_name: actor.display_name,
    action,
    target_id: targetId,
    target_name: targetName,
    detail,
    created_at: nowIso(),
  });
  if (list.length > 200) list.splice(0, list.length - 200);
  hub.store.audit_logs[serverId] = list;
}

function requireManager(hub, serverId, actorId) {
  const srv = hub.store.servers[serverId];
  if (!srv) throw new HttpError(404, "server not found");
  hub.requireMember(serverId, actorId);
  const role = hub.role(serverId, actorId);
  if (role !== "owner" && role !== "admin") {
    throw new HttpError(403, "only server owners and admins can moderate members");
  }
  return { srv, role };
}

function resolveTarget(hub, serverId, actorId, targetId) {
  const { srv, role } = requireManager(hub, serverId, actorId);
  if (targetId === actorId) throw new HttpError(400, "cannot moderate your own account");
  if (targetId === srv.owner_id) throw new HttpError(403, "cannot moderate the server owner");
  const targetRole = hub.role(serverId, targetId);
  if ((targetRole === "owner" || targetRole === "admin") && role !== "owner") {
    throw new HttpError(403, "only the server owner can moderate admins");
  }
  return srv;
}

const displayName = (hub, userId) => hub.store.users[userId]?.display_name || userId;

/** Kicks a member out of a server (`POST /api/servers/{id}/members/{uid}/kick`). */
export function handleKickMember(hub, request, serverId, targetId) {
  const actor = hub.authenticate(request);
  resolveTarget(hub, serverId, actor.id, targetId);
  if (!hub.isMember(serverId, targetId)) throw new HttpError(404, "member not found");
  delete hub.store.members[serverId][targetId];
  if (hub.store.timeouts) delete hub.store.timeouts[`${serverId}:${targetId}`];
  recordAudit(hub, serverId, actor, "member_kick", targetId, displayName(hub, targetId));
  hub.persistStore();
  hub.emit({ type: "member_leave", server_id: serverId, user_id: targetId });
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Bans a user from a server (`POST /api/servers/{id}/members/{uid}/ban`). */
export async function handleBanMember(hub, request, serverId, targetId) {
  const actor = hub.authenticate(request);
  let reason = "";
  try {
    const raw = await request.text();
    if (raw.trim()) {
      const body = JSON.parse(raw);
      if (typeof body?.reason === "string") reason = [...body.reason.trim()].slice(0, 200).join("");
    }
  } catch {
    throw new HttpError(400, "invalid JSON payload");
  }
  resolveTarget(hub, serverId, actor.id, targetId);
  if (!hub.store.users[targetId]) throw new HttpError(404, "user not found");

  const wasMember = Boolean(hub.store.members[serverId]?.[targetId]);
  if (wasMember) delete hub.store.members[serverId][targetId];
  if (hub.store.timeouts) delete hub.store.timeouts[`${serverId}:${targetId}`];

  const ban = { user_id: targetId, banned_by: actor.id, reason, created_at: nowIso() };
  hub.store.bans = hub.store.bans || {};
  hub.store.bans[serverId] = hub.store.bans[serverId] || {};
  hub.store.bans[serverId][targetId] = ban;
  recordAudit(hub, serverId, actor, "member_ban", targetId, displayName(hub, targetId), reason);
  hub.persistStore();
  if (wasMember) hub.emit({ type: "member_leave", server_id: serverId, user_id: targetId });
  return jsonResponse(ban);
}

/** Removes a ban (`DELETE /api/servers/{id}/bans/{uid}`). */
export function handleUnbanMember(hub, request, serverId, targetId) {
  const actor = hub.authenticate(request);
  requireManager(hub, serverId, actor.id);
  if (!hub.store.bans?.[serverId]?.[targetId]) throw new HttpError(404, "ban not found");
  delete hub.store.bans[serverId][targetId];
  recordAudit(hub, serverId, actor, "member_unban", targetId, displayName(hub, targetId));
  hub.persistStore();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Lists banned users in a server (`GET /api/servers/{id}/bans`). */
export function handleListBans(hub, request, serverId) {
  const actor = hub.authenticate(request);
  requireManager(hub, serverId, actor.id);
  const views = Object.values(hub.store.bans?.[serverId] || {})
    .map((ban) => {
      const user = hub.store.users[ban.user_id];
      if (!user) return null;
      const by = hub.store.users[ban.banned_by];
      return {
        user: publicUser(user),
        reason: ban.reason || "",
        banned_by_name: by ? by.display_name : "ผู้ดูแล",
        created_at: ban.created_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => cmp(b.created_at, a.created_at));
  return jsonResponse(views);
}

/** Applies or clears a timeout (`POST /api/servers/{id}/members/{uid}/timeout`). */
export async function handleTimeoutMember(hub, request, serverId, targetId) {
  const actor = hub.authenticate(request);
  const body = await readJson(request);
  const minutes = Number(body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
    throw new HttpError(400, "timeout duration must be 0-10080 minutes");
  }
  resolveTarget(hub, serverId, actor.id, targetId);
  if (!hub.isMember(serverId, targetId)) throw new HttpError(404, "member not found");

  hub.store.timeouts = hub.store.timeouts || {};
  const key = `${serverId}:${targetId}`;
  let until = null;
  if (minutes === 0) {
    delete hub.store.timeouts[key];
  } else {
    until = new Date(Date.now() + minutes * 60000).toISOString();
    hub.store.timeouts[key] = until;
  }
  recordAudit(
    hub,
    serverId,
    actor,
    minutes === 0 ? "member_timeout_clear" : "member_timeout",
    targetId,
    displayName(hub, targetId),
    minutes === 0 ? "cleared" : `${minutes}m`
  );
  hub.persistStore();
  return jsonResponse({ user_id: targetId, timeout_until: until });
}

/** Lists moderation/channel audit logs (`GET /api/servers/{id}/audit`). */
export function handleListAuditLogs(hub, request, serverId) {
  const actor = hub.authenticate(request);
  requireManager(hub, serverId, actor.id);
  const logs = [...(hub.store.audit_logs?.[serverId] || [])].reverse().slice(0, 100);
  return jsonResponse(logs);
}

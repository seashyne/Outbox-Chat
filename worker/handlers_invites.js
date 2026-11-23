/**
 * Server invite link handlers for OutboxHub:
 * create with expiration / max-uses, list, preview, join, and revoke.
 */

import {
  CORS_HEADERS,
  HttpError,
  cmp,
  jsonResponse,
  newId,
  nowIso,
  publicUser,
  readJson,
} from "./utils.js";

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return !Number.isFinite(ts) || ts <= Date.now();
}

function isExhausted(maxUses, uses) {
  return typeof maxUses === "number" && uses >= maxUses;
}

function toView(hub, inv) {
  const creator = hub.store.users[inv.created_by];
  return {
    code: inv.code,
    server_id: inv.server_id,
    created_by: inv.created_by,
    creator_name: creator ? creator.display_name : "สมาชิก",
    created_at: inv.created_at,
    expires_at: inv.expires_at ?? null,
    max_uses: inv.max_uses ?? null,
    uses: inv.uses || 0,
    expired: isExpired(inv.expires_at),
    exhausted: isExhausted(inv.max_uses, inv.uses || 0),
  };
}

/** Lists invite links for a server (members only). */
export function handleListInvites(hub, request, serverId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const views = Object.values(hub.store.invites || {})
    .filter((inv) => inv.server_id === serverId)
    .map((inv) => toView(hub, inv))
    .sort((a, b) => cmp(b.created_at, a.created_at));
  return jsonResponse(views);
}

/** Creates an invite link with optional `expires_in_hours` and `max_uses`. */
export async function handleCreateInvite(hub, request, serverId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const body = await readJson(request);

  let expiresAt = null;
  if (body.expires_in_hours !== undefined && body.expires_in_hours !== null) {
    const hrs = Number(body.expires_in_hours);
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 720) {
      throw new HttpError(400, "invalid invite expiration");
    }
    expiresAt = new Date(Date.now() + Math.round(hrs * 3600 * 1000)).toISOString();
  }

  let maxUses = null;
  if (body.max_uses !== undefined && body.max_uses !== null) {
    const n = Number(body.max_uses);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      throw new HttpError(400, "invalid max_uses");
    }
    maxUses = n;
  }

  const code = newId().slice(0, 8);
  const inv = {
    code,
    server_id: serverId,
    created_by: user.id,
    created_at: nowIso(),
    expires_at: expiresAt,
    max_uses: maxUses,
    uses: 0,
  };
  hub.store.invites = hub.store.invites || {};
  hub.store.invites[code] = inv;
  hub.persistStore();
  return jsonResponse(toView(hub, inv));
}

/** Revokes an invite link (creator, admin, or owner). */
export function handleDeleteInvite(hub, request, code) {
  const user = hub.authenticate(request);
  const inv = hub.store.invites?.[code];
  if (!inv) throw new HttpError(404, "invite not found");
  const role = hub.role(inv.server_id, user.id);
  const canManage = role === "owner" || role === "admin";
  if (inv.created_by !== user.id && !canManage) {
    throw new HttpError(403, "insufficient permissions to revoke invite");
  }
  delete hub.store.invites[code];
  hub.persistStore();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Previews public metadata for an invite code without joining. */
export function handlePreviewInvite(hub, code) {
  const inv = hub.store.invites?.[code];
  if (!inv) throw new HttpError(404, "invite not found");
  const srv = hub.store.servers[inv.server_id];
  if (!srv) throw new HttpError(404, "server not found");
  const memberCount = Object.keys(hub.store.members[srv.id] || {}).length;
  const valid = !isExpired(inv.expires_at) && !isExhausted(inv.max_uses, inv.uses || 0);
  return jsonResponse({
    code: inv.code,
    server_id: srv.id,
    server_name: srv.name,
    server_icon: srv.icon,
    server_description: srv.description || "",
    accent_color: srv.accent_color || "#5865f2",
    member_count: memberCount,
    expires_at: inv.expires_at ?? null,
    max_uses: inv.max_uses ?? null,
    uses: inv.uses || 0,
    valid,
  });
}

/** Redeems an invite code, enforcing expiration and max_uses limits. */
export function handleJoinByInvite(hub, request, code) {
  const user = hub.authenticate(request);
  const inv = hub.store.invites?.[code];
  if (!inv) throw new HttpError(404, "invite not found");
  if (isExpired(inv.expires_at)) throw new HttpError(400, "invite link has expired");
  if (isExhausted(inv.max_uses, inv.uses || 0)) {
    throw new HttpError(400, "invite link has reached max uses");
  }
  const srv = hub.store.servers[inv.server_id];
  if (!srv) throw new HttpError(404, "server not found");

  hub.store.members[srv.id] = hub.store.members[srv.id] || {};
  const already = Boolean(hub.store.members[srv.id][user.id]);
  if (!already) {
    hub.store.members[srv.id][user.id] = "member";
    inv.uses = (inv.uses || 0) + 1;
    hub.persistStore();
    hub.emit({ type: "member_join", server_id: srv.id, user: publicUser(user) });
  }
  return jsonResponse(hub.serverView(user.id, srv));
}

/**
 * Friends, direct messaging (DM), and per-server member profile handlers
 * for the OutboxHub Durable Object.
 */

import { HttpError, cleanText, cmp, jsonResponse, nowIso, publicUser, readJson } from "./utils.js";

/** Validates safe data URL images (PNG/JPEG/WebP up to `maxLen`) or `https://` URLs. */
export function parseImageUrl(raw, maxLen) {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new HttpError(400, "invalid image format or size");
  const s = raw.trim();
  if (!s) return null;
  if (s.length > maxLen || /[\x00-\x1F\x7F<"']/.test(s)) {
    throw new HttpError(400, "invalid image format or size");
  }
  const ok =
    s.startsWith("data:image/png;base64,") ||
    s.startsWith("data:image/jpeg;base64,") ||
    s.startsWith("data:image/webp;base64,") ||
    s.startsWith("https://");
  if (!ok) throw new HttpError(400, "invalid image format or size");
  return s;
}

function cleanOptionalText(raw, max, what) {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new HttpError(400, `${what} cannot contain control characters`);
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if ([...trimmed].length > max) throw new HttpError(400, `${what} must be 0-${max} characters`);
  return trimmed;
}

const pairKey = (a, b) => (a <= b ? `${a}:${b}` : `${b}:${a}`);
const dmChannelId = (a, b) => `dm:${pairKey(a, b)}`;

function ensureDmChannel(hub, a, b) {
  const cid = dmChannelId(a, b);
  if (hub.store.channels[cid]) return hub.store.channels[cid];
  const ch = {
    id: cid,
    server_id: cid,
    name: "แชทส่วนตัว",
    kind: "text",
    topic: "",
    category: null,
    visibility: "public",
    read_only: false,
    slowmode_seconds: 0,
    position: 0,
    created_at: nowIso(),
  };
  hub.store.channels[cid] = ch;
  return ch;
}

function buildFriendsResponse(hub, meId) {
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const edge of Object.values(hub.store.friends || {})) {
    if (edge.from_id !== meId && edge.to_id !== meId) continue;
    const otherId = edge.from_id === meId ? edge.to_id : edge.from_id;
    const other = hub.store.users[otherId];
    if (!other) continue;
    const view = {
      user: publicUser(other),
      status: edge.status,
      direction: edge.status === "accepted" ? "friend" : edge.to_id === meId ? "incoming" : "outgoing",
      dm_channel_id: dmChannelId(meId, otherId),
      created_at: edge.created_at,
    };
    if (edge.status === "accepted") friends.push(view);
    else if (edge.to_id === meId) incoming.push(view);
    else outgoing.push(view);
  }
  friends.sort((a, b) => cmp(a.user.display_name, b.user.display_name));
  return { friends, incoming, outgoing };
}

/** Lists accepted friends and pending requests for the authenticated user. */
export function handleListFriends(hub, request) {
  const user = hub.authenticate(request);
  return jsonResponse(buildFriendsResponse(hub, user.id));
}

/** Sends a friend request by `@username` (auto-accepts mutual pending requests). */
export async function handleRequestFriend(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const raw = typeof body.username === "string" ? body.username.trim().replace(/^@+/, "") : "";
  const clean = cleanText(raw, 32, "username");
  const lower = clean.toLowerCase();
  const target = Object.values(hub.store.users).find(
    (u) => !u.bot && u.username.toLowerCase() === lower
  );
  if (!target) throw new HttpError(404, "user not found");
  if (target.id === user.id) throw new HttpError(400, "cannot add yourself as friend");

  hub.store.friends = hub.store.friends || {};
  const key = pairKey(user.id, target.id);
  const existing = hub.store.friends[key];
  if (existing) {
    if (existing.status === "accepted") throw new HttpError(409, "already friends");
    if (existing.from_id === user.id) throw new HttpError(409, "friend request already sent");
    existing.status = "accepted";
    ensureDmChannel(hub, user.id, target.id);
  } else {
    hub.store.friends[key] = {
      from_id: user.id,
      to_id: target.id,
      status: "pending",
      created_at: nowIso(),
    };
  }
  hub.persistStore();
  hub.emit({ type: "friend_update", to: user.id });
  hub.emit({ type: "friend_update", to: target.id });
  return jsonResponse(buildFriendsResponse(hub, user.id));
}

/** Accepts an incoming pending friend request from `{otherId}`. */
export function handleAcceptFriend(hub, request, otherId) {
  const user = hub.authenticate(request);
  const key = pairKey(user.id, otherId);
  const edge = hub.store.friends?.[key];
  if (!edge) throw new HttpError(404, "friend request not found");
  if (edge.to_id !== user.id || edge.status !== "pending") {
    throw new HttpError(400, "no pending incoming request");
  }
  edge.status = "accepted";
  ensureDmChannel(hub, user.id, otherId);
  hub.persistStore();
  hub.emit({ type: "friend_update", to: user.id });
  hub.emit({ type: "friend_update", to: otherId });
  return jsonResponse(buildFriendsResponse(hub, user.id));
}

/** Removes an accepted friend or cancels/declines a pending request. */
export function handleRemoveFriend(hub, request, otherId) {
  const user = hub.authenticate(request);
  const key = pairKey(user.id, otherId);
  if (!hub.store.friends?.[key]) throw new HttpError(404, "friend not found");
  delete hub.store.friends[key];
  hub.persistStore();
  hub.emit({ type: "friend_update", to: user.id });
  hub.emit({ type: "friend_update", to: otherId });
  return jsonResponse(buildFriendsResponse(hub, user.id));
}

/** Opens or creates a private 1-on-1 DM channel with `{otherId}`. */
export function handleOpenDm(hub, request, otherId) {
  const user = hub.authenticate(request);
  if (otherId === user.id) throw new HttpError(400, "cannot open DM with yourself");
  const other = hub.store.users[otherId];
  if (!other) throw new HttpError(404, "user not found");
  if (other.bot) throw new HttpError(400, "cannot open DM with bot");

  const isFriend = hub.store.friends?.[pairKey(user.id, otherId)]?.status === "accepted";
  const sharesServer = Object.values(hub.store.members || {}).some(
    (m) => Boolean(m?.[user.id] && m?.[otherId])
  );
  if (!isFriend && !sharesServer) {
    throw new HttpError(403, "add friend first to send private messages");
  }
  const channel = ensureDmChannel(hub, user.id, otherId);
  hub.persistStore();
  return jsonResponse({ channel });
}

/** Updates caller's per-server nickname, avatar, banner, or bio for `{serverId}`. */
export async function handleUpdateServerProfile(hub, request, serverId) {
  const user = hub.authenticate(request);
  hub.requireMember(serverId, user.id);
  const body = await readJson(request);
  hub.store.server_profiles = hub.store.server_profiles || {};
  const key = `${serverId}:${user.id}`;
  const cur = { ...(hub.store.server_profiles[key] || { nickname: null, avatar_url: null, banner_url: null, bio: null }) };

  if (body.nickname !== undefined) cur.nickname = cleanOptionalText(body.nickname, 32, "server nickname");
  if (body.avatar_url !== undefined) cur.avatar_url = parseImageUrl(body.avatar_url, 65536);
  if (body.banner_url !== undefined) cur.banner_url = parseImageUrl(body.banner_url, 120000);
  if (body.bio !== undefined) cur.bio = cleanOptionalText(body.bio, 160, "server bio");

  if (!cur.nickname && !cur.avatar_url && !cur.banner_url && !cur.bio) {
    delete hub.store.server_profiles[key];
  } else {
    hub.store.server_profiles[key] = cur;
  }
  hub.persistStore();
  hub.emit({ type: "server_profile_update", server_id: serverId, user_id: user.id, profile: cur });
  return jsonResponse({ profile: cur });
}

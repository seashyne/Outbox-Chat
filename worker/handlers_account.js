/**
 * Account security & lifecycle handlers for OutboxHub Durable Object:
 * `@me` summary, email validation, password change, account deletion, and admin claim.
 */

import { constantTimeEqual, hashPassword, randomSaltHex } from "./crypto.js";
import { CORS_HEADERS, HttpError, accountSummary, cleanPassword, jsonResponse, newToken, publicUser, readJson } from "./utils.js";

/** Validates optional email format cleanly; empty string clears email to `null`. */
export function validateEmail(raw) {
  if (typeof raw !== "string" || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new HttpError(400, "email cannot contain control characters");
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const at = trimmed.indexOf("@");
  const local = at > 0 ? trimmed.slice(0, at) : "";
  const domain = at > 0 ? trimmed.slice(at + 1) : "";
  if ([...trimmed].length > 120 || !local || domain.length < 3 || !domain.includes(".") || domain.includes("@") || /[\s<>'"]/.test(trimmed)) {
    throw new HttpError(400, "invalid email address");
  }
  return trimmed.toLowerCase();
}

/** Returns public profile alongside private account and plan metadata (`GET /api/users/@me`). */
export function handleGetMe(hub, request) {
  const user = hub.authenticate(request);
  return jsonResponse({ user: publicUser(user), account: accountSummary(user) });
}

/** Verifies current password, sets a new PBKDF2 password, and rotates tokens (`POST /api/users/@me/password`). */
export async function handleChangePassword(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const currentPass = typeof body.current_password === "string" ? body.current_password : "";
  const newPass = cleanPassword(body.new_password);
  if (user.bot || !user.password_hash || !user.password_salt) {
    throw new HttpError(403, "current password is incorrect");
  }
  const curHash = await hashPassword(currentPass, user.password_salt);
  if (!constantTimeEqual(curHash, user.password_hash)) {
    throw new HttpError(403, "current password is incorrect");
  }

  const salt = randomSaltHex();
  const nextHash = await hashPassword(newPass, salt);
  const nextToken = newToken();
  for (const [tok, uid] of Object.entries(hub.store.tokens)) {
    if (uid === user.id) delete hub.store.tokens[tok];
  }
  hub.store.tokens[nextToken] = user.id;
  user.password_salt = salt;
  user.password_hash = nextHash;
  user.token = nextToken;
  hub.persistStore();

  return jsonResponse({ token: nextToken, user: publicUser(user), account: accountSummary(user) });
}

/** Permanently deletes the caller's account after password confirmation. */
export async function handleDeleteAccount(hub, request) {
  const user = hub.authenticate(request);
  if (user.bot || user.id === "outbox-bot") {
    throw new HttpError(403, "cannot delete bot account");
  }
  let password = "";
  try {
    const raw = await request.text();
    if (raw.trim()) password = String(JSON.parse(raw)?.password || "");
  } catch {
    throw new HttpError(400, "invalid JSON payload");
  }
  const hash = user.password_salt ? await hashPassword(password, user.password_salt) : "";
  if (!user.password_hash || !constantTimeEqual(hash, user.password_hash)) {
    throw new HttpError(403, "password confirmation is incorrect");
  }

  for (const [tok, uid] of Object.entries(hub.store.tokens)) {
    if (uid === user.id) delete hub.store.tokens[tok];
  }
  for (const [key, edge] of Object.entries(hub.store.friends || {})) {
    if (edge.from_id === user.id || edge.to_id === user.id) delete hub.store.friends[key];
  }

  for (const srv of Object.values(hub.store.servers)) {
    if (srv.owner_id !== user.id) continue;
    const memMap = hub.store.members[srv.id] || {};
    const successor =
      Object.entries(memMap).find(([uid, r]) => uid !== user.id && r === "admin")?.[0] ||
      Object.entries(memMap).find(([uid]) => uid !== user.id)?.[0];
    if (successor) {
      srv.owner_id = successor;
      memMap[successor] = "owner";
    } else {
      delete hub.store.servers[srv.id];
      delete hub.store.members[srv.id];
      for (const ch of Object.values(hub.store.channels)) {
        if (ch.server_id !== srv.id) continue;
        delete hub.store.channels[ch.id];
        for (const m of hub.store.messages[ch.id] || []) hub.messageIndex.delete(m.id);
        delete hub.store.messages[ch.id];
      }
    }
  }

  const leaveEvents = [];
  for (const [sid, memMap] of Object.entries(hub.store.members)) {
    if (memMap[user.id]) {
      delete memMap[user.id];
      leaveEvents.push({ type: "member_leave", server_id: sid, user_id: user.id });
    }
  }
  for (const bans of Object.values(hub.store.bans || {})) delete bans[user.id];
  for (const k of Object.keys(hub.store.timeouts || {})) {
    if (k.endsWith(`:${user.id}`)) delete hub.store.timeouts[k];
  }

  hub.leaveAllVoice(user.id);
  delete hub.store.users[user.id];
  hub.persistStore();
  for (const ev of leaveEvents) hub.emit(ev);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Promotes authenticated user to platform admin when `ADMIN_CLAIM_SECRET` matches. */
export async function handleClaimPlatformAdmin(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const expected = String(hub.env?.ADMIN_CLAIM_SECRET || "").trim();
  const given = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!expected || !constantTimeEqual(given, expected)) {
    throw new HttpError(403, "invalid admin claim secret");
  }
  user.platform_admin = true;
  hub.persistStore();
  return jsonResponse({ user: publicUser(user), account: accountSummary(user) });
}

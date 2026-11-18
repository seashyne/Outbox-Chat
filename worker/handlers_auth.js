/**
 * Authentication, bootstrap, user profile, and user settings handlers
 * for the OutboxHub Durable Object.
 */

import { constantTimeEqual, hashPassword, randomSaltHex, utf8Length } from "./crypto.js";
import { parseImageUrl } from "./handlers_friends.js";
import {
  AVATAR_COLORS,
  HttpError,
  cleanPassword,
  cleanText,
  cmp,
  defaultSettings,
  isValidHexColor,
  jsonResponse,
  newId,
  newToken,
  nowIso,
  publicUser,
  readJson,
} from "./utils.js";

const ALLOWED_THEMES = ["dark", "light", "slate", "forest", "midnight", "amber", "custom"];
const ALLOWED_PALETTE_KEYS = ["brand", "sidebar", "chat"];
const ALLOWED_LANGUAGES = ["auto", "th", "en", "ja", "zh", "ko", "es", "fr", "de"];

/** Registers a new user account and hashes credentials with PBKDF2-HMAC-SHA256. */
export async function handleRegister(hub, request) {
  const body = await readJson(request);
  const username = cleanText(body.username, 32, "username");
  const password = cleanPassword(body.password);
  const lowered = username.toLowerCase();
  const taken = Object.values(hub.store.users).some((u) => u.username.toLowerCase() === lowered);
  if (taken) throw new HttpError(409, "username is already taken");

  const salt = randomSaltHex();
  const passwordHash = await hashPassword(password, salt);
  const token = newToken();
  const user = {
    id: newId(),
    username,
    display_name: username,
    color: AVATAR_COLORS[utf8Length(username) % AVATAR_COLORS.length],
    avatar_url: null,
    banner_url: null,
    bio: "",
    status_text: "",
    token,
    bot: false,
    created_at: nowIso(),
    password_hash: passwordHash,
    password_salt: salt,
    settings: defaultSettings(),
  };

  hub.store.tokens[token] = user.id;
  hub.store.users[user.id] = user;

  let joinedDemo = false;
  if (hub.store.members.demo) {
    hub.store.members.demo[user.id] = "member";
    joinedDemo = true;
  }

  hub.persistStore();
  if (joinedDemo) {
    hub.emit({ type: "member_join", server_id: "demo", user: publicUser(user) });
  }
  return jsonResponse({ token, user: publicUser(user) });
}

/** Authenticates user credentials and issues a new 64-hex session token. */
export async function handleLogin(hub, request) {
  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) throw new HttpError(401, "invalid username or password");

  const lowered = username.toLowerCase();
  const user = Object.values(hub.store.users).find((u) => u.username.toLowerCase() === lowered);
  if (!user || user.bot || !user.password_hash || !user.password_salt) {
    throw new HttpError(401, "invalid username or password");
  }

  const computedHash = await hashPassword(password, user.password_salt);
  if (!constantTimeEqual(computedHash, user.password_hash)) {
    throw new HttpError(401, "invalid username or password");
  }

  const token = newToken();
  hub.store.tokens[token] = user.id;
  user.token = token;
  hub.persistStore();
  return jsonResponse({ token, user: publicUser(user) });
}

/** Revokes the caller's bearer token. */
export function handleLogout(hub, request) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token && hub.store.tokens[token]) {
    delete hub.store.tokens[token];
    hub.persistStore();
  }
  return jsonResponse({ status: "ok" });
}

/** Returns initial user bootstrap payload (identity, settings, servers, channels, members). */
export function handleBootstrap(hub, request) {
  const currentUser = hub.authenticate(request);
  const me = publicUser(currentUser);
  const settings = { ...defaultSettings(), ...(currentUser.settings || {}) };
  const mine = Object.values(hub.store.servers)
    .filter((s) => hub.isMember(s.id, me.id))
    .sort((a, b) => cmp(a.created_at, b.created_at));

  const servers = mine.map((s) => hub.serverView(me.id, s));
  const default_server_id = servers[0]?.id ?? null;
  const default_channel_id = servers[0]?.channels.find((c) => c.kind === "text")?.id ?? null;

  const channelsMap = {};
  const membersMap = {};
  for (const s of servers) {
    channelsMap[s.id] = s.channels;
    const sMembers = [];
    for (const [uId, role] of Object.entries(hub.store.members[s.id] || {})) {
      const u = hub.store.users[uId];
      if (u) {
        sMembers.push({
          id: u.id,
          user_id: u.id,
          username: u.username,
          display_name: u.display_name,
          color: u.color,
          avatar_url: u.avatar_url || null,
          banner_url: u.banner_url || null,
          bio: u.bio || "",
          status_text: u.status_text || "",
          bot: Boolean(u.bot),
          role: role || "member",
        });
      }
    }
    sMembers.sort((a, b) => cmp(a.display_name, b.display_name));
    membersMap[s.id] = sMembers;
  }

  return jsonResponse({
    me,
    settings,
    servers,
    channels: channelsMap,
    members: membersMap,
    online: hub.onlineIds(),
    voice: hub.voiceSnapshot(),
    default_server_id,
    default_channel_id,
  });
}

/** Returns persisted settings for the authenticated user. */
export function handleGetSettings(hub, request) {
  const user = hub.authenticate(request);
  return jsonResponse({ settings: { ...defaultSettings(), ...(user.settings || {}) } });
}

/** Applies validated partial updates to theme preset, custom colors, status, or language. */
export async function handleUpdateSettings(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  user.settings = { ...defaultSettings(), ...(user.settings || {}) };

  const theme = body.settings?.theme ?? body.theme;
  const customColors = body.settings?.custom_colors ?? body.custom_colors;
  const status = body.settings?.status ?? body.status;
  const language = body.settings?.language ?? body.language;

  if (theme !== undefined) {
    if (typeof theme !== "string" || /[\x00-\x1F\x7F]/.test(theme)) {
      throw new HttpError(400, "theme cannot contain control characters");
    }
    if (!ALLOWED_THEMES.includes(theme.trim())) {
      throw new HttpError(400, "unsupported theme preset");
    }
    user.settings.theme = theme.trim();
  }
  if (customColors !== undefined) {
    if (typeof customColors !== "object" || customColors === null || Array.isArray(customColors)) {
      throw new HttpError(400, "custom_colors must be an object");
    }
    user.settings.custom_colors = user.settings.custom_colors || {};
    for (const [k, v] of Object.entries(customColors)) {
      if (ALLOWED_PALETTE_KEYS.includes(k)) {
        if (!isValidHexColor(v)) throw new HttpError(400, `invalid hex color for ${k}`);
        user.settings.custom_colors[k] = v.trim();
      }
    }
  }
  let statusChanged = false;
  if (typeof status === "string") {
    if (/[\x00-\x1F\x7F]/.test(status)) {
      throw new HttpError(400, "status cannot contain control characters");
    }
    const s = status.trim();
    if (s && s.length <= 32) {
      user.settings.status = s;
      statusChanged = true;
    }
  }
  if (language !== undefined) {
    if (typeof language !== "string" || /[\x00-\x1F\x7F]/.test(language)) {
      throw new HttpError(400, "language cannot contain control characters");
    }
    const normalizedLang = language.trim().toLowerCase();
    if (!ALLOWED_LANGUAGES.includes(normalizedLang)) {
      throw new HttpError(400, "unsupported language");
    }
    user.settings.language = normalizedLang;
  }

  hub.persistStore();
  if (statusChanged) {
    hub.emit({ type: "user_status", user_id: user.id, status: user.settings.status });
  }
  return jsonResponse({ settings: user.settings });
}

function validateHandle(raw) {
  if (typeof raw !== "string") throw new HttpError(400, "username handle must be 2-32 non-space characters");
  const trimmed = raw.trim().replace(/^@+/, "");
  const len = [...trimmed].length;
  if (len < 2 || len > 32 || /[\x00-\x1F\x7F\s@<>"']/.test(trimmed)) {
    throw new HttpError(400, "username handle must be 2-32 non-space characters");
  }
  if (trimmed.toLowerCase() === "outbox-bot") {
    throw new HttpError(409, "username is reserved");
  }
  return trimmed;
}

function cleanProfileText(raw, max, what) {
  if (typeof raw !== "string" || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new HttpError(400, `${what} cannot contain control characters`);
  }
  const trimmed = raw.trim();
  if ([...trimmed].length > max) throw new HttpError(400, `${what} must be 0-${max} characters`);
  return trimmed;
}

/** Updates handle, display_name, color, avatar, banner, bio, or status_text. */
export async function handleUpdateProfile(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);

  if (body.username !== undefined) {
    const handle = validateHandle(body.username);
    const lower = handle.toLowerCase();
    const taken = Object.values(hub.store.users).some(
      (u) => u.id !== user.id && u.username.toLowerCase() === lower
    );
    if (taken) throw new HttpError(409, "username is already taken");
    user.username = handle;
  }
  if (body.display_name !== undefined) {
    user.display_name = cleanText(body.display_name, 32, "display name");
  }
  if (body.color !== undefined) {
    if (!isValidHexColor(body.color)) {
      throw new HttpError(400, "invalid profile avatar color");
    }
    user.color = body.color.trim();
  }
  if (body.avatar_url !== undefined) user.avatar_url = parseImageUrl(body.avatar_url, 65536);
  if (body.banner_url !== undefined) user.banner_url = parseImageUrl(body.banner_url, 120000);
  if (body.bio !== undefined) user.bio = cleanProfileText(body.bio, 160, "bio");
  if (body.status_text !== undefined) user.status_text = cleanProfileText(body.status_text, 60, "status text");

  hub.persistStore();
  hub.emit({ type: "user_update", user: publicUser(user) });
  return jsonResponse({ user: publicUser(user) });
}

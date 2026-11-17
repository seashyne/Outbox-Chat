/**
 * Shared constants, validation helpers, and HTTP response utilities
 * for the Outbox Chat Cloudflare Workers backend.
 */

export const AVATAR_COLORS = [
  "#5865f2",
  "#eb459e",
  "#ed4245",
  "#faa61a",
  "#23a559",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
];

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** HTTP error carrying an explicit status code for Worker JSON error responses. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const newId = () => crypto.randomUUID().replace(/-/g, "");
export const newToken = () => `${newId()}${newId()}`;
export const nowIso = () => new Date().toISOString();

export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Projects non-sensitive user fields safe for REST and WebSocket payloads. */
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    color: user.color,
    avatar_url: user.avatar_url || null,
    bot: Boolean(user.bot),
  };
}

/** Validates and trims text fields, rejecting control characters and out-of-bounds lengths. */
export function cleanText(raw, max, what) {
  if (typeof raw !== "string") {
    throw new HttpError(400, `${what} must be 1-${max} characters`);
  }
  if (/[\x00-\x1F\x7F]/.test(raw)) {
    throw new HttpError(400, `${what} cannot contain control characters`);
  }
  const value = raw.trim();
  const len = [...value].length;
  if (len === 0 || len > max) {
    throw new HttpError(400, `${what} must be 1-${max} characters`);
  }
  return value;
}

/** Validates password length (8-128 characters). */
export function cleanPassword(raw) {
  if (typeof raw !== "string") {
    throw new HttpError(400, "password must be 8-128 characters");
  }
  const len = [...raw].length;
  if (len < 8 || len > 128) {
    throw new HttpError(400, "password must be 8-128 characters");
  }
  return raw;
}

const SLUG_CHAR_RE = /^[\p{L}\p{N}\u0E31-\u0E3A\u0E47-\u0E4E_]$/u;

/** Normalizes text channel names into lowercase hyphenated slugs (supports Thai marks). */
export function slug(raw) {
  if (typeof raw !== "string") {
    throw new HttpError(400, "channel name must be 1-32 letters, digits, '-' or '_'");
  }
  let value = "";
  let prevDash = false;
  for (const ch of raw.trim().toLowerCase()) {
    if (SLUG_CHAR_RE.test(ch)) {
      value += ch;
      prevDash = false;
    } else if (!prevDash && value.length > 0) {
      value += "-";
      prevDash = true;
    }
  }
  value = value.replace(/^-+|-+$/g, "");
  const len = [...value].length;
  if (len === 0 || len > 32) {
    throw new HttpError(400, "channel name must be 1-32 letters, digits, '-' or '_'");
  }
  return value;
}

/** Returns default per-user appearance and presence settings. */
export function defaultSettings() {
  return {
    theme: "dark",
    custom_colors: {},
    status: "online",
  };
}

/** Validates 3-digit or 6-digit hex color strings (#RGB or #RRGGBB). */
export function isValidHexColor(s) {
  if (typeof s !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

/** Creates a JSON Response with CORS headers. */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/** Parses a JSON request body and guarantees an object payload. */
export async function readJson(request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new HttpError(400, "invalid JSON payload");
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "invalid JSON payload");
  }
}

/** Determines the server scope of an event for membership-filtered WS fan-out. */
export function eventServerId(event) {
  if (
    event.type === "presence" ||
    event.type === "user_update" ||
    event.type === "user_status"
  ) {
    return null;
  }
  if (event.type === "server_create" || event.type === "server_update") return event.server.id;
  return event.server_id || null;
}

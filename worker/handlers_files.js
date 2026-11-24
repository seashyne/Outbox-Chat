/**
 * Binary file upload (up to 5 MB, chunked into 512 KB SQLite BLOBs), streaming,
 * attachment validation, and channel media gallery handlers for OutboxHub.
 */

import { CORS_HEADERS, HttpError, cleanText, jsonResponse, newId, nowIso } from "./utils.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;

export const ALLOWED_MIMES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf", "text/plain", "application/zip", "application/json",
]);

export function isValidFileId(id) {
  return typeof id === "string" && id.length >= 8 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);
}

/** Validates up to 4 inline base64 or `/api/files/{id}` attachments per message. */
export function validateAttachments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "invalid attachments payload");
  if (raw.length > 4) throw new HttpError(400, "maximum 4 attachments per message");
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new HttpError(400, "invalid attachment entry");
    const mime = String(item.mime || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) throw new HttpError(400, `unsupported file type: ${mime}`);
    const name = cleanText(item.name, 80, "attachment name");
    if (name.includes("/") || name.includes("\\")) throw new HttpError(400, "invalid attachment filename");
    const data = typeof item.data_url === "string" ? item.data_url.trim() : "";

    let size = 0;
    if (data.startsWith("/api/files/")) {
      const fileId = data.slice("/api/files/".length);
      if (!isValidFileId(fileId)) throw new HttpError(400, "invalid attachment file url");
      const declared = Number.isFinite(Number(item.size)) ? Number(item.size) : 0;
      if (declared < 0 || declared > MAX_UPLOAD_BYTES) {
        throw new HttpError(400, "attachment exceeds 5 MB limit");
      }
      size = declared;
    } else {
      const prefix = `data:${mime};base64,`;
      if (!data.startsWith(prefix) || data.length > 620000 || /[\x00-\x20<"]/.test(data)) {
        throw new HttpError(400, "invalid or oversized attachment data");
      }
      const approxBytes = Math.floor(((data.length - prefix.length) * 3) / 4);
      if (approxBytes > 460000) throw new HttpError(400, "attachment exceeds 450 KB limit");
      const givenSize = Number.isFinite(Number(item.size)) ? Number(item.size) : approxBytes;
      size = Math.min(Math.max(givenSize, 0), 460000);
    }

    out.push({ id: newId(), name, mime, size, data_url: data });
  }
  return out;
}

function ensureBlobTables(hub) {
  if (hub._blobTablesReady) return;
  hub.ctx.storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS blobs_meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, uploader_id TEXT NOT NULL, created_at TEXT NOT NULL)"
  );
  hub.ctx.storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS blobs_chunks (file_id TEXT NOT NULL, chunk_idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file_id, chunk_idx))"
  );
  hub._blobTablesReady = true;
}

function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sanitizeAsciiFilename(name) {
  const cleaned = [...name].map((c) => (/^[A-Za-z0-9._ -]$/.test(c) ? c : "_")).join("").trim();
  return cleaned || "attachment";
}

/** Uploads a binary attachment (up to 5 MB) into DO SQLite chunked blob tables. */
export async function handleUploadFile(hub, request) {
  const user = hub.authenticate(request);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, "file must be between 1 byte and 5 MB");
  }
  const mime = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) throw new HttpError(400, `unsupported file type: ${mime}`);

  const rawHeader = request.headers.get("x-file-name");
  const rawName = rawHeader ? safeDecode(rawHeader) : "attachment";
  const name = cleanText(rawName, 80, "attachment name");
  if (name.includes("/") || name.includes("\\")) throw new HttpError(400, "invalid attachment filename");

  ensureBlobTables(hub);
  const id = newId();
  hub.ctx.storage.sql.exec(
    "INSERT INTO blobs_meta (id, name, mime, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    name,
    mime,
    bytes.byteLength,
    user.id,
    nowIso()
  );
  for (let offset = 0, idx = 0; offset < bytes.byteLength; offset += CHUNK_BYTES, idx++) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength));
    hub.ctx.storage.sql.exec("INSERT INTO blobs_chunks (file_id, chunk_idx, data) VALUES (?, ?, ?)", id, idx, slice);
  }
  return jsonResponse({ id, name, mime, size: bytes.byteLength, url: `/api/files/${id}` });
}

/** Streams a previously uploaded binary attachment by ID. */
export function handleGetFile(hub, fileId) {
  if (!isValidFileId(fileId)) throw new HttpError(404, "file not found");
  ensureBlobTables(hub);
  const metaRows = hub.ctx.storage.sql.exec("SELECT name, mime, size FROM blobs_meta WHERE id = ?", fileId).toArray();
  if (!metaRows.length) throw new HttpError(404, "file not found");
  const meta = metaRows[0];

  const chunkRows = hub.ctx.storage.sql
    .exec("SELECT data FROM blobs_chunks WHERE file_id = ? ORDER BY chunk_idx ASC", fileId)
    .toArray();
  const out = new Uint8Array(Number(meta.size) || 0);
  let cursor = 0;
  for (const row of chunkRows) {
    const part = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data.buffer || row.data);
    out.set(part, cursor);
    cursor += part.byteLength;
  }

  return new Response(out.subarray(0, cursor), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": String(meta.mime),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${sanitizeAsciiFilename(String(meta.name))}"`,
    },
  });
}

/** Lists attachments posted in a channel (`GET /api/channels/{id}/media`), newest first. */
export function handleListChannelMedia(hub, request, channelId, url) {
  const user = hub.authenticate(request);
  const channel = hub.store.channels[channelId];
  if (!channel) throw new HttpError(404, "channel not found");
  hub.requireMember(channel.server_id, user.id);
  if (!hub.canViewChannel(channel, user.id)) throw new HttpError(403, "you cannot access this channel");
  if (channel.kind !== "text") return jsonResponse([]);

  const kind = url.searchParams.get("kind") || "all";
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "80", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 150) : 80;

  const items = [];
  const messages = hub.store.messages[channelId] || [];
  outer: for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const author = hub.store.users[msg.author_id];
    const authorName = author ? author.display_name : "สมาชิก";
    for (const att of msg.attachments || []) {
      const isMedia = att.mime.startsWith("image/") || att.mime.startsWith("video/");
      const isAudio = att.mime.startsWith("audio/");
      const keep = kind === "media" ? isMedia : kind === "audio" ? isAudio : kind === "file" ? !isMedia && !isAudio : true;
      if (!keep) continue;
      items.push({ message_id: msg.id, channel_id: msg.channel_id, author_name: authorName, created_at: msg.created_at, attachment: att });
      if (items.length >= limit) break outer;
    }
  }
  return jsonResponse(items);
}

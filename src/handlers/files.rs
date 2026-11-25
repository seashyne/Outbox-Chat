//! Binary file upload, streaming, and channel media gallery handlers.

use super::{clean_text, require_member, Auth};
use crate::error::{ApiError, ApiResult};
use crate::model::{new_id, now, Attachment, AttachmentInput, ChannelKind, MediaGalleryItem, PRO_UPLOAD_BYTES};
use crate::state::AppState;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

pub(crate) const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;

const ALLOWED_MIMES: &[&str] = &[
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac",
    "video/mp4", "video/webm", "video/quicktime",
    "application/pdf", "text/plain", "application/zip", "application/json",
];

#[derive(Debug, Serialize, Deserialize)]
struct BlobMeta {
    id: String,
    name: String,
    mime: String,
    size: usize,
    uploader_id: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: usize,
    pub url: String,
}

pub(crate) fn is_allowed_mime(base_mime: &str) -> bool {
    ALLOWED_MIMES.contains(&base_mime)
}

pub(crate) fn validate_attachments(raw: &[AttachmentInput]) -> ApiResult<Vec<Attachment>> {
    if raw.len() > 4 {
        return Err(ApiError::BadRequest("maximum 4 attachments per message".into()));
    }
    let mut out = Vec::with_capacity(raw.len());
    for item in raw {
        let mime = item.mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if !is_allowed_mime(&mime) {
            return Err(ApiError::BadRequest(format!("unsupported file type: {mime}")));
        }
        let name = clean_text(&item.name, 80, "attachment name")?;
        if name.contains('/') || name.contains('\\') {
            return Err(ApiError::BadRequest("invalid attachment filename".into()));
        }
        let data = item.data_url.trim();
        let size = if let Some(file_id) = data.strip_prefix("/api/files/") {
            if !is_valid_file_id(file_id) {
                return Err(ApiError::BadRequest("invalid attachment file url".into()));
            }
            let declared = item.size.unwrap_or(0);
            if declared > PRO_UPLOAD_BYTES {
                return Err(ApiError::BadRequest("attachment exceeds maximum plan limit".into()));
            }
            declared
        } else {
            let prefix = format!("data:{mime};base64,");
            if !data.starts_with(&prefix)
                || data.len() > 620_000
                || data.chars().any(|c| c.is_control() || c.is_whitespace() || c == '<' || c == '"')
            {
                return Err(ApiError::BadRequest("invalid or oversized attachment data".into()));
            }
            let approx_bytes = ((data.len() - prefix.len()) * 3) / 4;
            if approx_bytes > 460_000 {
                return Err(ApiError::BadRequest("attachment exceeds 450 KB limit".into()));
            }
            item.size.unwrap_or(approx_bytes).min(460_000)
        };
        out.push(Attachment { id: new_id(), name, mime, size, data_url: data.to_string() });
    }
    Ok(out)
}

fn blobs_dir(data_path: &FsPath) -> PathBuf {
    data_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| FsPath::new("."))
        .join("blobs")
}

pub(crate) fn is_valid_file_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn sanitize_ascii_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "attachment".into() } else { trimmed.into() }
}

/// Uploads a binary attachment (up to 5 MB) for audio voice notes, video clips, and files.
pub async fn upload_file(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<UploadResponse>> {
    let max_bytes = state
        .store
        .read()
        .map(|s| s.max_upload_bytes_for(&user.id))
        .unwrap_or(MAX_UPLOAD_BYTES);
    if body.is_empty() || body.len() > max_bytes {
        let mb = max_bytes / (1024 * 1024);
        return Err(ApiError::BadRequest(format!("file must be between 1 byte and {mb} MB")));
    }
    let raw_mime = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    let mime = raw_mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if !is_allowed_mime(&mime) {
        return Err(ApiError::BadRequest(format!("unsupported file type: {mime}")));
    }
    let raw_name = headers
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "attachment".into());
    let name = clean_text(&raw_name, 80, "attachment name")?;
    if name.contains('/') || name.contains('\\') {
        return Err(ApiError::BadRequest("invalid attachment filename".into()));
    }

    let id = new_id();
    let dir = blobs_dir(&state.data_path);
    fs::create_dir_all(&dir).map_err(|_| ApiError::Internal)?;
    let meta = BlobMeta { id: id.clone(), name: name.clone(), mime: mime.clone(), size: body.len(), uploader_id: user.id, created_at: now() };
    let meta_json = serde_json::to_vec(&meta).map_err(|_| ApiError::Internal)?;
    fs::write(dir.join(&id), &body).map_err(|_| ApiError::Internal)?;
    fs::write(dir.join(format!("{id}.json")), meta_json).map_err(|_| ApiError::Internal)?;

    Ok(Json(UploadResponse { id: id.clone(), name, mime, size: body.len(), url: format!("/api/files/{id}") }))
}

/// Streams a previously uploaded binary attachment by its unguessable ID.
pub async fn get_file(State(state): State<Arc<AppState>>, Path(file_id): Path<String>) -> ApiResult<Response> {
    if !is_valid_file_id(&file_id) {
        return Err(ApiError::NotFound("file"));
    }
    let dir = blobs_dir(&state.data_path);
    let meta_bytes = fs::read(dir.join(format!("{file_id}.json"))).map_err(|_| ApiError::NotFound("file"))?;
    let meta: BlobMeta = serde_json::from_slice(&meta_bytes).map_err(|_| ApiError::NotFound("file"))?;
    let payload = fs::read(dir.join(&file_id)).map_err(|_| ApiError::NotFound("file"))?;
    let safe_name = sanitize_ascii_filename(&meta.name);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, meta.mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::CONTENT_DISPOSITION, format!("inline; filename=\"{safe_name}\""))
        .body(Body::from(payload))
        .map_err(|_| ApiError::Internal)
}

#[derive(Debug, Deserialize)]
pub struct MediaQuery {
    pub kind: Option<String>,
    pub limit: Option<usize>,
}

/// Lists attachments posted in a channel (`GET /api/channels/{id}/media`), newest first.
pub async fn list_channel_media(
    State(state): State<Arc<AppState>>,
    Auth(user): Auth,
    Path(channel_id): Path<String>,
    Query(query): Query<MediaQuery>,
) -> ApiResult<Json<Vec<MediaGalleryItem>>> {
    let limit = query.limit.unwrap_or(80).clamp(1, 150);
    let kind = query.kind.as_deref().unwrap_or("all");
    let store = state.store.read().map_err(|_| ApiError::Internal)?;
    let channel = store.channel(&channel_id).ok_or(ApiError::NotFound("channel"))?;
    require_member(&store, &channel.server_id, &user.id)?;
    if !store.can_view_channel(channel, &user.id) {
        return Err(ApiError::Forbidden("you cannot access this channel"));
    }
    if channel.kind != ChannelKind::Text {
        return Ok(Json(Vec::new()));
    }

    let mut items = Vec::new();
    if let Some(messages) = store.messages.get(&channel_id) {
        'outer: for msg in messages.iter().rev() {
            let author_name = store.users.get(&msg.author_id).map(|u| u.display_name.clone()).unwrap_or_else(|| "สมาชิก".into());
            for att in &msg.attachments {
                let is_media = att.mime.starts_with("image/") || att.mime.starts_with("video/");
                let is_audio = att.mime.starts_with("audio/");
                let keep = match kind {
                    "media" => is_media,
                    "audio" => is_audio,
                    "file" => !is_media && !is_audio,
                    _ => true,
                };
                if !keep {
                    continue;
                }
                items.push(MediaGalleryItem {
                    message_id: msg.id.clone(),
                    channel_id: msg.channel_id.clone(),
                    author_name: author_name.clone(),
                    created_at: msg.created_at.clone(),
                    attachment: att.clone(),
                });
                if items.len() >= limit {
                    break 'outer;
                }
            }
        }
    }
    Ok(Json(items))
}

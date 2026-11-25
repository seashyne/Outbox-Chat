/**
 * Composer file & image attachment queue, image resize/compression,
 * and message stream attachment rendering (clickable image zoom + file download).
 */

import { toast } from './api.js';
import { t } from './i18n.js';
import { resolveMediaUrl, uploadBinaryAttachment } from './media_gallery.js';
import { openModal } from './modals.js';
import { resizeImageFile } from './profile_helpers.js';
import { $, ICONS, escapeHtml, state } from './state.js';

const MAX_FILES = 4;
const MAX_INLINE_BYTES = 360000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'text/plain', 'application/zip', 'application/json',
];

let pending = [];

/** Returns the current pending attachment list for outgoing message payloads. */
export function getPendingAttachments() {
  return pending;
}

/** Clears queued attachments and refreshes the composer preview bar & send button. */
export function clearPendingAttachments() {
  pending = [];
  renderPendingAttachments();
}

function fmtSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function normalizeMime(file) {
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_MIMES.includes(mime)) return mime;
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return mime;
}

/** Processes selected/pasted/dropped files into compact data URLs or 5 MB binary uploads. */
export async function addAttachmentFiles(fileList) {
  const files = [...(fileList || [])];
  for (const file of files) {
    if (pending.length >= MAX_FILES) {
      toast(t('chat.attachMax'), 'err');
      break;
    }
    const mime = normalizeMime(file);
    if (!ALLOWED_MIMES.includes(mime)) {
      toast(t('chat.attachBadType'), 'err');
      continue;
    }
    if (file.size > (state.account?.max_upload_bytes || MAX_UPLOAD_BYTES)) {
      const mb = Math.round((state.account?.max_upload_bytes || MAX_UPLOAD_BYTES) / (1024 * 1024));
      toast(t('chat.attachTooBigDynamic', { mb }), 'err');
      continue;
    }
    try {
      let dataUrl;
      let outMime = mime;
      let outSize = file.size || 0;
      if ((mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') && file.size <= MAX_INLINE_BYTES) {
        dataUrl = await resizeImageFile(file, 1280, 1280, MAX_INLINE_BYTES);
        const match = dataUrl.match(/^data:([^;]+);base64,/);
        if (match) outMime = match[1];
        outSize = Math.min(file.size || Math.floor(dataUrl.length * 0.75), MAX_INLINE_BYTES);
      } else if (!mime.startsWith('audio/') && !mime.startsWith('video/') && file.size <= MAX_INLINE_BYTES) {
        dataUrl = await readAsDataUrl(file);
      } else {
        toast(t('att.uploading'));
        const uploaded = await uploadBinaryAttachment(file, (file.name || 'file').slice(0, 80));
        dataUrl = uploaded.url;
        outMime = uploaded.mime || mime;
        outSize = uploaded.size || file.size;
      }
      pending.push({
        name: (file.name || 'file').slice(0, 80),
        mime: outMime,
        size: outSize,
        data_url: dataUrl,
      });
    } catch {
      toast(t('chat.attachFailed'), 'err');
    }
  }
  renderPendingAttachments();
  const input = $('messageInput');
  const sendBtn = $('sendBtn');
  if (sendBtn && input) sendBtn.disabled = !input.value.trim() && pending.length === 0;
}

/** Renders pending attachment preview chips above the composer. */
export function renderPendingAttachments() {
  const box = $('pendingAttachments');
  if (!box) return;
  if (!pending.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = pending.map((att, idx) => {
    const isImg = att.mime.startsWith('image/');
    const src = resolveMediaUrl(att.data_url);
    return `<div class="att-chip">
      ${isImg ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(att.name)}" />` : `<span class="att-file-ico">${ICONS.file}</span>`}
      <span class="att-chip-meta"><b>${escapeHtml(att.name)}</b><small>${fmtSize(att.size)}</small></span>
      <button type="button" class="att-chip-rm" data-rm-att="${idx}" aria-label="${escapeHtml(t('common.close'))}">${ICONS.close}</button>
    </div>`;
  }).join('');
}

/** Removes a pending attachment by index. */
export function removePendingAttachment(idx) {
  pending.splice(idx, 1);
  renderPendingAttachments();
  const input = $('messageInput');
  const sendBtn = $('sendBtn');
  if (sendBtn && input) sendBtn.disabled = !input.value.trim() && pending.length === 0;
}

/** Renders image previews, audio/video players, and downloadable file cards inside a message bubble. */
export function renderMessageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return '';
  return `<div class="msg-attachments">${attachments.map((att) => {
    const raw = String(att.data_url || '');
    const safe = (raw.startsWith('data:') || raw.startsWith('/api/files/')) && !/[<"'\x00-\x1F\x7F]/.test(raw);
    if (!safe) return '';
    const url = resolveMediaUrl(raw);
    const mime = String(att.mime || '');
    if (mime.startsWith('image/')) {
      return `<button type="button" class="att-img-btn" data-action="preview-attachment" data-url="${escapeHtml(url)}" data-name="${escapeHtml(att.name)}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(att.name)}" loading="lazy" />
      </button>`;
    }
    if (mime.startsWith('audio/')) {
      return `<div class="att-audio-card">
        <div class="att-audio-meta"><span>${ICONS.mic} <b>${escapeHtml(att.name)}</b></span><small>${fmtSize(att.size)}</small></div>
        <audio controls loading="lazy" preload="metadata" src="${escapeHtml(url)}"></audio>
      </div>`;
    }
    if (mime.startsWith('video/')) {
      return `<div class="att-video-card">
        <video controls loading="lazy" preload="metadata" width="360" height="202" src="${escapeHtml(url)}"></video>
        <div class="att-media-foot"><span>${escapeHtml(att.name)} · ${fmtSize(att.size)}</span>
          <a href="${escapeHtml(url)}" download="${escapeHtml(att.name)}" target="_blank" rel="noopener">${escapeHtml(t('chat.downloadFile'))}</a>
        </div>
      </div>`;
    }
    return `<a class="att-file-card" href="${escapeHtml(url)}" download="${escapeHtml(att.name)}" target="_blank" rel="noopener">
      ${ICONS.file}<span><b>${escapeHtml(att.name)}</b><small>${fmtSize(att.size)}</small></span>
    </a>`;
  }).join('')}</div>`;
}

/** Opens a large image lightbox preview when clicking an image attachment. */
export function openAttachmentPreview(url, name) {
  const safeUrl = resolveMediaUrl(url);
  if (!safeUrl || !(safeUrl.startsWith('data:image/') || safeUrl.includes('/api/files/'))) return;
  openModal({
    title: name || t('chat.imagePreview'),
    desc: '',
    wide: true,
    hideSubmit: true,
    html: `<div style="text-align:center"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:68vh;border-radius:10px" /></div>
           <div style="margin-top:10px;text-align:right"><a class="primary-btn" style="display:inline-flex;width:auto;text-decoration:none;padding:8px 16px" href="${escapeHtml(url)}" download="${escapeHtml(name || 'image')}">${escapeHtml(t('chat.downloadFile'))}</a></div>`,
  });
}

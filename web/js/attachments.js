/**
 * Composer file & image attachment queue, image resize/compression,
 * and message stream attachment rendering (clickable image zoom + file download).
 */

import { toast } from './api.js';
import { t } from './i18n.js';
import { openModal } from './modals.js';
import { resizeImageFile } from './profile_helpers.js';
import { $, ICONS, escapeHtml } from './state.js';

const MAX_FILES = 4;
const MAX_RAW_BYTES = 450000;
const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
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
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIMES.includes(mime)) return mime;
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.zip')) return 'application/zip';
  return mime;
}

/** Processes selected/pasted/dropped files into compact data URLs ready for upload. */
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
    try {
      let dataUrl;
      let outMime = mime;
      if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') {
        dataUrl = await resizeImageFile(file, 1280, 1280, 360000);
        const match = dataUrl.match(/^data:([^;]+);base64,/);
        if (match) outMime = match[1];
      } else {
        if (file.size > MAX_RAW_BYTES) {
          toast(t('chat.attachTooBig'), 'err');
          continue;
        }
        dataUrl = await readAsDataUrl(file);
      }
      pending.push({
        name: (file.name || 'file').slice(0, 80),
        mime: outMime,
        size: Math.min(file.size || Math.floor(dataUrl.length * 0.75), 460000),
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
    return `<div class="att-chip">
      ${isImg ? `<img src="${escapeHtml(att.data_url)}" alt="${escapeHtml(att.name)}" />` : `<span class="att-file-ico">${ICONS.file}</span>`}
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

/** Renders image previews and downloadable file cards inside a message bubble. */
export function renderMessageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return '';
  return `<div class="msg-attachments">${attachments.map((att) => {
    const url = String(att.data_url || '');
    const safe = url.startsWith('data:') && !/[<"'\x00-\x1F\x7F]/.test(url);
    if (!safe) return '';
    if (String(att.mime || '').startsWith('image/')) {
      return `<button type="button" class="att-img-btn" data-action="preview-attachment" data-url="${escapeHtml(url)}" data-name="${escapeHtml(att.name)}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(att.name)}" loading="lazy" />
      </button>`;
    }
    return `<a class="att-file-card" href="${escapeHtml(url)}" download="${escapeHtml(att.name)}">
      ${ICONS.file}<span><b>${escapeHtml(att.name)}</b><small>${fmtSize(att.size)}</small></span>
    </a>`;
  }).join('')}</div>`;
}

/** Opens a large image lightbox preview when clicking an image attachment. */
export function openAttachmentPreview(url, name) {
  if (!url || !url.startsWith('data:image/')) return;
  openModal({
    title: name || t('chat.imagePreview'),
    desc: '',
    wide: true,
    hideSubmit: true,
    html: `<div style="text-align:center"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:68vh;border-radius:10px" /></div>
           <div style="margin-top:10px;text-align:right"><a class="primary-btn" style="display:inline-flex;width:auto;text-decoration:none;padding:8px 16px" href="${escapeHtml(url)}" download="${escapeHtml(name || 'image')}">${escapeHtml(t('chat.downloadFile'))}</a></div>`,
  });
}

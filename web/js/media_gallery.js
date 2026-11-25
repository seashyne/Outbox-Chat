/**
 * Binary media upload helper (`POST /api/files`, up to 5 MB), media URL resolver,
 * and Channel Media / Audio / Files Gallery dialog.
 */

import { api, handleError } from './api.js';
import { API_ORIGIN, apiUrl } from './config.js';
import { t, translateApiError } from './i18n.js';
import { openInspector } from './inspector_ui.js';
import { $, ICONS, currentChannel, escapeHtml, fmtFull, state } from './state.js';

/** Resolves relative `/api/files/...` paths against `API_ORIGIN` for split-domain deployment. */
export function resolveMediaUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (s.startsWith('/api/')) return `${API_ORIGIN}${s}`;
  return s;
}

/** Uploads a binary `File` or `Blob` up to 5 MB via `POST /api/files`. */
export async function uploadBinaryAttachment(fileOrBlob, filename = 'attachment') {
  const mime = String(fileOrBlob.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const res = await fetch(apiUrl('/files'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': mime,
      'X-File-Name': encodeURIComponent(filename),
    },
    body: fileOrBlob,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ? translateApiError(payload.error) : t('error.requestFailed'));
  }
  return res.json();
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderGalleryItems(items) {
  if (!items.length) return `<p class="gal-empty">${escapeHtml(t('gallery.empty'))}</p>`;
  return `<div class="gallery-grid">${items.map((item) => {
    const att = item.attachment;
    const src = resolveMediaUrl(att.data_url);
    const meta = `${escapeHtml(item.author_name)} · ${escapeHtml(fmtFull(item.created_at))}`;
    if (att.mime.startsWith('image/')) {
      return `
        <div class="gal-card">
          <button type="button" class="gal-thumb-btn" data-gal-preview="${escapeHtml(src)}" data-gal-name="${escapeHtml(att.name)}">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(att.name)}" loading="lazy" />
          </button>
          <div class="gal-meta"><b>${escapeHtml(att.name)}</b><small>${meta}</small></div>
        </div>`;
    }
    if (att.mime.startsWith('video/')) {
      return `
        <div class="gal-card">
          <video controls loading="lazy" preload="metadata" width="240" height="135" src="${escapeHtml(src)}"></video>
          <div class="gal-meta"><b>${escapeHtml(att.name)}</b><small>${meta}</small></div>
        </div>`;
    }
    if (att.mime.startsWith('audio/')) {
      return `
        <div class="gal-card gal-card-wide">
          <div class="gal-meta"><b>${ICONS.mic} ${escapeHtml(att.name)}</b><small>${meta} · ${fmtSize(att.size)}</small></div>
          <audio controls loading="lazy" preload="metadata" src="${escapeHtml(src)}"></audio>
        </div>`;
    }
    return `
      <a class="gal-card gal-file" href="${escapeHtml(src)}" download="${escapeHtml(att.name)}" target="_blank" rel="noopener">
        <span class="att-file-ico">${ICONS.file}</span>
        <div class="gal-meta"><b>${escapeHtml(att.name)}</b><small>${fmtSize(att.size)} · ${meta}</small></div>
      </a>`;
  }).join('')}</div>`;
}

/** Opens the Channel Media & Files Gallery modal (`all | media | audio | file`). */
export async function openChannelMediaModal() {
  const ch = currentChannel();
  if (!ch || ch.kind !== 'text') return;
  let activeKind = 'all';

  const loadKind = async (kind) => {
    const container = $('galItemsWrap');
    if (container) container.innerHTML = `<p class="gal-empty">${escapeHtml(t('gallery.loading'))}</p>`;
    try {
      const items = await api(`/channels/${encodeURIComponent(ch.id)}/media?kind=${encodeURIComponent(kind)}`);
      if ($('galItemsWrap')) $('galItemsWrap').innerHTML = renderGalleryItems(items);
    } catch (err) {
      handleError(err);
    }
  };

  openInspector({
    title: t('gallery.title', { name: ch.name }),
    subtitle: t('gallery.desc'),
    html: `
      <div class="friends-tabs" id="galTabs" style="margin-bottom:8px">
        <button type="button" class="ftab active" data-gal-kind="all">${escapeHtml(t('gallery.tabAll'))}</button>
        <button type="button" class="ftab" data-gal-kind="media">${escapeHtml(t('gallery.tabMedia'))}</button>
        <button type="button" class="ftab" data-gal-kind="audio">${escapeHtml(t('gallery.tabAudio'))}</button>
        <button type="button" class="ftab" data-gal-kind="file">${escapeHtml(t('gallery.tabFiles'))}</button>
      </div>
      <div id="galItemsWrap" class="gal-scroll"></div>`,
  });

  $('galTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gal-kind]');
    if (!btn) return;
    activeKind = btn.dataset.galKind;
    $('galTabs').querySelectorAll('.ftab').forEach((b) => b.classList.toggle('active', b.dataset.galKind === activeKind));
    loadKind(activeKind);
  });

  $('galItemsWrap')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gal-preview]');
    if (!btn) return;
    import('./attachments.js').then((mod) => {
      mod.openAttachmentPreview(btn.dataset.galPreview, btn.dataset.galName);
    }).catch(() => {});
  });

  await loadKind(activeKind);
}

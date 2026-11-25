/**
 * Phase 1 rich chat features: message editing, message pinning & pin drawer,
 * cross-channel server search, automatic URL link previews, and custom server stickers.
 */

import { appendMessage, selectChannel } from './actions.js';
import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { closeInspector, openInspector } from './inspector_ui.js';
import { closeModal, openModal } from './modals.js';
import { resizeImageFile } from './profile_helpers.js';
import { renderMessages, scrollToBottom } from './render_chat.js';
import { $, ICONS, currentChannel, currentServer, escapeHtml, fmtTime, state } from './state.js';

const linkCache = new Map();

/** Built-in graphic sticker stamps (pure SVG->PNG data URLs, zero unicode emojis). */
const DEFAULT_STICKERS = [
  { id: 'def-ok', name: 'OK', color: '#23a559', label: 'OK' },
  { id: 'def-gg', name: 'GG', color: '#5865f2', label: 'GG' },
  { id: 'def-thx', name: 'THX', color: '#eb459e', label: 'THX' },
  { id: 'def-go', name: 'GO', color: '#faa61a', label: 'GO!' },
];

function makeStampDataUrl(label, bg) {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(12, 12, 136, 136, 28); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 80, 82);
  return c.toDataURL('image/png');
}

function jumpAndFlash(msgId) {
  const el = document.querySelector(`.msg[data-id="${msgId}"]`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
}

/** Updates a message inside both active `state.messages` and `state.messageCache`. */
export function applyUpdatedMessage(updated) {
  if (!updated?.id) return;
  const cached = state.messageCache.get(updated.channel_id);
  if (cached) {
    const cIdx = cached.findIndex((m) => m.id === updated.id);
    if (cIdx !== -1) cached[cIdx] = updated;
  }
  const idx = state.messages.findIndex((m) => m.id === updated.id);
  if (idx !== -1) {
    state.messages[idx] = updated;
    renderMessages();
  }
}

/** Opens a modal to edit the author's own sent message (`PATCH /api/messages/{id}`). */
export function openEditMessageModal(messageId) {
  const msg = state.messages.find((m) => m.id === messageId);
  if (!msg) return;
  openModal({
    title: t('chat.editModalTitle'),
    desc: '',
    submitText: t('common.save'),
    html: `<label for="f_edit_msg">${escapeHtml(t('chat.editMessage'))}</label>
           <textarea id="f_edit_msg" rows="3" maxlength="2000" style="width:100%;border-radius:8px;padding:8px 10px;background:var(--input);color:var(--text);border:1px solid var(--border)">${escapeHtml(msg.content)}</textarea>`,
    onSubmit: async () => {
      const content = $('f_edit_msg').value.trim();
      if (!content) throw new Error(t('error.requestFailed'));
      const updated = await api(`/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      });
      applyUpdatedMessage(updated);
      toast(t('chat.editSavedToast'), 'ok');
    },
  });
}

/** Toggles pinned status on a message (`POST /api/messages/{id}/pin`). */
export async function togglePinMessage(messageId) {
  try {
    const updated = await api(`/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST' });
    applyUpdatedMessage(updated);
    toast(updated.pinned ? t('chat.pinnedToast') : t('chat.unpinnedToast'), 'ok');
  } catch (error) { handleError(error); }
}

/** Opens Pinned Messages in the right-side Inspector Panel for the current channel or DM. */
export async function openPinnedMessagesModal() {
  const ch = currentChannel();
  if (!ch) return;
  openInspector({
    title: t('chat.pinsTitle'),
    subtitle: t('chat.pinsDesc'),
    html: `<div id="pinsListBox"></div>`,
  });
  const box = $('pinsListBox');
  const renderList = async () => {
    const pins = await api(`/channels/${encodeURIComponent(ch.id)}/pins`);
    if (!pins.length) {
      box.innerHTML = `<div class="channel-empty" style="padding:20px 8px">${escapeHtml(t('chat.pinsEmpty'))}</div>`;
      return;
    }
    box.innerHTML = pins.map((m) => `
      <div class="friend-card" style="margin-top:8px;align-items:flex-start">
        <div class="fc-meta" style="white-space:normal">
          <b>${escapeHtml(m.author.display_name)} <span>· ${fmtTime(m.created_at)}</span></b>
          <div style="font-size:13px;margin-top:4px;word-break:break-word">${escapeHtml(m.content || t('chat.attachFileMenu'))}</div>
        </div>
        <div class="fc-actions">
          <button type="button" class="mt-btn join" data-pin-goto="${escapeHtml(m.id)}">${escapeHtml(t('chat.jumpToMsg'))}</button>
          <button type="button" class="mt-btn" data-pin-unpin="${escapeHtml(m.id)}">${escapeHtml(t('chat.unpinBtn'))}</button>
        </div>
      </div>`).join('');
  };
  try { await renderList(); } catch (err) { box.textContent = err.message; }
  box?.addEventListener('click', async (e) => {
    const gotoBtn = e.target.closest('[data-pin-goto]');
    if (gotoBtn) { jumpAndFlash(gotoBtn.dataset.pinGoto); return; }
    const unpinBtn = e.target.closest('[data-pin-unpin]');
    if (unpinBtn) { await togglePinMessage(unpinBtn.dataset.pinUnpin); await renderList(); }
  });
}

/** Opens Cross-Channel Server Search in the right-side Inspector Panel. */
export function openServerSearchModal() {
  const srv = currentServer();
  if (!srv) return;
  openInspector({
    title: t('chat.serverSearchTitle'),
    subtitle: t('chat.serverSearchDesc', { name: srv.name }),
    html: `
      <form id="srvSearchForm" style="display:flex;gap:8px">
        <input id="srvSearchInput" type="text" placeholder="${escapeHtml(t('chat.serverSearchPh'))}" style="flex:1" />
        <button type="submit" class="primary-btn" style="width:auto;min-width:76px;margin:0">${escapeHtml(t('chat.serverSearchBtn'))}</button>
      </form>
      <div id="srvSearchResults" style="margin-top:8px"></div>`,
  });
  const resBox = $('srvSearchResults');
  $('srvSearchForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('srvSearchInput').value.trim();
    if (!q) return;
    try {
      const hits = await api(`/servers/${encodeURIComponent(srv.id)}/search?q=${encodeURIComponent(q)}`);
      if (!hits.length) {
        resBox.innerHTML = `<div class="channel-empty" style="padding:20px 8px">${escapeHtml(t('chat.serverSearchEmpty'))}</div>`;
        return;
      }
      resBox.innerHTML = hits.map((m) => {
        const chName = srv.channels.find((c) => c.id === m.channel_id)?.name || 'channel';
        return `<div class="friend-card" style="margin-top:8px;cursor:pointer" data-hit-ch="${escapeHtml(m.channel_id)}" data-hit-id="${escapeHtml(m.id)}">
          <div class="fc-meta" style="white-space:normal">
            <b>#${escapeHtml(chName)} · ${escapeHtml(m.author.display_name)} <span>${fmtTime(m.created_at)}</span></b>
            <div style="font-size:13px;margin-top:3px;word-break:break-word">${escapeHtml(m.content)}</div>
          </div>
        </div>`;
      }).join('');
    } catch (error) { handleError(error); }
  });
  resBox?.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-hit-ch]');
    if (!row) return;
    if (window.innerWidth <= 980) closeInspector(false);
    await selectChannel(row.dataset.hitCh);
    jumpAndFlash(row.dataset.hitId);
  });
}

/** Opens the Server Sticker Picker & custom sticker uploader modal. */
export async function openStickerPickerModal() {
  const srv = currentServer();
  const ch = currentChannel();
  if (!ch || ch.kind !== 'text') return;
  openModal({
    title: t('chat.stickersTitle'),
    desc: t('chat.stickersDesc'),
    hideSubmit: true,
    wide: true,
    html: `
      <div class="sticker-grid" id="stickerGridBox"></div>
      ${srv ? `<div style="display:flex;gap:8px;margin-top:12px;align-items:center">
        <input id="stickerNameInput" type="text" maxlength="24" placeholder="${escapeHtml(t('chat.stickerNamePh'))}" style="flex:1" />
        <input id="stickerFileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        <button type="button" class="primary-btn" id="stickerUploadBtn" style="width:auto;margin:0">${escapeHtml(t('chat.stickerUploadBtn'))}</button>
      </div>` : ''}`,
  });
  const grid = $('stickerGridBox');
  const drawGrid = () => {
    const custom = srv?.stickers || [];
    const builtInHtml = DEFAULT_STICKERS.map((s) => {
      const url = makeStampDataUrl(s.label, s.color);
      return `<button type="button" class="sticker-tile" data-send-sticker="${escapeHtml(url)}" data-sticker-name="${escapeHtml(s.name)}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(s.name)}" /><span>${escapeHtml(s.name)}</span>
      </button>`;
    }).join('');
    const customHtml = custom.map((s) => `
      <div class="sticker-tile-wrap">
        <button type="button" class="sticker-tile" data-send-sticker="${escapeHtml(s.data_url)}" data-sticker-name="${escapeHtml(s.name)}">
          <img src="${escapeHtml(s.data_url)}" alt="${escapeHtml(s.name)}" /><span>${escapeHtml(s.name)}</span>
        </button>
        <button type="button" class="sticker-del" data-del-sticker="${escapeHtml(s.id)}" title="${escapeHtml(t('common.delete'))}">${ICONS.close}</button>
      </div>`).join('');
    grid.innerHTML = builtInHtml + customHtml;
  };
  drawGrid();

  grid?.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-sticker]');
    if (del && srv) {
      try {
        await api(`/servers/${encodeURIComponent(srv.id)}/stickers/${encodeURIComponent(del.dataset.delSticker)}`, { method: 'DELETE' });
        srv.stickers = (srv.stickers || []).filter((s) => s.id !== del.dataset.delSticker);
        toast(t('chat.stickerDeletedToast'));
        drawGrid();
      } catch (error) { handleError(error); }
      return;
    }
    const btn = e.target.closest('[data-send-sticker]');
    if (!btn) return;
    closeModal();
    try {
      const msg = await api(`/channels/${encodeURIComponent(ch.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: '',
          attachments: [{ name: `${btn.dataset.stickerName}.png`, mime: 'image/png', size: 1024, data_url: btn.dataset.sendSticker }],
        }),
      });
      appendMessage(msg);
      scrollToBottom();
    } catch (error) { handleError(error); }
  });

  $('stickerUploadBtn')?.addEventListener('click', () => $('stickerFileInput')?.click());
  $('stickerFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !srv) return;
    const name = ($('stickerNameInput')?.value.trim() || file.name.replace(/\.[^.]+$/, '') || 'sticker').slice(0, 24);
    try {
      const dataUrl = await resizeImageFile(file, 160, 160, 62000);
      const created = await api(`/servers/${encodeURIComponent(srv.id)}/stickers`, {
        method: 'POST',
        body: JSON.stringify({ name, data_url: dataUrl }),
      });
      srv.stickers = srv.stickers || [];
      srv.stickers.push(created);
      if ($('stickerNameInput')) $('stickerNameInput').value = '';
      toast(t('chat.stickerAddedToast'), 'ok');
      drawGrid();
    } catch (error) { handleError(error); }
  });
}

/** Extracts HTTP(S) URLs from message text and renders rich link preview placeholders. */
export function renderLinkPreviews(rawContent) {
  const matches = String(rawContent || '').match(/https?:\/\/[^\s<"]+/g);
  if (!matches?.length) return '';
  const unique = [...new Set(matches)].slice(0, 2);
  return `<div class="msg-link-previews">${unique.map((url) => {
    const cached = linkCache.get(url);
    if (cached) return formatLinkCard(cached);
    return `<div class="link-preview-card" data-preview-url="${escapeHtml(url)}">
      <div class="lp-meta"><small>${escapeHtml(url)}</small></div>
    </div>`;
  }).join('')}</div>`;
}

function formatLinkCard(meta) {
  return `<a class="link-preview-card" href="${escapeHtml(meta.url)}" target="_blank" rel="noopener noreferrer">
    ${meta.image ? `<img class="lp-thumb" src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.title)}" loading="lazy" />` : ''}
    <div class="lp-meta">
      <span class="lp-domain">${escapeHtml(meta.domain)}</span>
      <b>${escapeHtml(meta.title)}</b>
      <small>${escapeHtml(meta.description)}</small>
    </div>
  </a>`;
}

/** Hydrates uncached `.link-preview-card[data-preview-url]` nodes via `/api/links/preview`. */
export function hydrateLinkPreviews() {
  document.querySelectorAll('.link-preview-card[data-preview-url]').forEach(async (node) => {
    const url = node.dataset.previewUrl;
    if (!url) return;
    node.removeAttribute('data-preview-url');
    try {
      const meta = linkCache.get(url) || await api(`/links/preview?url=${encodeURIComponent(url)}`);
      if (meta?.domain) {
        linkCache.set(url, meta);
        node.outerHTML = formatLinkCard(meta);
      }
    } catch {}
  });
}

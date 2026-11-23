/**
 * Server invite links UI: create invites with expiration & max-use limits,
 * copy shareable URLs, revoke old invites, and redeem `?invite=<code>` links.
 */

import { selectServer } from './actions.js';
import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { closeModal, openModal } from './modals.js';
import { renderRail } from './render_shell.js';
import { $, currentServer, escapeHtml, state } from './state.js';

const INVITE_SESSION_KEY = 'ob_pending_invite';

function inviteShareUrl(code) {
  return `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
}

function formatInviteRows(list) {
  if (!list.length) {
    return `<div class="channel-empty" style="padding:14px 6px">${escapeHtml(t('invite.none'))}</div>`;
  }
  return list.map((inv) => {
    const usesText = inv.max_uses
      ? t('invite.usesLimited', { uses: inv.uses, max: inv.max_uses })
      : t('invite.usesUnlimited', { uses: inv.uses });
    const expText = inv.expired
      ? t('invite.expired')
      : inv.expires_at
        ? t('invite.expiresOn', { date: new Date(inv.expires_at).toLocaleString() })
        : t('invite.neverExpires');
    const bad = inv.expired || inv.exhausted;
    return `<div class="friend-card" style="padding:8px 10px;margin-top:8px">
      <div class="fc-meta">
        <b>${escapeHtml(inv.code)} ${bad ? `<span style="color:var(--red)">(${escapeHtml(inv.exhausted ? t('invite.full') : t('invite.expired'))})</span>` : ''}</b>
        <small>${escapeHtml(usesText)} · ${escapeHtml(expText)}</small>
      </div>
      <div class="fc-actions">
        <button type="button" class="mt-btn join" data-inv-copy="${escapeHtml(inv.code)}">${escapeHtml(t('invite.copyBtn'))}</button>
        <button type="button" class="mt-btn" data-inv-del="${escapeHtml(inv.code)}">${escapeHtml(t('common.delete'))}</button>
      </div>
    </div>`;
  }).join('');
}

async function refreshInviteList(serverId) {
  const listEl = $('inviteListBox');
  if (!listEl) return;
  try {
    const list = await api(`/servers/${encodeURIComponent(serverId)}/invites`);
    listEl.innerHTML = formatInviteRows(list);
  } catch (err) {
    listEl.textContent = err.message || t('error.requestFailed');
  }
}

/** Opens a modal to create, copy, and manage invite links for `serverId`. */
export async function openInviteModal(serverId = state.currentServerId) {
  const srv = state.servers.find((s) => s.id === serverId) || currentServer();
  if (!srv) { toast(t('modal.selectServerFirst'), 'err'); return; }
  openModal({
    title: t('invite.modalTitle', { name: srv.name }),
    desc: t('invite.modalDesc'),
    hideSubmit: true,
    wide: true,
    html: `
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
        <div>
          <label for="invExpiry">${escapeHtml(t('invite.expiryLabel'))}</label>
          <select id="invExpiry">
            <option value="0.5">${escapeHtml(t('invite.exp30m'))}</option>
            <option value="24" selected>${escapeHtml(t('invite.exp24h'))}</option>
            <option value="168">${escapeHtml(t('invite.exp7d'))}</option>
            <option value="">${escapeHtml(t('invite.expNever'))}</option>
          </select>
        </div>
        <div>
          <label for="invMaxUses">${escapeHtml(t('invite.maxUsesLabel'))}</label>
          <select id="invMaxUses">
            <option value="">${escapeHtml(t('invite.usesAny'))}</option>
            <option value="1">1</option>
            <option value="5">5</option>
            <option value="25">25</option>
          </select>
        </div>
        <button type="button" class="primary-btn" id="invCreateBtn" style="width:auto;min-width:110px;margin:0">${escapeHtml(t('invite.createBtn'))}</button>
      </div>
      <div id="inviteListBox" style="margin-top:14px;max-height:240px;overflow-y:auto"></div>`,
  });

  await refreshInviteList(srv.id);
  $('invCreateBtn')?.addEventListener('click', async () => {
    const expRaw = $('invExpiry').value;
    const maxRaw = $('invMaxUses').value;
    try {
      const created = await api(`/servers/${encodeURIComponent(srv.id)}/invites`, {
        method: 'POST',
        body: JSON.stringify({
          expires_in_hours: expRaw ? Number(expRaw) : null,
          max_uses: maxRaw ? Number(maxRaw) : null,
        }),
      });
      navigator.clipboard?.writeText(inviteShareUrl(created.code)).catch(() => {});
      toast(t('invite.createdToast'), 'ok');
      await refreshInviteList(srv.id);
    } catch (error) { handleError(error); }
  });
  $('inviteListBox')?.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-inv-copy]');
    if (cp) {
      navigator.clipboard?.writeText(inviteShareUrl(cp.dataset.invCopy))
        .then(() => toast(t('invite.copiedToast'), 'ok'))
        .catch(() => toast(inviteShareUrl(cp.dataset.invCopy), 'ok'));
      return;
    }
    const del = e.target.closest('[data-inv-del]');
    if (del) {
      try {
        await api(`/invites/${encodeURIComponent(del.dataset.invDel)}`, { method: 'DELETE' });
        toast(t('invite.revokedToast'));
        await refreshInviteList(srv.id);
      } catch (error) { handleError(error); }
    }
  });
}

/** Captures `?invite=<code>` from URL into sessionStorage before auth or boot. */
export function captureInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('invite')?.trim();
  if (code) {
    sessionStorage.setItem(INVITE_SESSION_KEY, code);
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/** Redeems a pending invite code captured from `?invite=...` or manual input. */
export async function redeemInviteCode(code) {
  const clean = String(code || '').trim().replace(/^.*invite=/i, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) return;
  try {
    const view = await api(`/invites/${encodeURIComponent(clean)}/join`, { method: 'POST' });
    const idx = state.servers.findIndex((s) => s.id === view.id);
    if (idx === -1) state.servers.push(view); else state.servers[idx] = view;
    renderRail();
    await selectServer(view.id);
    toast(t('modal.joinedServer', { name: view.name }), 'ok');
  } catch (error) { handleError(error); }
}

/** Checks and redeems any pending `?invite=<code>` immediately after login/boot. */
export async function consumePendingInvite() {
  const code = sessionStorage.getItem(INVITE_SESSION_KEY);
  if (!code) return;
  sessionStorage.removeItem(INVITE_SESSION_KEY);
  await redeemInviteCode(code);
}

/** Opens a quick dialog letting users paste an invite link or code to join a server. */
export function openJoinInvitePrompt() {
  openModal({
    title: t('invite.joinTitle'),
    desc: t('invite.joinDesc'),
    submitText: t('modal.dirJoinBtn'),
    html: `<label for="f_invite_code">${escapeHtml(t('invite.codeLabel'))}</label>
           <input id="f_invite_code" placeholder="${escapeHtml(t('invite.codePh'))}" />`,
    onSubmit: async () => {
      const val = $('f_invite_code').value.trim();
      if (!val) throw new Error(t('invite.errCode'));
      closeModal();
      await redeemInviteCode(val);
    },
  });
}

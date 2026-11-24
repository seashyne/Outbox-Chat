/**
 * Channel settings (categories, visibility, read-only, slowmode) and
 * Server Moderation dialogs (kick, ban/unban list, timeout, audit logs).
 */

import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { closeModal, openModal } from './modals.js';
import { renderHeader, renderMembers, renderSidebar } from './render_shell.js';
import { $, avatar, currentServer, escapeHtml, fmtFull, state } from './state.js';

/** Opens the Edit Channel & Permissions modal for owners/admins. */
export function openEditChannelModal(channelId, onSyncComposer) {
  const server = currentServer();
  const ch = server?.channels.find((c) => c.id === channelId);
  if (!server || !ch) return;
  const slowOpts = [0, 5, 15, 30, 60, 300, 600];
  const currentSlow = ch.slowmode_seconds || 0;

  openModal({
    title: t('chEdit.title', { name: ch.name }),
    desc: t('chEdit.desc'),
    submitText: t('srv.saveBtn'),
    wide: true,
    html: `
      <label for="ce_name">${escapeHtml(t('modal.channelName'))}</label>
      <input id="ce_name" type="text" maxlength="32" value="${escapeHtml(ch.name)}" />
      <label for="ce_topic">${escapeHtml(t('modal.channelTopic'))}</label>
      <input id="ce_topic" type="text" maxlength="180" value="${escapeHtml(ch.topic || '')}" />
      <label for="ce_category">${escapeHtml(t('chEdit.categoryLabel'))}</label>
      <input id="ce_category" type="text" maxlength="32" placeholder="${escapeHtml(t('chEdit.categoryPh'))}" value="${escapeHtml(ch.category || '')}" />
      <label for="ce_vis">${escapeHtml(t('chEdit.visibilityLabel'))}</label>
      <select id="ce_vis">
        <option value="public" ${(ch.visibility || 'public') === 'public' ? 'selected' : ''}>${escapeHtml(t('chEdit.visPublic'))}</option>
        <option value="admin" ${ch.visibility === 'admin' ? 'selected' : ''}>${escapeHtml(t('chEdit.visAdmin'))}</option>
      </select>
      ${ch.kind === 'text' ? `
        <label class="srv-check-row" style="margin-top:12px">
          <input type="checkbox" id="ce_ro" ${ch.read_only ? 'checked' : ''} />
          <span>${escapeHtml(t('chEdit.readOnlyLabel'))}</span>
        </label>
        <label for="ce_slow">${escapeHtml(t('chEdit.slowmodeLabel'))}</label>
        <select id="ce_slow">
          ${slowOpts.map((sec) => `<option value="${sec}" ${currentSlow === sec ? 'selected' : ''}>${escapeHtml(t(`chEdit.slow_${sec}`))}</option>`).join('')}
        </select>` : ''}`,
    onSubmit: async () => {
      const payload = {
        name: $('ce_name').value.trim(),
        topic: $('ce_topic').value.trim(),
        category: $('ce_category').value.trim(),
        visibility: $('ce_vis').value,
      };
      if (ch.kind === 'text') {
        payload.read_only = Boolean($('ce_ro')?.checked);
        payload.slowmode_seconds = Number($('ce_slow')?.value || 0);
      }
      if (!payload.name) throw new Error(t('modal.errChannelName'));
      const updated = await api(`/channels/${encodeURIComponent(ch.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const idx = server.channels.findIndex((c) => c.id === updated.id);
      if (idx !== -1) server.channels[idx] = updated;
      renderSidebar();
      renderHeader();
      onSyncComposer?.();
      toast(t('chEdit.savedToast'), 'ok');
    },
  });
}

/** Confirms and executes kicking a member from the active server. */
export function openKickMemberModal(serverId, userId, displayName) {
  openModal({
    title: t('mod.kickTitle'),
    desc: t('mod.kickDesc', { name: displayName }),
    submitText: t('mod.kickBtn'),
    html: '',
    onSubmit: async () => {
      await api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/kick`, { method: 'POST' });
      const srv = state.servers.find((s) => s.id === serverId);
      if (srv) srv.members = srv.members.filter((m) => m.id !== userId);
      renderMembers();
      toast(t('mod.kickedToast', { name: displayName }), 'ok');
    },
  });
}

/** Opens the ban dialog with optional reason input. */
export function openBanMemberModal(serverId, userId, displayName) {
  openModal({
    title: t('mod.banTitle'),
    desc: t('mod.banDesc', { name: displayName }),
    submitText: t('mod.banBtn'),
    html: `
      <label for="ban_reason">${escapeHtml(t('mod.banReasonLabel'))}</label>
      <input id="ban_reason" type="text" maxlength="200" placeholder="${escapeHtml(t('mod.banReasonPh'))}" />`,
    onSubmit: async () => {
      const reason = $('ban_reason').value.trim();
      await api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      const srv = state.servers.find((s) => s.id === serverId);
      if (srv) srv.members = srv.members.filter((m) => m.id !== userId);
      renderMembers();
      toast(t('mod.bannedToast', { name: displayName }), 'ok');
    },
  });
}

/** Opens the temporary mute timeout duration dialog for a member. */
export function openTimeoutMemberModal(serverId, userId, displayName) {
  openModal({
    title: t('mod.timeoutTitle'),
    desc: t('mod.timeoutDesc', { name: displayName }),
    submitText: t('mod.timeoutSaveBtn'),
    html: `
      <label for="to_mins">${escapeHtml(t('mod.timeoutDurLabel'))}</label>
      <select id="to_mins">
        <option value="5">${escapeHtml(t('mod.to5m'))}</option>
        <option value="15">${escapeHtml(t('mod.to15m'))}</option>
        <option value="60">${escapeHtml(t('mod.to60m'))}</option>
        <option value="1440">${escapeHtml(t('mod.to24h'))}</option>
        <option value="0">${escapeHtml(t('mod.toClear'))}</option>
      </select>`,
    onSubmit: async () => {
      const minutes = Number($('to_mins').value);
      await api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/timeout`, {
        method: 'POST',
        body: JSON.stringify({ minutes }),
      });
      toast(minutes === 0 ? t('mod.timeoutClearedToast') : t('mod.timedOutToast', { name: displayName }), 'ok');
    },
  });
}

/** Opens the server Ban List modal allowing managers to unban blocked users. */
export async function openServerBansModal(serverId) {
  openModal({
    title: t('mod.bansListTitle'),
    desc: t('mod.bansListDesc'),
    wide: true,
    hideSubmit: true,
    html: `<div id="bansListWrap" class="gal-scroll"><p class="gal-empty">${escapeHtml(t('thread.loading'))}</p></div>`,
  });
  try {
    const bans = await api(`/servers/${encodeURIComponent(serverId)}/bans`);
    const wrap = $('bansListWrap');
    if (!wrap) return;
    if (!bans.length) { wrap.innerHTML = `<p class="gal-empty">${escapeHtml(t('mod.bansEmpty'))}</p>`; return; }
    wrap.innerHTML = bans.map((b) => `
      <div class="srv-member-row">
        <div class="srv-member-info">
          ${avatar(b.user, 'sm')}
          <div>
            <b>${escapeHtml(b.user.display_name)} <span>@${escapeHtml(b.user.username)}</span></b>
            <span>${escapeHtml(b.reason || t('mod.noReason'))} · ${escapeHtml(fmtFull(b.created_at))}</span>
          </div>
        </div>
        <button type="button" class="ghost-btn" data-unban="${escapeHtml(b.user.id)}">${escapeHtml(t('mod.unbanBtn'))}</button>
      </div>`).join('');
    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-unban]');
      if (!btn) return;
      btn.disabled = true;
      try {
        await api(`/servers/${encodeURIComponent(serverId)}/bans/${encodeURIComponent(btn.dataset.unban)}`, { method: 'DELETE' });
        toast(t('mod.unbannedToast'), 'ok');
        closeModal();
        openServerBansModal(serverId);
      } catch (err) {
        handleError(err);
        btn.disabled = false;
      }
    });
  } catch (err) {
    handleError(err);
  }
}

function auditLabel(entry) {
  const map = {
    member_kick: t('mod.auditKick'),
    member_ban: t('mod.auditBan'),
    member_unban: t('mod.auditUnban'),
    member_timeout: t('mod.auditTimeout'),
    member_timeout_clear: t('mod.auditTimeoutClear'),
    channel_update: t('mod.auditChanEdit'),
  };
  return map[entry.action] || entry.action;
}

function formatAuditDetail(raw) {
  if (!raw) return '';
  if (raw === 'cleared') return t('mod.toClear');
  if (/^\d+m$/.test(raw)) return `${raw.slice(0, -1)} ${t('mod.minutesUnit') || 'นาที'}`;
  if (raw.startsWith('vis=')) {
    const parts = [];
    if (raw.includes('vis=Admin')) parts.push(t('chEdit.visAdmin'));
    if (raw.includes('ro=true')) parts.push(t('chEdit.readOnlyShort') || 'อ่านอย่างเดียว');
    const sm = raw.match(/slow=(\d+)s/);
    if (sm && Number(sm[1]) > 0) parts.push(t('perm.slowmodeHint', { secs: sm[1] }));
    return parts.join(' · ');
  }
  return raw;
}

/** Opens the server moderation & channel changes Audit Log dialog. */
export async function openAuditLogModal(serverId) {
  openModal({
    title: t('mod.auditTitle'),
    desc: t('mod.auditDesc'),
    wide: true,
    hideSubmit: true,
    html: `<div id="auditListWrap" class="gal-scroll"><p class="gal-empty">${escapeHtml(t('thread.loading'))}</p></div>`,
  });
  try {
    const logs = await api(`/servers/${encodeURIComponent(serverId)}/audit`);
    const wrap = $('auditListWrap');
    if (!wrap) return;
    if (!logs.length) { wrap.innerHTML = `<p class="gal-empty">${escapeHtml(t('mod.auditEmpty'))}</p>`; return; }
    wrap.innerHTML = logs.map((l) => {
      const detailText = formatAuditDetail(l.detail);
      return `
      <div class="audit-row">
        <div>
          <b>${escapeHtml(l.actor_name)}</b> ${escapeHtml(auditLabel(l))} <b>${escapeHtml(l.target_name)}</b>
          ${detailText ? `<span class="audit-detail">${escapeHtml(detailText)}</span>` : ''}
        </div>
        <small>${escapeHtml(fmtFull(l.created_at))}</small>
      </div>`;
    }).join('');
  } catch (err) {
    handleError(err);
  }
}

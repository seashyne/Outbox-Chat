/**
 * Action modals: create server, create channel, server directory,
 * confirm delete channel, and confirm leave server.
 */

import { loadMessages, renderAll, selectChannel, selectServer } from './actions.js';
import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { renderHeader, renderRail, renderSidebar } from './render_shell.js';
import { $, currentServer, escapeHtml, setModalInert, state } from './state.js';

let modalHandler = null;
let lastModalFocus = null;

/** Dismisses a backdrop only when both press and release happen on the backdrop itself. */
export function bindBackdropDismiss(backdrop, onDismiss) {
  let pressedBackdrop = false;
  backdrop?.addEventListener('pointerdown', (e) => { pressedBackdrop = e.target === backdrop; });
  backdrop?.addEventListener('pointerup', (e) => {
    if (pressedBackdrop && e.target === backdrop) onDismiss();
    pressedBackdrop = false;
  });
}

export function openModal({ title, desc, html, submitText = t('common.create'), hideSubmit = false, wide = false, onSubmit }) {
  lastModalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('modalTitle').textContent = title;
  $('modalDesc').textContent = desc || '';
  $('modalFields').innerHTML = html || '';
  $('modalError').textContent = '';
  $('modalSubmit').textContent = submitText;
  $('modalSubmit').hidden = hideSubmit;
  $('modalCard')?.classList.toggle('modal-wide', Boolean(wide));
  modalHandler = onSubmit || null;
  setModalInert(true);
  $('modalBackdrop').hidden = false;
  const target = $('modalFields').querySelector('input, select') || (hideSubmit ? $('modalCancel') : $('modalSubmit'));
  if (target) setTimeout(() => target.focus(), 30);
}

export function closeModal() {
  if ($('modalBackdrop').hidden) return;
  $('modalBackdrop').hidden = true;
  $('modalCard')?.classList.remove('modal-wide');
  modalHandler = null;
  setModalInert(false);
  if (lastModalFocus?.isConnected) lastModalFocus.focus();
  lastModalFocus = null;
}

export function getModalHandler() {
  return modalHandler;
}

/** Binds modal submit, cancel, directory actions, and backdrop dismissal. */
export function bindModalEvents(onCreateServer, onJoinInvite) {
  $('modalFields').addEventListener('click', (e) => {
    const join = e.target.closest('[data-join]');
    if (join) joinFromDirectory(join.dataset.join);
    if (e.target.id === 'directoryCreate') { closeModal(); onCreateServer?.(); }
    if (e.target.id === 'directoryJoinInvite') { closeModal(); onJoinInvite?.(); }
  });
  $('modalCancel').addEventListener('click', closeModal);
  bindBackdropDismiss($('modalBackdrop'), closeModal);
  $('modalSubmit').addEventListener('click', async () => {
    if (!modalHandler) return;
    const button = $('modalSubmit');
    button.disabled = true;
    $('modalError').textContent = '';
    try {
      await modalHandler();
      closeModal();
    } catch (error) {
      $('modalError').textContent = error.message || t('error.requestFailed');
    } finally {
      button.disabled = false;
    }
  });
}

const field = (name, label, placeholder, extra = '') =>
  `<label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" placeholder="${escapeHtml(placeholder)}" ${extra} />`;

export function openCreateChannel(kind = 'text') {
  if (!currentServer()) { toast(t('modal.selectServerFirst'), 'err'); return; }
  openModal({
    title: t('modal.createChannelTitle'),
    desc: t('modal.createChannelDesc', { name: currentServer().name }),
    html: field('name', escapeHtml(t('modal.channelName')), kind === 'text' ? 'my-channel' : 'Lounge') +
      `<label for="f_kind">${escapeHtml(t('modal.channelType'))}</label>
       <select id="f_kind" name="kind">
         <option value="text" ${kind === 'text' ? 'selected' : ''}>${escapeHtml(t('modal.channelText'))}</option>
         <option value="voice" ${kind === 'voice' ? 'selected' : ''}>${escapeHtml(t('modal.channelVoice'))}</option>
       </select>` +
      field('topic', escapeHtml(t('modal.channelTopic')), t('modal.channelTopicPh')),
    onSubmit: async () => {
      const name = $('f_name').value.trim();
      if (!name) throw new Error(t('modal.errChannelName'));
      const channel = await api(`/servers/${encodeURIComponent(state.currentServerId)}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name, kind: $('f_kind').value, topic: $('f_topic').value.trim() }),
      });
      const server = currentServer();
      if (!server.channels.some((c) => c.id === channel.id)) server.channels.push(channel);
      renderSidebar();
      toast(t('modal.createdChannel', { name: channel.name }), 'ok');
      if (channel.kind === 'text') await selectChannel(channel.id);
    },
  });
}

export async function openDirectory() {
  try {
    const servers = await api('/servers');
    const rows = servers.map((s) => `
      <div class="member" style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:10px;min-width:0">
          <span class="avatar sm" style="background:${escapeHtml(s.accent_color || 'var(--brand)')}">${escapeHtml(s.icon)}</span>
          <span style="min-width:0"><b>${escapeHtml(s.name)}</b><br /><small style="color:var(--muted)">${escapeHtml(t('modal.dirMembers', { count: s.member_count }))}${s.description ? ` · ${escapeHtml(s.description)}` : ''}</small></span>
        </span>
        ${s.joined ? `<span style="color:var(--green);font-size:12px;flex:0 0 auto">${escapeHtml(t('modal.dirJoined'))}</span>` : `<button class="primary-btn" style="width:auto;min-height:32px;margin:0;padding:6px 12px;font-size:12px;flex:0 0 auto" data-join="${escapeHtml(s.id)}">${escapeHtml(t('modal.dirJoinBtn'))}</button>`}
      </div>`).join('');
    openModal({
      title: t('modal.dirTitle'),
      desc: t('modal.dirDesc'),
      hideSubmit: true,
      html: `<div style="max-height:260px;overflow-y:auto">${rows || escapeHtml(t('modal.dirEmpty'))}</div>
             <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
               <button class="ghost-btn" id="directoryCreate" style="padding-left:0">${escapeHtml(t('modal.dirCreate'))}</button>
               <button class="ghost-btn" id="directoryJoinInvite" style="padding-left:0">${escapeHtml(t('invite.joinByCodeBtn'))}</button>
             </div>`,
    });
  } catch (error) { handleError(error); }
}

export async function joinFromDirectory(serverId) {
  try {
    const view = await api(`/servers/${encodeURIComponent(serverId)}/join`, { method: 'POST' });
    const index = state.servers.findIndex((s) => s.id === view.id);
    if (index === -1) state.servers.push(view); else state.servers[index] = view;
    closeModal();
    renderRail();
    await selectServer(view.id);
    toast(t('modal.joinedServer', { name: view.name }), 'ok');
  } catch (error) { handleError(error); }
}

export function openConfirmDeleteChannel(channelId) {
  const server = currentServer();
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!server || !channel) return;
  openModal({
    title: t('modal.delChannelTitle'),
    desc: t('modal.delChannelDesc', { name: channel.name }),
    submitText: t('modal.delChannelBtn'),
    html: '',
    onSubmit: async () => {
      await api(`/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
      server.channels = server.channels.filter((c) => c.id !== channelId);
      if (state.currentChannelId === channelId) {
        const fallback = server.channels.find((c) => c.kind === 'text');
        state.currentChannelId = fallback ? fallback.id : null;
        await loadMessages();
      }
      if (state.voiceChannelId === channelId) state.voiceChannelId = null;
      delete state.voice[channelId];
      renderSidebar(); renderHeader(); renderRail();
      toast(t('modal.deletedChannel', { name: channel.name }), 'ok');
    },
  });
}

export function openConfirmLeaveServer(serverId) {
  const server = state.servers.find((s) => s.id === serverId);
  if (!server) return;
  openModal({
    title: t('modal.leaveTitle'),
    desc: t('modal.leaveDesc', { name: server.name }),
    submitText: t('modal.leaveBtn'),
    html: '',
    onSubmit: async () => {
      await api(`/servers/${encodeURIComponent(serverId)}/leave`, { method: 'POST' });
      state.servers = state.servers.filter((s) => s.id !== serverId);
      if (state.currentServerId === serverId) {
        state.currentServerId = state.servers[0]?.id || null;
        const next = currentServer();
        state.currentChannelId = next?.channels.find((c) => c.kind === 'text')?.id || null;
        state.voiceChannelId = null;
        await loadMessages();
      }
      renderAll();
      toast(t('modal.leftServer', { name: server.name }), 'ok');
    },
  });
}

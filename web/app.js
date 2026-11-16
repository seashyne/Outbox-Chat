/**
 * Outbox Chat — main browser entry point.
 * Wires DOM event delegation across modules in `web/js/` (zero build step).
 */

import {
  clearReply,
  clearSearch,
  insertMention,
  selectChannel,
  selectServer,
  setCloseOverlaysHook,
  setReply,
  toggleSearch,
} from './js/actions.js';
import { api, handleError, setUnauthorizedHandler, toast } from './js/api.js';
import { bindAuthEvents, logout, start, toggleTheme } from './js/auth.js';
import { bindMessageEvents } from './js/composer.js';
import {
  closeOverlays,
  handleDropdownKeydown,
  openChannelInfo,
  openProfile,
  openServerMenu,
  openStatusMenu,
} from './js/menus.js';
import {
  bindModalEvents,
  closeModal,
  openConfirmDeleteChannel,
  openConfirmLeaveServer,
  openCreateChannel,
  openDirectory,
} from './js/modals.js';
import { autoGrow } from './js/render_chat.js';
import { renderHeader, renderRail, renderSidebar, renderUserPanel, renderVoiceBar, renderVoicePanel } from './js/render_shell.js';
import { changeMemberRole, openCreateServer, openServerSettings } from './js/server_modal.js';
import { bindSettingsEvents, closeSettingsModal, openSettingsModal, updateMyStatus } from './js/settings.js';
import { $, applyTheme, currentServer, state } from './js/state.js';

setUnauthorizedHandler(logout);
setCloseOverlaysHook(closeOverlays);
applyTheme(state.settings.theme, state.settings.custom_colors);
bindAuthEvents();
bindMessageEvents();
bindModalEvents(openCreateServer);

function setMobileSidebar(open) {
  $('sidebar')?.classList.toggle('mobile-open', open);
  const scrim = $('sidebarScrim');
  if (scrim) {
    scrim.hidden = !open;
    scrim.classList.toggle('open', open);
  }
  const toggleBtn = $('chatHeader')?.querySelector('[data-action="toggle-sidebar"]');
  toggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

$('rail').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'server') selectServer(btn.dataset.id);
  else if (action === 'create-server') openCreateServer();
  else if (action === 'directory') openDirectory();
  else if (action === 'theme') openSettingsModal('appearance');
});

$('serverHeader').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'create-channel') openCreateChannel('text');
  else if (btn.dataset.action === 'server-menu') openServerMenu(btn);
});

$('channelList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'channel') selectChannel(id);
  else if (action === 'create-channel') openCreateChannel(btn.dataset.kind || 'text');
  else if (action === 'toggle-group') {
    const key = btn.dataset.group;
    if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
    renderSidebar();
  } else if (action === 'channel-info') openChannelInfo(id, btn);
  else if (action === 'channel-copy' || action === 'copy-server') {
    const text = action === 'copy-server' ? currentServer()?.name || '' : `#${currentServer()?.channels.find((c) => c.id === id)?.name || ''}`;
    navigator.clipboard?.writeText(text).then(() => toast(`คัดลอก "${text}" แล้ว`, 'ok')).catch(() => toast(text, 'ok'));
    closeOverlays();
  } else if (action === 'channel-mark-read' || action === 'mark-read') {
    state.unread.delete(id); state.mentions.delete(id);
    renderSidebar(); renderRail(); closeOverlays();
  } else if (action === 'profile') openProfile(id, btn);
});

async function handleVoiceClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'toggle-mute' || action === 'toggle-deafen') {
    if (action === 'toggle-mute') state.muted = !state.muted;
    else { state.deafened = !state.deafened; if (state.deafened) state.muted = true; }
    renderUserPanel(); renderVoicePanel(); renderVoiceBar();
    toast(state.deafened ? 'ปิดเสียงแล้ว' : state.muted ? 'ปิดไมโครโฟนแล้ว' : 'เปิดไมโครโฟนแล้ว');
    return;
  }
  if (action !== 'voice-join' && action !== 'voice-leave') return;
  if (action === 'voice-join' && (!state.ws || state.ws.readyState !== 1)) {
    toast('กำลังเชื่อมต่ออยู่ กรุณารอสักครู่แล้วลองใหม่', 'err');
    return;
  }
  const id = btn.dataset.id;
  try {
    const result = await api(`/channels/${encodeURIComponent(id)}/voice/${action === 'voice-join' ? 'join' : 'leave'}`, { method: 'POST' });
    if (result.users.length) state.voice[id] = result.users; else delete state.voice[id];
    renderSidebar(); renderVoicePanel(); renderVoiceBar();
  } catch (error) { handleError(error); }
}
$('voicePanel').addEventListener('click', handleVoiceClick);
$('voiceBar').addEventListener('click', handleVoiceClick);

$('chatHeader').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'toggle-search') toggleSearch();
  else if (action === 'toggle-members') {
    state.membersVisible = !state.membersVisible;
    $('memberList').hidden = !state.membersVisible;
    renderHeader();
  } else if (action === 'toggle-sidebar') setMobileSidebar(!$('sidebar').classList.contains('mobile-open'));
  else if (action === 'toggle-theme') toggleTheme();
});
$('sidebarScrim')?.addEventListener('click', () => setMobileSidebar(false));
$('channelList').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="channel"]') && window.innerWidth <= 680) setMobileSidebar(false);
});

$('memberList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="profile"]');
  if (btn) openProfile(btn.dataset.id, btn);
});

$('userPanel').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'logout') logout(false);
  else if (action === 'open-settings') openSettingsModal('profile');
  else if (action === 'my-status') openStatusMenu(btn);
  else if (action === 'toggle-mute' || action === 'toggle-deafen') handleVoiceClick(e);
});

$('overlay').addEventListener('click', () => closeOverlays(false));
$('dropdown').addEventListener('keydown', handleDropdownKeydown);
$('dropdown').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'create-channel') { closeOverlays(); openCreateChannel('text'); }
  else if (action === 'server-settings') { closeOverlays(); openServerSettings('general'); }
  else if (action === 'directory') { closeOverlays(); openDirectory(); }
  else if (action === 'copy-server') {
    const name = currentServer()?.name || '';
    navigator.clipboard?.writeText(name).then(() => toast(`คัดลอก "${name}" แล้ว`, 'ok')).catch(() => toast(name, 'ok'));
    closeOverlays();
  } else if (action === 'channel-copy') {
    const channel = currentServer()?.channels.find((c) => c.id === btn.dataset.id);
    navigator.clipboard?.writeText(`#${channel?.name || ''}`).then(() => toast('คัดลอกชื่อช่องแล้ว', 'ok')).catch(() => {});
    closeOverlays();
  } else if (action === 'channel-mark-read') {
    state.unread.delete(btn.dataset.id); state.mentions.delete(btn.dataset.id);
    renderSidebar(); renderRail(); closeOverlays();
  } else if (action === 'channel-delete') { const cid = btn.dataset.id; closeOverlays(); openConfirmDeleteChannel(cid); }
  else if (action === 'leave-server') { const sid = btn.dataset.id; closeOverlays(); openConfirmLeaveServer(sid); }
  else if (action === 'toggle-members') {
    state.membersVisible = !state.membersVisible;
    $('memberList').hidden = !state.membersVisible;
    renderHeader(); closeOverlays();
  } else if (action === 'toggle-theme') { toggleTheme(); closeOverlays(); }
  else if (action === 'open-settings-profile') { closeOverlays(); openSettingsModal('profile'); }
  else if (action === 'open-settings-appearance') { closeOverlays(); openSettingsModal('appearance'); }
  else if (action === 'set-status') updateMyStatus(btn.dataset.status);
  else if (action === 'insert-snippet') {
    const input = $('messageInput');
    const s = btn.dataset.snippet;
    const insert = s === 'code' ? '`code`' : s === 'bold' ? '**text**' : '@';
    const startIdx = input.selectionStart ?? input.value.length;
    const endIdx = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, startIdx) + insert + input.value.slice(endIdx);
    closeOverlays(); input.focus(); autoGrow();
  }
});

$('profilePopout').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'mention-user') insertMention(id);
  else if (action === 'reply-to-user') {
    const last = [...state.messages].reverse().find((m) => m.author.id === id);
    closeOverlays();
    if (last) setReply(last.id); else toast('ยังไม่มีข้อความจากคนนี้ในช่องนี้');
  } else if (action === 'open-settings-profile') { closeOverlays(); openSettingsModal('profile'); }
  else if (action === 'open-settings-appearance') { closeOverlays(); openSettingsModal('appearance'); }
  else if (action === 'toggle-member-role' && currentServer()) {
    const sid = currentServer().id;
    const role = btn.dataset.role;
    closeOverlays();
    changeMemberRole(sid, id, role).catch(handleError);
  }
});

bindSettingsEvents(logout);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('settingsBackdrop').hidden) { closeSettingsModal(true); return; }
    if (!$('modalBackdrop').hidden) { closeModal(); return; }
    if (state.popover) { closeOverlays(true); return; }
    if ($('sidebar')?.classList.contains('mobile-open')) { setMobileSidebar(false); return; }
    if (state.replyTo) { clearReply(); return; }
    if (state.searchOpen) { clearSearch(); return; }
  }
  if ($('shell').hidden || !$('settingsBackdrop').hidden || !$('modalBackdrop').hidden) return;
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleSearch(); }
  if (e.key === '/' && document.activeElement !== $('messageInput') && !state.searchOpen) {
    e.preventDefault(); toggleSearch();
  }
});
window.addEventListener('resize', () => { if (state.popover) closeOverlays(); });

autoGrow();
if (state.token) start();

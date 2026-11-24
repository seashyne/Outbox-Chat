/**
 * Core user actions: bootstrap loading, server/channel navigation,
 * message CRUD, replies, clean reactions, and search toggles.
 */

import { api, handleError, toast } from './api.js';
import { clearPendingAttachments } from './attachments.js';
import { loadFriends, openDirectChat, renderFriendsStage } from './friends_ui.js';
import { ALLOWED_LANGUAGES, setLanguage, t } from './i18n.js';
import {
  appendMessage,
  clearReply,
  loadMessages,
  refreshMessages,
  sendMessage,
  setReply,
  toggleReaction,
} from './messages.js';
import { autoGrow, renderMessages, scrollToBottom } from './render_chat.js';
import {
  renderHeader,
  renderMembers,
  renderRail,
  renderReplyBar,
  renderSidebar,
  renderTyping,
  renderUserPanel,
  renderVoicePanel,
} from './render_shell.js';
import {
  $,
  DEFAULT_CUSTOM_COLORS,
  VALID_THEMES,
  applyTheme,
  currentChannel,
  currentServer,
  safeColor,
  state,
  statusLabel,
  userById,
} from './state.js';

export { appendMessage, clearReply, loadMessages, refreshMessages, sendMessage, setReply, toggleReaction };

let onCloseOverlaysHook = () => {};
export function setCloseOverlaysHook(fn) {
  onCloseOverlaysHook = fn;
}

/** Re-renders all top-level UI regions from current client state. */
export function renderAll() {
  renderRail();
  renderSidebar();
  renderUserPanel();
  renderHeader();
  renderFriendsStage(renderAll, openDmChannel);
  renderMessages();
  renderMembers();
  renderTyping();
  renderReplyBar();
  $('memberList').hidden = !state.membersVisible || state.homeMode;
}

/** Fetches bootstrap state + friends list in parallel and pre-warms voice module. */
export async function loadBootstrap() {
  const [data] = await Promise.all([api('/bootstrap'), loadFriends()]);
  state.me = data.me;
  state.servers = data.servers;
  state.online = new Set(data.online);
  state.voice = data.voice || {};
  state.homeMode = false;
  state.dmChannel = null;
  state.dmPeer = null;
  state.messageCache.clear();
  state.currentServerId = data.default_server_id || null;
  state.currentChannelId = data.default_channel_id || null;
  state.voiceChannelId = null;
  setTimeout(() => { import('./meeting_rtc.js').catch(() => {}); }, 400);
  if (data.settings) {
    const theme = VALID_THEMES.includes(data.settings.theme) ? data.settings.theme : 'dark';
    const customColors = {
      brand: safeColor(data.settings.custom_colors?.brand, DEFAULT_CUSTOM_COLORS.brand),
      sidebar: safeColor(data.settings.custom_colors?.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
      chat: safeColor(data.settings.custom_colors?.chat, DEFAULT_CUSTOM_COLORS.chat),
    };
    if (data.settings.status) {
      state.myStatus = data.settings.status;
      state.settings.status = data.settings.status;
    }
    if (data.settings.language && ALLOWED_LANGUAGES.includes(data.settings.language)) {
      state.settings.language = data.settings.language;
      setLanguage(data.settings.language, { persistLocal: true, notify: false });
    }
    applyTheme(theme, customColors);
  }
}

/** Updates the message composer placeholder for the current DM or server channel. */
export function updateComposerPlaceholder() {
  const input = $('messageInput');
  if (!input) return;
  if (state.homeMode && state.dmChannel) {
    input.placeholder = t('composer.placeholderDm', { name: state.dmPeer?.display_name || t('rail.friendsShort') });
  } else {
    const channel = currentChannel();
    input.placeholder = channel
      ? t('composer.placeholderChannel', { name: channel.name })
      : t('composer.placeholderSelect');
  }
  import('./composer.js').then((m) => m.syncComposerAccess()).catch(() => {});
}

export function toggleSearch() {
  state.searchOpen = !state.searchOpen;
  if (!state.searchOpen) state.search = '';
  renderHeader();
  renderMessages();
  if (!state.searchOpen) scrollToBottom();
}

export function clearSearch() {
  state.search = '';
  state.searchOpen = false;
  renderHeader();
  renderMessages();
  scrollToBottom();
}

export function insertMention(userId) {
  const user = userById(userId);
  const input = $('messageInput');
  const mention = `@${user.username} `;
  input.value += (input.value && !input.value.endsWith(' ') ? ' ' : '') + mention;
  input.focus();
  autoGrow();
  onCloseOverlaysHook();
}

function resetChannelNav(clearSearchState = true) {
  clearReply();
  clearPendingAttachments();
  if (clearSearchState) { state.search = ''; state.searchOpen = false; }
  state.typing.clear();
  state.typingTimers.forEach((timer) => clearTimeout(timer));
  state.typingTimers.clear();
  $('jumpBtn').hidden = true;
  $('sidebar').classList.remove('mobile-open');
  onCloseOverlaysHook();
}

/** Switches UI into Home / Friends list view cleanly. */
export function selectFriendsHome() {
  state.homeMode = true;
  state.dmChannel = null;
  state.dmPeer = null;
  state.voiceChannelId = null;
  resetChannelNav(false);
  renderAll();
  loadFriends().then(() => { if (state.homeMode) renderAll(); }).catch(() => {});
}

/** Opens a 1-on-1 DM channel and loads cached/fresh messages immediately. */
export async function openDmChannel(channel, peer) {
  state.homeMode = true;
  state.voiceChannelId = null;
  state.dmChannel = channel;
  state.dmPeer = peer;
  resetChannelNav();
  updateComposerPlaceholder();
  renderAll();
  await loadMessages();
}

export async function startDmWithUser(userId, fallbackUser) {
  try { await openDirectChat(userId, fallbackUser, openDmChannel); } catch (error) { handleError(error); }
}

export async function selectServer(id) {
  if (!state.homeMode && state.currentServerId === id) return;
  state.homeMode = false;
  state.dmChannel = null;
  state.dmPeer = null;
  state.currentServerId = id;
  const server = currentServer();
  state.currentChannelId = server?.channels.find((c) => c.kind === 'text')?.id || null;
  state.voiceChannelId = null;
  resetChannelNav();
  updateComposerPlaceholder();
  renderAll();
  await loadMessages();
}

/** Updates presence status immediately and broadcasts over WebSocket. */
export async function updateMyStatus(nextStatus) {
  state.myStatus = nextStatus;
  state.settings.status = nextStatus;
  renderUserPanel();
  renderMembers();
  renderRail();
  onCloseOverlaysHook();
  try {
    await api('/users/@me/settings', { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    if (state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'status', status: nextStatus }));
    toast(t('status.toast', { label: statusLabel(state.myStatus) }), 'ok');
  } catch (error) {
    handleError(error);
  }
}

export async function selectChannel(id) {
  state.homeMode = false;
  state.dmChannel = null;
  state.dmPeer = null;
  const channel = currentServer()?.channels.find((c) => c.id === id);
  if (!channel) return;
  if (channel.kind === 'voice') {
    state.voiceChannelId = id;
    resetChannelNav(false);
    renderRail(); renderSidebar(); renderHeader(); renderVoicePanel();
    renderFriendsStage(renderAll, openDmChannel);
    renderTyping();
    return;
  }
  state.currentChannelId = id;
  state.voiceChannelId = null;
  state.unread.delete(id);
  state.mentions.delete(id);
  resetChannelNav();
  updateComposerPlaceholder();
  renderAll();
  await loadMessages();
}

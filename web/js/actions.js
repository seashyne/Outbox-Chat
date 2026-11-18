/**
 * Core user actions: bootstrap loading, server/channel navigation,
 * message CRUD, replies, clean reactions, and search toggles.
 */

import { api, handleError } from './api.js';
import { loadFriends, openDirectChat, renderFriendsStage } from './friends_ui.js';
import { ALLOWED_LANGUAGES, setLanguage, t } from './i18n.js';
import { autoGrow, nearBottom, renderMessages, scrollToBottom } from './render_chat.js';
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
  userById,
} from './state.js';

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
    return;
  }
  const channel = currentChannel();
  input.placeholder = channel
    ? t('composer.placeholderChannel', { name: channel.name })
    : t('composer.placeholderSelect');
}

export function clearReply() {
  state.replyTo = null;
  renderReplyBar();
}

export function setReply(messageId) {
  const message = state.messages.find((m) => m.id === messageId);
  if (!message) return;
  state.replyTo = message;
  renderReplyBar();
  $('messageInput').focus();
}

export async function toggleReaction(messageId, emoji) {
  try {
    const updated = await api(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index !== -1) state.messages[index] = updated;
    renderMessages();
  } catch (error) {
    handleError(error);
  }
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

export async function loadMessages() {
  const channel = currentChannel();
  if (!channel || channel.kind !== 'text' || (state.homeMode && !state.dmChannel)) {
    state.messages = [];
    renderMessages();
    $('jumpBtn').hidden = true;
    return;
  }
  const cid = channel.id;
  const cached = state.messageCache.get(cid);
  if (cached) {
    state.messages = cached;
    renderMessages();
    scrollToBottom();
    $('jumpBtn').hidden = true;
  }
  try {
    const fresh = await api(`/channels/${encodeURIComponent(cid)}/messages?limit=60`);
    state.messageCache.set(cid, fresh);
    if (currentChannel()?.id === cid) {
      state.messages = fresh;
      renderMessages();
      if (!cached || nearBottom()) scrollToBottom();
      $('jumpBtn').hidden = true;
    }
  } catch (error) {
    if (!cached) handleError(error);
  }
}

export async function refreshMessages() {
  const channel = currentChannel();
  if (!channel || channel.kind !== 'text') return;
  try {
    const stick = nearBottom();
    const fresh = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
    state.messageCache.set(channel.id, fresh);
    state.messages = fresh;
    renderMessages();
    if (stick) scrollToBottom();
  } catch (error) {
    handleError(error);
  }
}

export function appendMessage(message) {
  const cid = message.channel_id;
  const list = state.messageCache.get(cid);
  if (list && !list.some((m) => m.id === message.id)) {
    list.push(message);
    if (list.length > 200) list.shift();
  }
  if (currentChannel()?.id !== cid) return;
  if (state.messages.some((m) => m.id === message.id)) return;
  const stick = nearBottom();
  state.messages.push(message);
  if (state.messages.length > 200) state.messages.shift();
  renderMessages();
  if (stick) scrollToBottom();
}

export async function sendMessage() {
  const input = $('messageInput');
  const content = input.value.trim();
  const channel = currentChannel();
  if (!content || !channel || channel.kind !== 'text') return;
  try {
    const message = await api(`/channels/${encodeURIComponent(channel.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, reply_to: state.replyTo ? state.replyTo.id : null }),
    });
    input.value = '';
    clearReply();
    autoGrow();
    appendMessage(message); // WS echo is de-duplicated by id
    scrollToBottom();
  } catch (error) {
    handleError(error);
  }
}

function resetChannelNav(clearSearchState = true) {
  clearReply();
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

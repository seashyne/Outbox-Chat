/**
 * Core user actions: bootstrap loading, server/channel navigation,
 * message CRUD, replies, clean reactions, and search toggles.
 */

import { api, handleError } from './api.js';
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
  renderMessages();
  renderMembers();
  renderTyping();
  renderReplyBar();
  $('memberList').hidden = !state.membersVisible;
}

/** Fetches bootstrap state (`me`, `settings`, `servers`, `online`, `voice`) and applies theme. */
export async function loadBootstrap() {
  const data = await api('/bootstrap');
  state.me = data.me;
  state.servers = data.servers;
  state.online = new Set(data.online);
  state.voice = data.voice || {};
  state.currentServerId = data.default_server_id || null;
  state.currentChannelId = data.default_channel_id || null;
  state.voiceChannelId = null;
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
    applyTheme(theme, customColors);
  }
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
  if (!channel || channel.kind !== 'text') {
    state.messages = [];
    renderMessages();
    $('jumpBtn').hidden = true;
    return;
  }
  try {
    state.messages = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
    renderMessages();
    scrollToBottom();
    $('jumpBtn').hidden = true;
  } catch (error) {
    handleError(error);
  }
}

export async function refreshMessages() {
  const channel = currentChannel();
  if (!channel || channel.kind !== 'text') return;
  try {
    const stick = nearBottom();
    state.messages = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
    renderMessages();
    if (stick) scrollToBottom();
  } catch (error) {
    handleError(error);
  }
}

export function appendMessage(message) {
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

export async function selectServer(id) {
  if (state.currentServerId === id) return;
  state.currentServerId = id;
  const server = currentServer();
  state.currentChannelId = server?.channels.find((c) => c.kind === 'text')?.id || null;
  state.voiceChannelId = null;
  clearReply();
  state.search = '';
  state.searchOpen = false;
  state.typing.clear();
  state.typingTimers.forEach((timer) => clearTimeout(timer));
  state.typingTimers.clear();
  const channel = currentChannel();
  $('messageInput').placeholder = channel ? `ส่งข้อความไปที่ #${channel.name}` : 'เลือกช่องก่อนส่งข้อความ';
  $('jumpBtn').hidden = true;
  $('sidebar').classList.remove('mobile-open');
  onCloseOverlaysHook();
  renderAll();
  await loadMessages();
}

export async function selectChannel(id) {
  const channel = currentServer()?.channels.find((c) => c.id === id);
  if (!channel) return;
  if (channel.kind === 'voice') {
    state.voiceChannelId = id;
    state.typing.clear();
    state.typingTimers.forEach((timer) => clearTimeout(timer));
    state.typingTimers.clear();
    $('sidebar').classList.remove('mobile-open');
    onCloseOverlaysHook();
    renderSidebar();
    renderHeader();
    renderVoicePanel();
    renderTyping();
    return;
  }
  state.currentChannelId = id;
  state.voiceChannelId = null;
  state.unread.delete(id);
  state.mentions.delete(id);
  clearReply();
  state.search = '';
  state.searchOpen = false;
  state.typing.clear();
  state.typingTimers.forEach((timer) => clearTimeout(timer));
  state.typingTimers.clear();
  $('messageInput').placeholder = `ส่งข้อความไปที่ #${channel.name}`;
  $('jumpBtn').hidden = true;
  $('sidebar').classList.remove('mobile-open');
  onCloseOverlaysHook();
  renderSidebar();
  renderHeader();
  renderVoicePanel();
  renderTyping();
  renderRail();
  await loadMessages();
}

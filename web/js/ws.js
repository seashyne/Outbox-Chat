/**
 * WebSocket gateway connection, automatic reconnect, and realtime event dispatch.
 */

import { appendMessage, loadMessages, refreshMessages } from './actions.js';
import { setConn, toast } from './api.js';
import { nearBottom, renderMessages, scrollToBottom, updateJumpButton } from './render_chat.js';
import {
  renderHeader,
  renderMembers,
  renderRail,
  renderSidebar,
  renderTyping,
  renderUserPanel,
  renderVoiceBar,
  renderVoicePanel,
} from './render_shell.js';
import { state } from './state.js';

/** Connects to `/api/ws` with the active bearer token and subscribes to realtime events. */
export function connectWs() {
  if (!state.token) return;
  clearTimeout(state.reconnectTimer);
  setConn('', 'กำลังเชื่อมต่อ…');
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/api/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = socket;

  socket.onopen = () => setConn('ok', 'ออนไลน์ · พร้อมคุยแล้ว');
  socket.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    handleEvent(payload);
  };
  socket.onclose = () => {
    if (state.ws !== socket) return;
    setConn('bad', 'หลุดการเชื่อมต่อ · กำลังลองใหม่…');
    state.reconnectTimer = setTimeout(connectWs, 1500);
  };
  socket.onerror = () => socket.close();
}

/** Dispatches a single server-pushed realtime event onto client state and DOM. */
export function handleEvent(event) {
  switch (event.type) {
    case 'ready':
    case 'presence':
      state.online = new Set(event.online || []);
      renderMembers();
      break;
    case 'message_create': {
      const message = event.message;
      const mentioned = state.me && (
        message.content.toLowerCase().includes(`@${state.me.username.toLowerCase()}`) ||
        message.content.toLowerCase().includes(`@${state.me.display_name.toLowerCase()}`)
      );
      if (message.channel_id === state.currentChannelId && !state.searchOpen) {
        const stick = nearBottom();
        appendMessage(message);
        if (!stick) updateJumpButton();
      } else {
        state.unread.add(message.channel_id);
        if (mentioned) state.mentions.add(message.channel_id);
        renderSidebar();
        renderRail();
      }
      if (mentioned && message.channel_id === state.currentChannelId) toast('มีคนกล่าวถึงคุณในข้อความ');
      break;
    }
    case 'message_update':
      if (state.me && event.actor_id === state.me.id) break;
      if (event.message.channel_id === state.currentChannelId && !state.searchOpen) refreshMessages();
      break;
    case 'message_delete': {
      const stick = nearBottom();
      state.messages = state.messages.filter((m) => m.id !== event.message_id);
      renderMessages();
      if (stick) scrollToBottom();
      break;
    }
    case 'channel_create': {
      const server = state.servers.find((s) => s.id === event.server_id);
      if (server && !server.channels.some((c) => c.id === event.channel.id)) {
        server.channels.push(event.channel);
        renderSidebar();
      }
      break;
    }
    case 'channel_delete': {
      const server = state.servers.find((s) => s.id === event.server_id);
      if (server) {
        server.channels = server.channels.filter((c) => c.id !== event.channel_id);
        if (state.currentChannelId === event.channel_id) {
          const fallback = server.channels.find((c) => c.kind === 'text');
          state.currentChannelId = fallback ? fallback.id : null;
          if (server.id === state.currentServerId) loadMessages();
        }
        if (state.voiceChannelId === event.channel_id) state.voiceChannelId = null;
        delete state.voice[event.channel_id];
        renderSidebar();
        renderHeader();
        renderRail();
      }
      break;
    }
    case 'member_join': {
      const server = state.servers.find((s) => s.id === event.server_id);
      if (server && !server.members.some((m) => m.id === event.user.id)) {
        server.members.push(event.user);
        renderMembers();
      }
      break;
    }
    case 'member_leave': {
      const server = state.servers.find((s) => s.id === event.server_id);
      if (server) {
        server.members = server.members.filter((m) => m.id !== event.user_id);
        renderMembers();
      }
      break;
    }
    case 'user_update': {
      const updated = event.user;
      if (!updated) break;
      if (state.me && state.me.id === updated.id) {
        state.me = { ...state.me, ...updated };
        renderUserPanel();
      }
      for (const s of state.servers) {
        const idx = s.members.findIndex((m) => m.id === updated.id);
        if (idx !== -1) s.members[idx] = { ...s.members[idx], ...updated };
      }
      let msgChanged = false;
      for (const m of state.messages) {
        if (m.author && m.author.id === updated.id) {
          m.author = { ...m.author, ...updated };
          msgChanged = true;
        }
      }
      renderMembers();
      if (msgChanged) renderMessages();
      break;
    }
    case 'user_status':
      if (event.user_id && event.status) {
        state.userStatuses.set(event.user_id, event.status);
        if (state.me && state.me.id === event.user_id) {
          state.myStatus = event.status;
          renderUserPanel();
        }
        renderMembers();
      }
      break;
    case 'typing':
      if (event.channel_id !== state.currentChannelId || !state.me || event.user.id === state.me.id) break;
      state.typing.set(event.user.id, event.user.display_name);
      renderTyping();
      clearTimeout(state.typingTimers.get(event.user.id));
      state.typingTimers.set(event.user.id, setTimeout(() => {
        state.typing.delete(event.user.id);
        state.typingTimers.delete(event.user.id);
        renderTyping();
      }, 3200));
      break;
    case 'voice_state':
      if (event.users.length) state.voice[event.channel_id] = event.users;
      else delete state.voice[event.channel_id];
      renderSidebar();
      renderVoicePanel();
      renderVoiceBar();
      break;
    default:
      break;
  }
}

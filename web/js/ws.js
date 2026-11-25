/**
 * WebSocket gateway connection, automatic reconnect, and realtime event dispatch.
 */

import { appendMessage, loadMessages, openDmChannel, refreshMessages, renderAll } from './actions.js';
import { setConn, toast } from './api.js';
import { applyUpdatedMessage } from './chat_features.js';
import { wsUrl } from './config.js';
import { loadFriends, renderFriendsStage } from './friends_ui.js';
import { t } from './i18n.js';
import { handleMeetingWsEvent } from './meeting_ui.js';
import { playNotifyChime, renderDmCallBanner, sendDesktopNotification } from './notify.js';
import { nearBottom, renderMessages, scrollToBottom, updateJumpButton } from './render_chat.js';
import { handleThreadCreateWs, handleThreadMessageWs } from './threads_ui.js';
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
import { currentChannel, state } from './state.js';

let connStateKey = 'conn.connecting';
let connStatusClass = '';

/** Re-applies the localized WebSocket status label when UI language switches. */
export function syncConnStatusLabel() {
  setConn(connStatusClass, t(connStateKey));
}

/** Connects to `/api/ws` with the active bearer token and subscribes to realtime events. */
export function connectWs() {
  if (!state.token) return;
  clearTimeout(state.reconnectTimer);
  connStateKey = 'conn.connecting';
  connStatusClass = '';
  syncConnStatusLabel();
  const socket = new WebSocket(wsUrl(state.token));
  state.ws = socket;

  socket.onopen = () => {
    connStateKey = 'conn.online';
    connStatusClass = 'ok';
    syncConnStatusLabel();
  };
  socket.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    handleEvent(payload);
  };
  socket.onclose = () => {
    if (state.ws !== socket) return;
    connStateKey = 'conn.reconnecting';
    connStatusClass = 'bad';
    syncConnStatusLabel();
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
      const activeCid = currentChannel()?.id;
      const mentioned = state.me && (
        message.content.toLowerCase().includes(`@${state.me.username.toLowerCase()}`) ||
        message.content.toLowerCase().includes(`@${state.me.display_name.toLowerCase()}`)
      );
      if (message.channel_id === activeCid && !state.searchOpen) {
        const stick = nearBottom();
        appendMessage(message);
        if (!stick) updateJumpButton();
      } else {
        appendMessage(message);
        state.unread.add(message.channel_id);
        if (mentioned) state.mentions.add(message.channel_id);
        renderSidebar();
        renderRail();
      }
      if (mentioned && message.channel_id === activeCid) toast(t('chat.mentionedToast'));
      if (state.me && message.author?.id !== state.me.id) {
        const isDm = message.channel_id.startsWith('dm:');
        if (isDm || mentioned) {
          playNotifyChime('message');
          const title = isDm
            ? t('notify.newDmTitle', { name: message.author?.display_name || t('friends.dmHeader') })
            : t('notify.mentionTitle', { name: message.author?.display_name || t('common.member') });
          sendDesktopNotification(title, message.content || t('chat.attachFileMenu'));
        }
      }
      break;
    }
    case 'message_update':
      if (event.message) applyUpdatedMessage(event.message);
      else if (event.message?.channel_id === currentChannel()?.id && !state.searchOpen) refreshMessages();
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
    case 'channel_update': {
      const server = state.servers.find((s) => s.id === event.server_id);
      if (server && event.channel) {
        const idx = server.channels.findIndex((c) => c.id === event.channel.id);
        if (idx !== -1) server.channels[idx] = event.channel;
        else server.channels.push(event.channel);
        renderSidebar();
        renderHeader();
        import('./composer.js').then((m) => m.syncComposerAccess()).catch(() => {});
      }
      break;
    }
    case 'thread_create':
      handleThreadCreateWs(event.thread);
      break;
    case 'thread_message_create':
      handleThreadMessageWs(event);
      break;
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
    case 'server_update': {
      const srv = event.server;
      const target = srv && state.servers.find((s) => s.id === srv.id);
      if (target) {
        Object.assign(target, {
          name: srv.name,
          icon: srv.icon,
          description: srv.description || '',
          accent_color: srv.accent_color || '#5865f2',
          roles_config: srv.roles_config || target.roles_config,
        });
        renderRail(); renderSidebar(); renderHeader(); renderMembers();
      }
      break;
    }
    case 'member_role_update': {
      const target = state.servers.find((s) => s.id === event.server_id);
      if (target) {
        target.member_roles = { ...(target.member_roles || {}), [event.user_id]: event.role };
        if (state.me && state.me.id === event.user_id) target.role = event.role;
        renderSidebar(); renderMembers();
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
        if (state.me && event.user_id === state.me.id) {
          state.servers = state.servers.filter((s) => s.id !== event.server_id);
          toast(t('mod.removedFromServer', { name: server.name }), 'err');
          if (state.currentServerId === event.server_id) {
            state.currentServerId = state.servers[0]?.id || null;
            const next = state.servers[0];
            state.currentChannelId = next?.channels.find((c) => c.kind === 'text')?.id || null;
            renderAll();
            loadMessages();
          } else renderRail();
          break;
        }
        server.members = server.members.filter((m) => m.id !== event.user_id);
        renderMembers();
      }
      break;
    }
    case 'user_update': {
      const updated = event.user;
      if (!updated) break;
      if (state.me?.id === updated.id) { state.me = { ...state.me, ...updated }; if (updated.plan) state.account = { ...(state.account || {}), plan: updated.plan }; renderUserPanel(); }
      for (const s of state.servers) {
        const idx = s.members.findIndex((m) => m.id === updated.id);
        if (idx !== -1) s.members[idx] = { ...s.members[idx], ...updated };
      }
      let msgChanged = false;
      for (const m of state.messages) {
        if (m.author?.id === updated.id) { m.author = { ...m.author, ...updated }; msgChanged = true; }
      }
      renderMembers(); renderVoicePanel(); renderSidebar();
      if (msgChanged) renderMessages();
      break;
    }
    case 'server_profile_update': {
      const srv = state.servers.find((s) => s.id === event.server_id);
      if (srv && event.user_id) {
        srv.member_profiles = srv.member_profiles || {};
        srv.member_profiles[event.user_id] = event.profile || {};
        renderMembers(); renderMessages(); renderVoicePanel(); renderSidebar();
      }
      break;
    }
    case 'friend_update': {
      const prevIn = (state.friends?.incoming || []).length;
      loadFriends().then(() => {
        renderRail();
        if (state.homeMode) { renderSidebar(); renderFriendsStage(renderAll, openDmChannel); }
        if ((state.friends?.incoming || []).length > prevIn) {
          playNotifyChime('friend');
          toast(t('notify.friendReqToast'), 'ok');
          sendDesktopNotification(t('notify.friendReqTitle'), t('notify.friendReqToast'));
        }
      }).catch(() => {});
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
      if (event.channel_id !== currentChannel()?.id || !state.me || event.user.id === state.me.id) break;
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
      if (state.me && state.joinedVoiceChannelId === event.channel_id && !event.users.includes(state.me.id)) {
        state.joinedVoiceChannelId = null;
      }
      renderSidebar();
      renderVoicePanel();
      renderVoiceBar();
      if (event.channel_id?.startsWith('dm:')) {
        const activeUsers = event.users || [];
        if (activeUsers.length > 0 && state.me && !activeUsers.includes(state.me.id) && state.joinedVoiceChannelId !== event.channel_id) {
          const peer = state.friends?.friends?.find((f) => f.dm_channel_id === event.channel_id)?.user
            || (state.dmChannel?.id === event.channel_id ? state.dmPeer : null);
          renderDmCallBanner({ channelId: event.channel_id, peer });
          playNotifyChime('call');
          sendDesktopNotification(t('dm.incomingCall', { name: peer?.display_name || t('friends.dmHeader') }), t('dm.voiceCall'));
        } else {
          renderDmCallBanner(null);
        }
      }
      handleMeetingWsEvent(event, () => { renderSidebar(); renderVoicePanel(); renderVoiceBar(); });
      break;
    case 'rtc_signal':
    case 'meeting_state':
      handleMeetingWsEvent(event, () => { renderSidebar(); renderVoicePanel(); renderVoiceBar(); });
      break;
    default:
      break;
  }
}

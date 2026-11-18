/**
 * Shell renderers: server rail, channel sidebar, user panel, chat header,
 * member list, voice occupancy bar/panel, typing row, and reply bar.
 */

import { renderHomeSidebar } from './friends_ui.js';
import { t } from './i18n.js';
import { renderMeetingStage } from './meeting_ui.js';
import { resolveProfile } from './profile_helpers.js';
import { renderMessages } from './render_chat.js';
import { memberRoleFor, roleMeta } from './server_templates.js';
import {
  $,
  ICONS,
  STATUS_LIST,
  activityText,
  avatar,
  currentChannel,
  currentServer,
  escapeHtml,
  isOnline,
  myStatusDot,
  state,
  statusDotFor,
  statusLabel,
  userById,
  userStatusKey,
} from './state.js';

export function renderRail() {
  const reqCount = (state.friends?.incoming || []).length;
  const servers = state.servers.map((s) => {
    const unread = s.channels.reduce((total, c) => total + (state.unread.has(c.id) ? 1 : 0), 0);
    const accent = s.accent_color ? `style="--srv-accent:${escapeHtml(s.accent_color)}"` : '';
    const active = !state.homeMode && s.id === state.currentServerId;
    return `
    <button class="rail-btn ${active ? 'active' : ''} ${unread ? 'has-unread' : ''}"
            data-action="server" data-id="${escapeHtml(s.id)}" ${accent}
            title="${escapeHtml(s.name)}" data-tooltip="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}">
      <span class="rail-pill"></span>${escapeHtml(s.icon)}
      ${unread ? `<span class="rail-badge">${unread}</span>` : ''}
    </button>`;
  }).join('');
  $('rail').innerHTML = `
    <button class="rail-btn ${state.homeMode ? 'active' : ''}" data-action="friends" title="${escapeHtml(t('rail.friends'))}" data-tooltip="${escapeHtml(t('rail.friendsShort'))}" aria-label="${escapeHtml(t('rail.friendsShort'))}">
      <span class="rail-pill"></span>${ICONS.friends}
      ${reqCount ? `<span class="rail-badge">${reqCount}</span>` : ''}
    </button>
    <button class="rail-btn home" data-action="directory" title="${escapeHtml(t('rail.directory'))}" data-tooltip="${escapeHtml(t('rail.directory'))}" aria-label="${escapeHtml(t('rail.directory'))}">${ICONS.home}</button>
    <div class="rail-divider"></div>
    ${servers}
    <button class="rail-btn add" data-action="create-server" title="${escapeHtml(t('rail.createServer'))}" data-tooltip="${escapeHtml(t('rail.createServer'))}" aria-label="${escapeHtml(t('rail.createServer'))}">+</button>
    <button class="rail-btn theme" data-action="theme" title="${escapeHtml(t('rail.settings'))}" data-tooltip="${escapeHtml(t('rail.settings'))}" aria-label="${escapeHtml(t('rail.settings'))}">${ICONS.settings}</button>`;
}

export function renderVoicePanel() {
  renderMeetingStage(renderSidebar, renderUserPanel);
  const id = state.voiceChannelId || state.joinedVoiceChannelId;
  const channel = state.servers.flatMap((s) => s.channels).find((c) => c.id === id && c.kind === 'voice');
  if (!id || !channel) {
    $('voicePanel').hidden = true;
    return;
  }
  $('voicePanel').hidden = false;
  const users = state.voice[id] || [];
  const joined = state.me && users.includes(state.me.id);
  $('voicePanel').innerHTML = `
    <div class="vp-title"><span>${ICONS.voice} ${escapeHtml(channel.name)}</span><span>${escapeHtml(t('voice.peopleCount', { count: users.length }))}</span></div>
    <div class="vp-users">${users.length
      ? users.map((uid) => `${avatar(userById(uid), 'xs')} ${escapeHtml(userById(uid).display_name)}`).join('<br />')
      : escapeHtml(t('voice.empty'))}</div>
    <div class="vp-buttons">
      <button class="vp-join" data-action="${joined ? 'voice-leave' : 'voice-join'}" data-id="${escapeHtml(id)}">
        ${escapeHtml(joined ? t('voice.leave') : t('voice.join'))}
      </button>
      ${joined ? `
        <button class="vp-icon ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${escapeHtml(state.muted ? t('voice.unmuteMic') : t('voice.muteMic'))}">${ICONS.mic}</button>
        <button class="vp-icon ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${escapeHtml(state.deafened ? t('voice.undeafen') : t('voice.deafen'))}">${ICONS.headphones}</button>` : ''}
    </div>
    <div class="vp-note">${escapeHtml(state.meetingDataSaver ? t('voice.dataSaverMode') : t('voice.hdMode'))}</div>`;
}

export function renderVoiceBar() {
  const entry = Object.entries(state.voice).find(([, users]) => state.me && users.includes(state.me.id));
  if (!entry) { $('voiceBar').hidden = true; return; }
  const [channelId] = entry;
  const channel = state.servers.flatMap((s) => s.channels).find((c) => c.id === channelId);
  $('voiceBar').hidden = false;
  $('voiceBar').innerHTML = `
    <button type="button" class="vb-row" data-action="focus-voice-room" data-id="${escapeHtml(channelId)}" title="${escapeHtml(t('voice.openRoom'))}" style="text-align:left;min-width:0;flex:1">
      <span class="vb-signal"><i></i><i></i><i></i></span>
      <span class="vb-info"><b>${escapeHtml(t('voice.connected'))} · ${escapeHtml(state.meetingDataSaver ? t('voice.saverShort') : t('voice.hdShort'))}</b><span>${escapeHtml(channel?.name || t('voice.roomFallback'))}</span></span>
    </button>
    <div class="vb-actions">
      <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${escapeHtml(t('voice.micLabel'))}">${ICONS.mic}</button>
      <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${escapeHtml(t('voice.speakerLabel'))}">${ICONS.headphones}</button>
      <button class="icon-btn" data-action="voice-leave" data-id="${escapeHtml(channelId)}" title="${escapeHtml(t('voice.leave'))}">${ICONS.logout}</button>
    </div>`;
}

export function renderSidebar() {
  if (state.homeMode) {
    renderHomeSidebar();
    renderVoicePanel();
    renderVoiceBar();
    return;
  }
  const server = currentServer();
  if (!server) {
    $('serverHeader').innerHTML = `<span class="server-name">${escapeHtml(t('sidebar.noServer'))}</span>`;
    $('channelList').innerHTML = `<div class="group-head">${escapeHtml(t('sidebar.noServerHint'))}</div>`;
    $('voiceBar').hidden = true;
    return;
  }
  const canCreate = ['owner', 'admin'].includes(server.role) || server.roles_config?.allow_member_create_channel !== false;
  $('serverHeader').innerHTML = `
    <button class="server-name" data-action="server-menu" title="${escapeHtml(server.description || t('sidebar.serverMenu'))}" aria-label="${escapeHtml(t('sidebar.serverMenu'))}">
      ${escapeHtml(server.name)} <span class="caret">${ICONS.caret}</span>
    </button>
    ${canCreate ? `<button class="icon-btn" data-action="create-channel" title="${escapeHtml(t('sidebar.addChannel'))}" aria-label="${escapeHtml(t('sidebar.addChannel'))}">${ICONS.plus}</button>` : ''}`;

  const textChannels = server.channels.filter((c) => c.kind === 'text');
  const voiceChannels = server.channels.filter((c) => c.kind === 'voice');
  const channelRow = (c) => {
    const active = c.id === state.currentChannelId || c.id === state.voiceChannelId;
    const voiceUsers = state.voice[c.id] || [];
    const unread = state.unread.has(c.id);
    const mention = state.mentions.has(c.id);
    return `
      <div class="channel-row ${active ? 'active' : ''}">
        <button class="channel-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}" data-action="channel" data-id="${escapeHtml(c.id)}">
          <span class="hash">${c.kind === 'text' ? '#' : ICONS.voice}</span>
          <span class="ch-name">${escapeHtml(c.name)}</span>
          ${mention ? '<span class="mention-badge">1</span>' : unread ? '<span class="unread-dot"></span>' : ''}
          ${voiceUsers.length ? `<span class="voice-count">${voiceUsers.length}</span>` : ''}
        </button>
        <span class="ch-actions">
          <button data-action="channel-info" data-id="${escapeHtml(c.id)}" title="${escapeHtml(t('sidebar.channelInfo'))}" aria-label="${escapeHtml(t('sidebar.channelInfo'))}">${ICONS.info}</button>
          <button data-action="channel-copy" data-id="${escapeHtml(c.id)}" title="${escapeHtml(t('sidebar.copyChannel'))}" aria-label="${escapeHtml(t('sidebar.copyChannel'))}">${ICONS.copy}</button>
        </span>
      </div>
      ${voiceUsers.map((id) => {
        const vp = resolveProfile(id, server);
        return `
        <button class="voice-user" data-action="profile" data-id="${escapeHtml(id)}">
          ${avatar(vp, 'xs')} ${escapeHtml(vp.display_name)}
        </button>`;
      }).join('')}`;
  };
  const group = (key, label, channels) => {
    const collapsed = state.collapsed.has(key);
    return `
      <div class="channel-group">
        <div class="group-head">
          <button class="group-toggle" data-action="toggle-group" data-group="${key}" title="${escapeHtml(collapsed ? t('sidebar.expandGroup') : t('sidebar.collapseGroup'))}">
            <span class="caret ${collapsed ? 'closed' : ''}">${ICONS.caret}</span>${escapeHtml(label)}${collapsed && channels.length ? `<span class="group-count">${channels.length}</span>` : ''}
          </button>
          ${canCreate ? `<button data-action="create-channel" data-kind="${key}" title="${escapeHtml(t('sidebar.addChannel'))}" aria-label="${escapeHtml(t('sidebar.addChannel'))}">+</button>` : ''}
        </div>
        ${collapsed ? '' : (channels.map(channelRow).join('') || `<div class="channel-empty">${escapeHtml(t('sidebar.noChannels'))}</div>`)}
      </div>`;
  };

  $('channelList').innerHTML = group('text', t('sidebar.textChannels'), textChannels) + group('voice', t('sidebar.voiceChannels'), voiceChannels);
  renderVoicePanel();
  renderVoiceBar();
}

export function renderUserPanel() {
  if (!state.me) return;
  const status = STATUS_LIST.find((s) => s.key === state.myStatus) || STATUS_LIST[0];
  const meProf = resolveProfile(state.me);
  const subStatus = state.me.status_text || statusLabel(status.key);
  $('userPanel').innerHTML = `
    <button class="user-identity" data-action="my-status" title="${escapeHtml(t('status.changeTitle'))}">
      <span class="avatar-wrap">${avatar(meProf, 'sm')}<span class="status-dot ${status.dot}"></span></span>
      <span class="who"><b>${escapeHtml(meProf.display_name)}</b><span>${escapeHtml(subStatus)}</span></span>
    </button>
    <span class="user-controls">
      <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${escapeHtml(state.muted ? t('voice.unmuteMic') : t('voice.muteMic'))}" aria-label="${escapeHtml(t('voice.micLabel'))}">${ICONS.mic}</button>
      <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${escapeHtml(state.deafened ? t('voice.undeafen') : t('voice.deafen'))}" aria-label="${escapeHtml(t('voice.speakerLabel'))}">${ICONS.headphones}</button>
      <button class="icon-btn" data-action="open-settings" title="${escapeHtml(t('settings.title'))}" aria-label="${escapeHtml(t('rail.settings'))}">${ICONS.settings}</button>
      <button class="icon-btn" data-action="logout" title="${escapeHtml(t('settings.logoutBtn'))}" aria-label="${escapeHtml(t('settings.logoutBtn'))}">${ICONS.logout}</button>
    </span>`;
}

export function renderHeader() {
  const sidebarOpen = $('sidebar')?.classList.contains('mobile-open');
  if (state.homeMode) {
    const peer = state.dmPeer;
    $('chatHeader').innerHTML = `
      <button class="icon-btn mobile-only" data-action="toggle-sidebar" title="${escapeHtml(t('header.channels'))}" aria-label="${escapeHtml(t('header.openChannels'))}" aria-controls="sidebar" aria-expanded="${sidebarOpen ? 'true' : 'false'}">${ICONS.menu}</button>
      <span class="big-hash">@</span>
      <span class="title">${escapeHtml(peer ? peer.display_name : t('friends.dmHeader'))}</span>
      <span class="topic">${escapeHtml(peer ? t('friends.dmTopic', { username: peer.username }) : t('friends.manageHint'))}</span>`;
    return;
  }
  const channel = state.voiceChannelId
    ? currentServer()?.channels.find((c) => c.id === state.voiceChannelId) || currentChannel()
    : currentChannel();
  if (!channel) { $('chatHeader').innerHTML = ''; return; }
  $('chatHeader').innerHTML = `
    <button class="icon-btn mobile-only" data-action="toggle-sidebar" title="${escapeHtml(t('header.channels'))}" aria-label="${escapeHtml(t('header.openChannels'))}" aria-controls="sidebar" aria-expanded="${sidebarOpen ? 'true' : 'false'}">${ICONS.menu}</button>
    <span class="big-hash">${channel.kind === 'text' ? '#' : ICONS.voice}</span>
    <span class="title">${escapeHtml(channel.name)}</span>
    <span class="topic">${escapeHtml(channel.topic || '')}</span>
    <span class="spacer"></span>
    <div class="header-actions">
      ${state.searchOpen ? `<input id="searchInput" class="search-input" type="text" placeholder="${escapeHtml(t('header.searchPlaceholder'))}" value="${escapeHtml(state.search)}" aria-label="${escapeHtml(t('header.searchAria'))}" />` : ''}
      <button class="icon-btn ${state.searchOpen ? 'active' : ''}" data-action="toggle-search" title="${escapeHtml(t('header.searchTitle'))}" aria-label="${escapeHtml(t('header.searchAria'))}">${ICONS.search}</button>
      <button class="icon-btn ${state.membersVisible ? 'active' : ''}" data-action="toggle-members" title="${escapeHtml(t('header.membersTitle'))}" aria-label="${escapeHtml(t('header.membersAria'))}">${ICONS.members}</button>
    </div>`;
  if (state.searchOpen) {
    const input = $('searchInput');
    input.addEventListener('input', () => {
      state.search = input.value.trim();
      renderMessages();
    });
    input.focus();
  }
}

export function renderMembers() {
  const server = currentServer();
  if (!server) { $('memberList').innerHTML = ''; return; }
  const online = server.members.filter((m) => isOnline(m.id));
  const offline = server.members.filter((m) => !isOnline(m.id));
  const row = (rawMember) => {
    const m = resolveProfile(rawMember, server);
    const on = isOnline(m.id);
    const isMe = state.me && m.id === state.me.id;
    const dot = isMe ? myStatusDot() : (on ? statusDotFor(userStatusKey(m.id)) : '');
    const rKey = memberRoleFor(server, m.id);
    const rMeta = roleMeta(server, rKey);
    const showBadge = rKey === 'owner' || rKey === 'admin';
    const subLine = m.status_text || (on ? activityText(m.id) : '');
    return `
    <button class="member ${on ? 'online' : ''}" data-action="profile" data-id="${escapeHtml(m.id)}">
      <span class="avatar-wrap">${avatar(m, 'sm')}<span class="status-dot ${dot}"></span></span>
      <span class="who">
        <span class="m-name" style="${showBadge ? `color:${rMeta.color}` : ''}">${escapeHtml(m.display_name)}</span>
        ${subLine ? `<span class="m-activity">${escapeHtml(subLine)}</span>` : ''}
      </span>
      ${showBadge ? `<span class="member-role" style="background:${rMeta.color}" title="${escapeHtml(rMeta.label)}"></span>` : ''}
      ${m.bot ? `<span class="bot-tag">${escapeHtml(t('common.bot'))}</span>` : ''}
      ${isMe ? `<span class="you">${escapeHtml(t('common.you'))}</span>` : ''}
    </button>`;
  };
  $('memberList').innerHTML = `
    <div class="member-group">${escapeHtml(t('members.onlineCount', { count: online.length }))}</div>${online.map(row).join('')}
    <div class="member-group">${escapeHtml(t('members.offlineCount', { count: offline.length }))}</div>${offline.map(row).join('')}`;
}

export function renderTyping() {
  const entries = [...state.typing.entries()];
  const names = entries.map(([, name]) => name);
  $('typingRow').innerHTML = names.length
    ? `<span class="typing-avatars">${entries.slice(0, 3).map(([id]) => avatar(userById(id), 'xs')).join('')}</span>
       <span class="typing-dots"><i></i><i></i><i></i></span>
       <span><b>${escapeHtml(names.slice(0, 3).join(', '))}</b>${names.length > 3 ? escapeHtml(t('typing.more', { count: names.length - 3 })) : ''}${escapeHtml(t('typing.isTyping'))}</span>`
    : '';
}

export function renderReplyBar() {
  const target = state.replyTo;
  if (!target) { $('replyBar').hidden = true; return; }
  $('replyBar').hidden = false;
  $('replyBar').innerHTML = `
    <span class="rb-icon">${ICONS.reply}</span>
    <span class="rb-text">${escapeHtml(t('chat.replyingTo'))} <b>${escapeHtml(target.author.display_name)}</b>
      <span class="rb-preview">${escapeHtml(target.content.slice(0, 90))}</span></span>
    <button class="rb-close" data-action="cancel-reply" title="${escapeHtml(t('chat.cancelReply'))}" aria-label="${escapeHtml(t('common.cancel'))}">${ICONS.close}</button>`;
}

/**
 * Shell renderers: server rail, channel sidebar, user panel, chat header,
 * member list, voice occupancy bar/panel, typing row, and reply bar.
 */

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
  userById,
  userStatusKey,
} from './state.js';
import { renderMessages } from './render_chat.js';
import { memberRoleFor, roleMeta } from './server_templates.js';

export function renderRail() {
  const servers = state.servers.map((s) => {
    const unread = s.channels.reduce((total, c) => total + (state.unread.has(c.id) ? 1 : 0), 0);
    const accent = s.accent_color ? `style="--srv-accent:${escapeHtml(s.accent_color)}"` : '';
    return `
    <button class="rail-btn ${s.id === state.currentServerId ? 'active' : ''} ${unread ? 'has-unread' : ''}"
            data-action="server" data-id="${escapeHtml(s.id)}" ${accent}
            title="${escapeHtml(s.name)}" data-tooltip="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}">
      <span class="rail-pill"></span>${escapeHtml(s.icon)}
      ${unread ? `<span class="rail-badge">${unread}</span>` : ''}
    </button>`;
  }).join('');
  $('rail').innerHTML = `
    <button class="rail-btn home" data-action="directory" title="ค้นหาเซิร์ฟเวอร์" data-tooltip="ค้นหาเซิร์ฟเวอร์" aria-label="ค้นหาเซิร์ฟเวอร์">${ICONS.home}</button>
    <div class="rail-divider"></div>
    ${servers}
    <button class="rail-btn add" data-action="create-server" title="สร้างเซิร์ฟเวอร์" data-tooltip="สร้างเซิร์ฟเวอร์" aria-label="สร้างเซิร์ฟเวอร์">+</button>
    <button class="rail-btn theme" data-action="theme" title="ปรับแต่งธีมและตั้งค่า" data-tooltip="ปรับแต่งธีมและตั้งค่า" aria-label="ปรับแต่งธีมและตั้งค่า">${ICONS.settings}</button>`;
}

export function renderVoicePanel() {
  const id = state.voiceChannelId;
  const channel = currentServer()?.channels.find((c) => c.id === id);
  if (!id || !channel || channel.kind !== 'voice') {
    $('voicePanel').hidden = true;
    return;
  }
  $('voicePanel').hidden = false;
  const users = state.voice[id] || [];
  const joined = state.me && users.includes(state.me.id);
  $('voicePanel').innerHTML = `
    <div class="vp-title"><span>${ICONS.voice} ${escapeHtml(channel.name)}</span><span>${users.length} คน</span></div>
    <div class="vp-users">${users.length
      ? users.map((uid) => `${avatar(userById(uid), 'xs')} ${escapeHtml(userById(uid).display_name)}`).join('<br />')
      : 'ยังไม่มีใครอยู่ในห้องนี้'}</div>
    <div class="vp-buttons">
      <button class="vp-join" data-action="${joined ? 'voice-leave' : 'voice-join'}" data-id="${escapeHtml(id)}">
        ${joined ? 'ออกจากห้องเสียง' : 'เข้าร่วมห้องเสียง'}
      </button>
      ${joined ? `
        <button class="vp-icon ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${state.muted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'}">${ICONS.mic}</button>
        <button class="vp-icon ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${state.deafened ? 'เปิดเสียง' : 'ปิดเสียง'}">${ICONS.headphones}</button>` : ''}
    </div>
    <div class="vp-note">ตอนนี้แสดงรายชื่อคนในห้อง ยังไม่รองรับการคุยด้วยเสียง</div>`;
}

export function renderVoiceBar() {
  const entry = Object.entries(state.voice).find(([, users]) => state.me && users.includes(state.me.id));
  if (!entry) { $('voiceBar').hidden = true; return; }
  const [channelId] = entry;
  const channel = state.servers.flatMap((s) => s.channels).find((c) => c.id === channelId);
  $('voiceBar').hidden = false;
  $('voiceBar').innerHTML = `
    <div class="vb-row">
      <span class="vb-signal"><i></i><i></i><i></i></span>
      <span class="vb-info"><b>เชื่อมต่อแล้ว</b><span>${escapeHtml(channel?.name || 'ห้องเสียง')}</span></span>
    </div>
    <div class="vb-actions">
      <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="ไมโครโฟน">${ICONS.mic}</button>
      <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="หูฟัง">${ICONS.headphones}</button>
      <button class="icon-btn" data-action="voice-leave" data-id="${escapeHtml(channelId)}" title="ออกจากห้องเสียง">${ICONS.logout}</button>
    </div>`;
}

export function renderSidebar() {
  const server = currentServer();
  if (!server) {
    $('serverHeader').innerHTML = '<span class="server-name">ยังไม่มีเซิร์ฟเวอร์</span>';
    $('channelList').innerHTML = '<div class="group-head">กด + เพื่อสร้างเซิร์ฟเวอร์แรก</div>';
    $('voiceBar').hidden = true;
    return;
  }
  const canCreate = ['owner', 'admin'].includes(server.role) || server.roles_config?.allow_member_create_channel !== false;
  $('serverHeader').innerHTML = `
    <button class="server-name" data-action="server-menu" title="${escapeHtml(server.description || 'เมนูเซิร์ฟเวอร์')}" aria-label="เมนูเซิร์ฟเวอร์">
      ${escapeHtml(server.name)} <span class="caret">${ICONS.caret}</span>
    </button>
    ${canCreate ? `<button class="icon-btn" data-action="create-channel" title="เพิ่มช่อง" aria-label="เพิ่มช่อง">${ICONS.plus}</button>` : ''}`;

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
          <button data-action="channel-info" data-id="${escapeHtml(c.id)}" title="รายละเอียดช่อง" aria-label="รายละเอียดช่อง">${ICONS.info}</button>
          <button data-action="channel-copy" data-id="${escapeHtml(c.id)}" title="คัดลอกชื่อช่อง" aria-label="คัดลอกชื่อช่อง">${ICONS.copy}</button>
        </span>
      </div>
      ${voiceUsers.map((id) => `
        <button class="voice-user" data-action="profile" data-id="${escapeHtml(id)}">
          ${avatar(userById(id), 'xs')} ${escapeHtml(userById(id).display_name)}
        </button>`).join('')}`;
  };
  const group = (key, label, channels) => {
    const collapsed = state.collapsed.has(key);
    return `
      <div class="channel-group">
        <div class="group-head">
          <button class="group-toggle" data-action="toggle-group" data-group="${key}" title="${collapsed ? 'ขยาย' : 'ยุบ'}หมวดหมู่">
            <span class="caret ${collapsed ? 'closed' : ''}">${ICONS.caret}</span>${label}${collapsed && channels.length ? `<span class="group-count">${channels.length}</span>` : ''}
          </button>
          ${canCreate ? `<button data-action="create-channel" data-kind="${key}" title="เพิ่มช่อง" aria-label="เพิ่มช่อง">+</button>` : ''}
        </div>
        ${collapsed ? '' : (channels.map(channelRow).join('') || '<div class="channel-empty">— ยังไม่มีช่อง —</div>')}
      </div>`;
  };

  $('channelList').innerHTML = group('text', 'ช่องข้อความ', textChannels) + group('voice', 'ช่องเสียง', voiceChannels);
  renderVoicePanel();
  renderVoiceBar();
}

export function renderUserPanel() {
  if (!state.me) return;
  const status = STATUS_LIST.find((s) => s.key === state.myStatus) || STATUS_LIST[0];
  $('userPanel').innerHTML = `
    <button class="user-identity" data-action="my-status" title="เปลี่ยนสถานะ">
      <span class="avatar-wrap">${avatar(state.me, 'sm')}<span class="status-dot ${status.dot}"></span></span>
      <span class="who"><b>${escapeHtml(state.me.display_name)}</b><span>${status.label}</span></span>
    </button>
    <span class="user-controls">
      <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${state.muted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'}" aria-label="ไมโครโฟน">${ICONS.mic}</button>
      <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${state.deafened ? 'เปิดเสียง' : 'ปิดเสียง'}" aria-label="หูฟัง">${ICONS.headphones}</button>
      <button class="icon-btn" data-action="open-settings" title="ตั้งค่าผู้ใช้และธีม" aria-label="ตั้งค่า">${ICONS.settings}</button>
      <button class="icon-btn" data-action="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${ICONS.logout}</button>
    </span>`;
}

export function renderHeader() {
  const channel = currentChannel();
  if (!channel) { $('chatHeader').innerHTML = ''; return; }
  const sidebarOpen = $('sidebar')?.classList.contains('mobile-open');
  $('chatHeader').innerHTML = `
    <button class="icon-btn mobile-only" data-action="toggle-sidebar" title="รายการช่อง" aria-label="เปิดรายการช่อง" aria-controls="sidebar" aria-expanded="${sidebarOpen ? 'true' : 'false'}">${ICONS.menu}</button>
    <span class="big-hash">${channel.kind === 'text' ? '#' : ICONS.voice}</span>
    <span class="title">${escapeHtml(channel.name)}</span>
    <span class="topic">${escapeHtml(channel.topic || '')}</span>
    <span class="spacer"></span>
    <div class="header-actions">
      ${state.searchOpen ? `<input id="searchInput" class="search-input" type="text" placeholder="ค้นหาข้อความ..." value="${escapeHtml(state.search)}" aria-label="ค้นหาข้อความ" />` : ''}
      <button class="icon-btn ${state.searchOpen ? 'active' : ''}" data-action="toggle-search" title="ค้นหาในช่องนี้" aria-label="ค้นหา">${ICONS.search}</button>
      <button class="icon-btn ${state.membersVisible ? 'active' : ''}" data-action="toggle-members" title="แสดง/ซ่อนรายชื่อสมาชิก" aria-label="สมาชิก">${ICONS.members}</button>
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
  const row = (m) => {
    const on = isOnline(m.id);
    const isMe = state.me && m.id === state.me.id;
    const dot = isMe ? myStatusDot() : (on ? statusDotFor(userStatusKey(m.id)) : '');
    const rKey = memberRoleFor(server, m.id);
    const rMeta = roleMeta(server, rKey);
    const showBadge = rKey === 'owner' || rKey === 'admin';
    return `
    <button class="member ${on ? 'online' : ''}" data-action="profile" data-id="${escapeHtml(m.id)}">
      <span class="avatar-wrap">${avatar(m, 'sm')}<span class="status-dot ${dot}"></span></span>
      <span class="who">
        <span class="m-name" style="${showBadge ? `color:${rMeta.color}` : ''}">${escapeHtml(m.display_name)}</span>
        ${on ? `<span class="m-activity">${escapeHtml(activityText(m.id))}</span>` : ''}
      </span>
      ${showBadge ? `<span class="member-role" style="background:${rMeta.color}" title="${escapeHtml(rMeta.label)}"></span>` : ''}
      ${m.bot ? '<span class="bot-tag">bot</span>' : ''}
      ${isMe ? '<span class="you">คุณ</span>' : ''}
    </button>`;
  };
  $('memberList').innerHTML = `
    <div class="member-group">ออนไลน์ — ${online.length}</div>${online.map(row).join('')}
    <div class="member-group">ออฟไลน์ — ${offline.length}</div>${offline.map(row).join('')}`;
}

export function renderTyping() {
  const entries = [...state.typing.entries()];
  const names = entries.map(([, name]) => name);
  $('typingRow').innerHTML = names.length
    ? `<span class="typing-avatars">${entries.slice(0, 3).map(([id]) => avatar(userById(id), 'xs')).join('')}</span>
       <span class="typing-dots"><i></i><i></i><i></i></span>
       <span><b>${escapeHtml(names.slice(0, 3).join(', '))}</b>${names.length > 3 ? ` และอีก ${names.length - 3} คน` : ''} กำลังพิมพ์…</span>`
    : '';
}

export function renderReplyBar() {
  const target = state.replyTo;
  if (!target) { $('replyBar').hidden = true; return; }
  $('replyBar').hidden = false;
  $('replyBar').innerHTML = `
    <span class="rb-icon">${ICONS.reply}</span>
    <span class="rb-text">ตอบกลับ <b>${escapeHtml(target.author.display_name)}</b>
      <span class="rb-preview">${escapeHtml(target.content.slice(0, 90))}</span></span>
    <button class="rb-close" data-action="cancel-reply" title="ยกเลิกการตอบกลับ" aria-label="ยกเลิก">${ICONS.close}</button>`;
}

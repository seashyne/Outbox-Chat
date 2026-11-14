/* Outbox Chat — vanilla JS client. No build step, no framework. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    token: localStorage.getItem('ob_token') || '',
    me: null,
    servers: [],
    online: new Set(),
    voice: {},
    unread: new Set(),
    mentions: new Set(),
    currentServerId: null,
    currentChannelId: null,
    voiceChannelId: null,
    messages: [],
    typing: new Map(),
    typingTimers: new Map(),
    ws: null,
    reconnectTimer: null,
    lastTypingSent: 0,
    replyTo: null,
    search: '',
    searchOpen: false,
    collapsed: new Set(),
    muted: false,
    deafened: false,
    myStatus: 'online',
    membersVisible: true,
    popover: null,
    emojiTarget: null,
  };

  const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '🔥', '💜', '😮', '😢', '🤔', '✅', '🚀', '☕', '👋', '⭐', '💯', '🥳', '😅', '🤝', '💡', '📌', '🐛', '✨'];
  const EMOJI_GRID = QUICK_EMOJIS;
  const STATUS_LIST = [
    { key: 'online', label: 'ออนไลน์', dot: 'online' },
    { key: 'idle', label: 'ไม่อยู่', dot: 'idle' },
    { key: 'dnd', label: 'ห้ามรบกวน', dot: 'dnd' },
    { key: 'invisible', label: 'ซ่อนตัว', dot: '' },
  ];

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  const safeColor = (c) => /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#5865f2';
  const initials = (name) => String(name || '?').trim().slice(0, 2).toUpperCase();
  const avatar = (user, size = '') =>
    `<span class="avatar ${size}" style="background:${safeColor(user.color)}">${escapeHtml(initials(user.display_name))}</span>`;
  const avatarWithStatus = (user, online, size = 'sm') =>
    `<span class="avatar-wrap">${avatar(user, size)}<span class="status-dot ${online ? 'online' : ''}"></span></span>`;

  const currentServer = () => state.servers.find((s) => s.id === state.currentServerId);
  const currentChannel = () => currentServer()?.channels.find((c) => c.id === state.currentChannelId);
  const userById = (id) =>
    currentServer()?.members.find((m) => m.id === id) ||
    (state.me && state.me.id === id ? state.me : null) ||
    { id, username: 'user', display_name: 'สมาชิก', color: '#5865f2', bot: false };

  function fmtTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtFull(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) return 'วันนี้';
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'เมื่อวาน';
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function statusLabel(key) {
    return (STATUS_LIST.find((s) => s.key === key) || STATUS_LIST[0]).label;
  }
  function myStatusDot() {
    const found = STATUS_LIST.find((s) => s.key === state.myStatus) || STATUS_LIST[0];
    return found.dot;
  }
  function closeOverlays() {
    $('overlay').hidden = true;
    $('profilePopout').hidden = true;
    $('dropdown').hidden = true;
    $('emojiPicker').hidden = true;
    state.popover = null;
  }
  function openOverlay(kind) {
    $('profilePopout').hidden = true;
    $('dropdown').hidden = true;
    if (kind !== 'emoji') $('emojiPicker').hidden = true;
    $('overlay').hidden = false;
    state.popover = kind;
  }
  function positionPopout(anchor, node, preferred = 'right') {
    const rect = anchor.getBoundingClientRect();
    node.hidden = false;
    const width = node.offsetWidth || 260;
    const height = node.offsetHeight || 200;
    let left = preferred === 'right' ? rect.right + 10 : rect.left - width - 10;
    let top = rect.top;
    if (left + width > window.innerWidth - 8) left = rect.left - width - 10;
    if (left < 8) left = 8;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    if (top < 8) top = 8;
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  /** Escape first, then apply a tiny, deliberately limited markdown subset. */
  function formatContent(raw, query = '') {
    let formatted = escapeHtml(raw)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)@([\p{L}\p{N}._-]+)/gu, '$1<span class="mention">@$2</span>')
      .replace(/https?:\/\/[^\s<]+/g, (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    if (query) {
      const pattern = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${pattern})`, 'gi');
      formatted = formatted
        .split(/(<[^>]+>)/g)
        .map((part, idx) => (idx % 2 === 0 ? part.replace(regex, '<mark class="hit">$1</mark>') : part))
        .join('');
    }
    return formatted;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    if (response.status === 401) {
      const error = new Error('session expired');
      error.unauthorized = true;
      throw error;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'ทำรายการไม่สำเร็จ');
    }
    return response.status === 204 ? null : response.json();
  }

  function toast(message, kind = '') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    $('toastStack').appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function handleError(error) {
    if (error.unauthorized) { logout(true); return; }
    toast(error.message || 'เกิดข้อผิดพลาด', 'err');
  }

  function setConn(status, label) {
    const el = $('connStatus');
    el.className = `conn-status ${status}`;
    el.textContent = label;
  }

  // ------------------------------------------------------------- interactions
  function setReply(messageId) {
    const message = state.messages.find((m) => m.id === messageId);
    if (!message) return;
    state.replyTo = message;
    renderReplyBar();
    $('messageInput').focus();
  }
  function clearReply() {
    state.replyTo = null;
    renderReplyBar();
  }

  async function toggleReaction(messageId, emoji) {
    try {
      const updated = await api(`/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST', body: JSON.stringify({ emoji }),
      });
      const index = state.messages.findIndex((m) => m.id === messageId);
      if (index !== -1) state.messages[index] = updated;
      renderMessages();
    } catch (error) { handleError(error); }
  }

  function positionMenu(anchor, node) {
    const rect = anchor.getBoundingClientRect();
    node.hidden = false;
    const width = node.offsetWidth || 230;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = rect.bottom + 6;
    if (top + node.offsetHeight > window.innerHeight - 8) top = rect.top - node.offsetHeight - 6;
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }

  function openEmojiPicker(anchor, target) {
    state.emojiTarget = target;
    const picker = $('emojiPicker');
    picker.innerHTML = `
      <div class="ep-head">${target.type === 'reaction' ? 'เพิ่มปฏิกิริยา' : 'เลือกอีโมจิ'}</div>
      <div class="ep-grid">${EMOJI_GRID.map((emoji) =>
        `<button data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(emoji)}">${emoji}</button>`).join('')}</div>`;
    const rect = anchor.getBoundingClientRect();
    picker.hidden = false;
    const width = picker.offsetWidth || 280;
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = rect.top - picker.offsetHeight - 10;
    if (top < 8) top = rect.bottom + 10;
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    openOverlay('emoji');
  }

  function pickEmoji(emoji) {
    const target = state.emojiTarget;
    closeOverlays();
    if (!target || !emoji) return;
    if (target.type === 'reaction') {
      toggleReaction(target.messageId, emoji);
    } else {
      const input = $('messageInput');
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
      autoGrow();
    }
  }

  function openProfile(userId, anchor) {
    const user = userById(userId);
    const server = currentServer();
    const online = state.online.has(userId);
    const isMe = state.me && userId === state.me.id;
    const role = userId === server?.owner_id ? 'เจ้าของเซิร์ฟเวอร์' : user.bot ? 'บอท' : 'สมาชิก';
    const node = $('profilePopout');
    node.innerHTML = `
      <div class="pp-banner" style="background:${safeColor(user.color)}"></div>
      <div class="pp-avatar"><span class="avatar-wrap">${avatar(user, 'lg')}<span class="status-dot ${isMe ? myStatusDot() : (online ? 'online' : '')}"></span></span></div>
      <div class="pp-body">
        <b class="pp-name">${escapeHtml(user.display_name)}</b>
        <span class="pp-username">${escapeHtml(user.username)}</span>
        ${user.bot ? '<span class="bot-tag">bot</span>' : ''}
        <div class="pp-divider"></div>
        <div class="pp-label">ตำแหน่ง</div><div class="pp-value">${role}</div>
        <div class="pp-label">สถานะ</div><div class="pp-value">${isMe ? statusLabel(state.myStatus) : (online ? 'ออนไลน์' : 'ออฟไลน์')}</div>
        ${!isMe ? `
          <button class="pp-action" data-action="mention-user" data-id="${escapeHtml(userId)}">กล่าวถึงในข้อความ</button>
          <button class="pp-action ghost" data-action="reply-to-user" data-id="${escapeHtml(userId)}">ตอบกลับข้อความล่าสุด</button>` : ''}
      </div>`;
    openOverlay('profile');
    positionPopout(anchor, node);
  }

  function openDropdown(html, anchor) {
    const node = $('dropdown');
    node.innerHTML = html;
    openOverlay('dropdown');
    positionMenu(anchor, node);
  }

  function openServerMenu(anchor) {
    openDropdown(`
      <button data-action="create-channel">＋ <span>สร้างช่องใหม่</span></button>
      <button data-action="directory">🔍 <span>ค้นหาเซิร์ฟเวอร์</span></button>
      <button data-action="copy-server">⧉ <span>คัดลอกชื่อเซิร์ฟเวอร์</span></button>
      <div class="dd-sep"></div>
      <button data-action="toggle-members">👥 <span>${state.membersVisible ? 'ซ่อน' : 'แสดง'}รายชื่อสมาชิก</span></button>
      <button data-action="toggle-theme">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'} <span>สลับธีม</span></button>`, anchor);
  }

  function openStatusMenu(anchor) {
    openDropdown(`
      <div class="dd-title">ตั้งสถานะของคุณ</div>
      ${STATUS_LIST.map((s) => `
        <button data-action="set-status" data-status="${s.key}" class="${state.myStatus === s.key ? 'selected' : ''}">
          <span class="status-dot ${s.dot} dd-dot"></span><span>${s.label}</span>${state.myStatus === s.key ? '<b>✓</b>' : ''}
        </button>`).join('')}`, anchor);
  }

  function openChannelInfo(channelId, anchor) {
    const channel = currentServer()?.channels.find((c) => c.id === channelId);
    if (!channel) return;
    openDropdown(`
      <div class="dd-title">${channel.kind === 'text' ? '#' : '🔊'} ${escapeHtml(channel.name)}</div>
      <div class="dd-info">${escapeHtml(channel.topic || 'ไม่มีหัวข้อ')}</div>
      <div class="dd-sep"></div>
      <button data-action="channel-copy" data-id="${escapeHtml(channelId)}">⧉ <span>คัดลอกชื่อช่อง</span></button>
      <button data-action="channel-mark-read" data-id="${escapeHtml(channelId)}">✓ <span>ทำเครื่องหมายว่าอ่านแล้ว</span></button>`, anchor);
  }

  function toggleSearch() {
    state.searchOpen = !state.searchOpen;
    if (!state.searchOpen) state.search = '';
    renderHeader();
    renderMessages();
    if (!state.searchOpen) scrollToBottom();
  }
  function clearSearch() {
    state.search = '';
    state.searchOpen = false;
    renderHeader();
    renderMessages();
    scrollToBottom();
  }
  function insertMention(userId) {
    const user = userById(userId);
    const input = $('messageInput');
    const mention = `@${user.username} `;
    input.value += (input.value && !input.value.endsWith(' ') ? ' ' : '') + mention;
    input.focus();
    autoGrow();
    closeOverlays();
  }
  function updateCharCount() {
    const length = $('messageInput').value.length;
    const node = $('charCount');
    node.hidden = length < 1800;
    node.textContent = `${2000 - length}`;
    node.className = `char-count ${length > 1950 ? 'danger' : length > 1900 ? 'warn' : ''}`;
  }
  function updateJumpButton() {
    const el = $('messageScroll');
    $('jumpBtn').hidden = state.searchOpen || el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  }

  // ---------------------------------------------------------------- rendering
  function renderRail() {
    const servers = state.servers.map((s) => {
      const unread = s.channels.reduce((total, c) => total + (state.unread.has(c.id) ? 1 : 0), 0);
      return `
      <button class="rail-btn ${s.id === state.currentServerId ? 'active' : ''} ${unread ? 'has-unread' : ''}"
              data-action="server" data-id="${escapeHtml(s.id)}"
              data-tooltip="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}">
        <span class="rail-pill"></span>${escapeHtml(s.icon)}
        ${unread ? `<span class="rail-badge">${unread}</span>` : ''}
      </button>`;
    }).join('');
    $('rail').innerHTML = `
      <button class="rail-btn home" data-action="directory" data-tooltip="ค้นหาเซิร์ฟเวอร์">💬</button>
      <div class="rail-divider"></div>
      ${servers}
      <button class="rail-btn add" data-action="create-server" data-tooltip="สร้างเซิร์ฟเวอร์">+</button>
      <button class="rail-btn theme" data-action="theme" data-tooltip="สลับธีม">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button>`;
  }

  function renderSidebar() {
    const server = currentServer();
    if (!server) {
      $('serverHeader').innerHTML = '<span class="server-name">ยังไม่มีเซิร์ฟเวอร์</span>';
      $('channelList').innerHTML = '<div class="group-head">กด + เพื่อสร้างเซิร์ฟเวอร์แรก</div>';
      $('voiceBar').hidden = true;
      return;
    }
    $('serverHeader').innerHTML = `
      <button class="server-name" data-action="server-menu" title="เมนูเซิร์ฟเวอร์" aria-label="เมนูเซิร์ฟเวอร์">
        ${escapeHtml(server.name)} <span class="caret">⌄</span>
      </button>
      <button class="icon-btn" data-action="create-channel" title="เพิ่มช่อง" aria-label="เพิ่มช่อง">＋</button>`;

    const textChannels = server.channels.filter((c) => c.kind === 'text');
    const voiceChannels = server.channels.filter((c) => c.kind === 'voice');
    const channelRow = (c) => {
      const active = c.id === state.currentChannelId || c.id === state.voiceChannelId;
      const voiceUsers = state.voice[c.id] || [];
      const unread = state.unread.has(c.id);
      const mention = state.mentions.has(c.id);
      return `
        <div class="channel-row ${active ? 'active' : ''}">
          <button class="channel-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}"
                  data-action="channel" data-id="${escapeHtml(c.id)}">
            <span class="hash">${c.kind === 'text' ? '#' : '🔊'}</span>
            <span class="ch-name">${escapeHtml(c.name)}</span>
            ${mention ? '<span class="mention-badge">1</span>' : unread ? '<span class="unread-dot"></span>' : ''}
            ${voiceUsers.length ? `<span class="voice-count">${voiceUsers.length}</span>` : ''}
          </button>
          <span class="ch-actions">
            <button data-action="channel-info" data-id="${escapeHtml(c.id)}" title="รายละเอียดช่อง" aria-label="รายละเอียดช่อง">ⓘ</button>
            <button data-action="channel-copy" data-id="${escapeHtml(c.id)}" title="คัดลอกชื่อช่อง" aria-label="คัดลอกชื่อช่อง">⧉</button>
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
              <span class="caret ${collapsed ? 'closed' : ''}">⌄</span>${label}${collapsed && channels.length ? `<span class="group-count">${channels.length}</span>` : ''}
            </button>
            <button data-action="create-channel" data-kind="${key}" title="เพิ่มช่อง" aria-label="เพิ่มช่อง">+</button>
          </div>
          ${collapsed ? '' : (channels.map(channelRow).join('') || '<div class="channel-empty">— ยังไม่มีช่อง —</div>')}
        </div>`;
    };

    $('channelList').innerHTML = group('text', 'ช่องข้อความ', textChannels) + group('voice', 'ช่องเสียง', voiceChannels);
    renderVoicePanel();
    renderVoiceBar();
  }

  function renderUserPanel() {
    if (!state.me) return;
    const status = STATUS_LIST.find((s) => s.key === state.myStatus) || STATUS_LIST[0];
    $('userPanel').innerHTML = `
      <button class="user-identity" data-action="my-status" title="เปลี่ยนสถานะ">
        <span class="avatar-wrap">${avatar(state.me, 'sm')}<span class="status-dot ${status.dot}"></span></span>
        <span class="who"><b>${escapeHtml(state.me.display_name)}</b><span>${status.label}</span></span>
      </button>
      <span class="user-controls">
        <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${state.muted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'}" aria-label="ไมโครโฟน">🎤</button>
        <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${state.deafened ? 'เปิดเสียง' : 'ปิดเสียง'}" aria-label="หูฟัง">🎧</button>
        <button class="icon-btn" data-action="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">⏻</button>
      </span>`;
  }

  function renderHeader() {
    const channel = currentChannel();
    if (!channel) { $('chatHeader').innerHTML = ''; return; }
    $('chatHeader').innerHTML = `
      <button class="icon-btn mobile-only" data-action="toggle-sidebar" title="รายการช่อง" aria-label="เปิดรายการช่อง">☰</button>
      <span class="big-hash">${channel.kind === 'text' ? '#' : '🔊'}</span>
      <span class="title">${escapeHtml(channel.name)}</span>
      <span class="topic">${escapeHtml(channel.topic || '')}</span>
      <span class="spacer"></span>
      <div class="header-actions">
        ${state.searchOpen
          ? `<input id="searchInput" class="search-input" type="text" placeholder="ค้นหาข้อความ..." value="${escapeHtml(state.search)}" aria-label="ค้นหาข้อความ" />`
          : ''}
        <button class="icon-btn ${state.searchOpen ? 'active' : ''}" data-action="toggle-search" title="ค้นหาในช่องนี้" aria-label="ค้นหา">🔍</button>
        <button class="icon-btn ${state.membersVisible ? 'active' : ''}" data-action="toggle-members" title="แสดง/ซ่อนรายชื่อสมาชิก" aria-label="สมาชิก">👥</button>
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

  function nearBottom() {
    const el = $('messageScroll');
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }
  function scrollToBottom() {
    const el = $('messageScroll');
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  function renderMessages() {
    const channel = currentChannel();
    $('channelIntro').hidden = !!state.search;
    $('channelIntro').innerHTML = channel ? `
      <div class="intro-icon">${channel.kind === 'text' ? '#' : '🔊'}</div>
      <h2>ยินดีต้อนรับสู่ #${escapeHtml(channel.name)}</h2>
      <p>${escapeHtml(channel.topic || 'นี่คือจุดเริ่มต้นของช่องนี้')}</p>
      <div class="intro-line"></div>` : '';

    const canDeleteAll = ['owner', 'admin'].includes(currentServer()?.role);
    const query = state.search;
    const needle = query.toLowerCase();
    const visible = needle
      ? state.messages.filter((m) =>
          m.content.toLowerCase().includes(needle) || m.author.display_name.toLowerCase().includes(needle))
      : state.messages;

    let html = needle
      ? `<div class="search-summary">พบ ${visible.length} ข้อความที่ตรงกับ “${escapeHtml(query)}”
           <button data-action="clear-search">ล้างการค้นหา</button></div>`
      : '';

    if (!visible.length) {
      html += needle
        ? `<div class="empty-state"><div class="empty-icon">🔍</div><h3>ไม่พบข้อความที่ค้นหา</h3><p>ลองใช้คำอื่นดูนะ</p></div>`
        : `<div class="empty-state"><div class="empty-icon">💬</div><h3>ยังไม่มีข้อความในช่องนี้</h3><p>เริ่มบทสนทนาแรกได้เลยนะ</p></div>`;
    }

    let lastAuthor = null;
    let lastTime = 0;
    let lastDay = '';
    for (const m of visible) {
      const time = new Date(m.created_at).getTime();
      const day = dayKey(m.created_at);
      if (day !== lastDay) {
        html += `<div class="day-divider"><span>${fmtDay(m.created_at)}</span></div>`;
        lastDay = day;
        lastAuthor = null;
      }
      const author = m.author;
      const grouped = !needle && m.author.id === lastAuthor && time - lastTime < 5 * 60 * 1000 && !m.reply;
      const canDelete = canDeleteAll || (state.me && author.id === state.me.id);
      const replyQuote = m.reply ? `
        <button class="reply-quote" data-action="goto-message" data-id="${escapeHtml(m.reply.id)}" title="ไปที่ข้อความต้นฉบับ">
          ${avatar(m.reply.author, 'xs')}
          <span class="rq-name" style="color:${safeColor(m.reply.author.color)}">${escapeHtml(m.reply.author.display_name)}</span>
          <span class="rq-text">${escapeHtml(m.reply.content)}</span>
          <span class="rq-icon">↩</span>
        </button>` : '';
      const reactions = (m.reactions || []);
      const reactionHtml = reactions.length ? `
        <div class="reactions">
          ${reactions.map((r) => {
            const mine = Array.isArray(r.users)
              ? !!(state.me && r.users.includes(state.me.id))
              : !!r.me;
            return `
            <button class="reaction ${mine ? 'mine' : ''}" data-action="reaction" data-id="${escapeHtml(m.id)}"
                    data-emoji="${escapeHtml(r.emoji)}" title="${mine ? 'ยกเลิกปฏิกิริยา' : 'เพิ่มปฏิกิริยา'}">
              <span>${escapeHtml(r.emoji)}</span><b>${r.count}</b>
            </button>`;
          }).join('')}
          <button class="reaction add" data-action="react-more" data-id="${escapeHtml(m.id)}" title="เพิ่มปฏิกิริยา">＋</button>
        </div>` : '';

      html += `
        <div class="msg ${grouped ? 'grouped' : ''}" data-id="${escapeHtml(m.id)}">
          <div class="gutter">${grouped
            ? `<span class="timestamp-mini">${fmtTime(m.created_at)}</span>`
            : `<button class="avatar-btn" data-action="profile" data-id="${escapeHtml(author.id)}" aria-label="โปรไฟล์ ${escapeHtml(author.display_name)}">${avatar(author)}</button>`}</div>
          <div class="body">
            ${replyQuote}
            ${grouped ? '' : `<div class="meta">
              <button class="author" data-action="profile" data-id="${escapeHtml(author.id)}" style="color:${safeColor(author.color)}">${escapeHtml(author.display_name)}</button>
              ${author.bot ? '<span class="bot-tag">bot</span>' : ''}
              <span class="time" title="${escapeHtml(fmtFull(m.created_at))}">${fmtTime(m.created_at)}</span>
            </div>`}
            <div class="content">${formatContent(m.content, query)}${m.edited_at ? '<span class="edited">แก้ไขแล้ว</span>' : ''}</div>
            ${reactionHtml}
          </div>
          <div class="msg-toolbar">
            <button data-action="quick-react" data-id="${escapeHtml(m.id)}" title="ตอบโต้ด่วน">👍</button>
            <button data-action="react-more" data-id="${escapeHtml(m.id)}" title="เพิ่มปฏิกิริยา">☺</button>
            <button data-action="reply" data-id="${escapeHtml(m.id)}" title="ตอบกลับ">↩</button>
            <button data-action="copy-message" data-id="${escapeHtml(m.id)}" title="คัดลอกข้อความ">⧉</button>
            ${canDelete ? `<button data-action="delete-message" data-id="${escapeHtml(m.id)}" title="ลบข้อความ">🗑</button>` : ''}
          </div>
        </div>`;
      lastAuthor = author.id;
      lastTime = time;
    }
    $('messageList').innerHTML = html;
  }

  function renderMembers() {
    const server = currentServer();
    if (!server) { $('memberList').innerHTML = ''; return; }
    const online = server.members.filter((m) => state.online.has(m.id));
    const offline = server.members.filter((m) => !state.online.has(m.id));
    const row = (m) => {
      const online = state.online.has(m.id);
      const isMe = state.me && m.id === state.me.id;
      const dot = isMe ? myStatusDot() : (online ? 'online' : '');
      return `
      <button class="member ${online ? 'online' : ''}" data-action="profile" data-id="${escapeHtml(m.id)}">
        <span class="avatar-wrap">${avatar(m, 'sm')}<span class="status-dot ${dot}"></span></span>
        <span class="who">
          <span class="m-name" style="${m.id === server.owner_id ? 'color:var(--amber)' : ''}">${escapeHtml(m.display_name)}</span>
          ${online ? '<span class="m-activity">กำลังออนไลน์</span>' : ''}
        </span>
        ${m.id === server.owner_id ? '<span class="member-role" title="เจ้าของเซิร์ฟเวอร์"></span>' : ''}
        ${m.bot ? '<span class="bot-tag">bot</span>' : ''}
        ${isMe ? '<span class="you">คุณ</span>' : ''}
      </button>`;
    };
    $('memberList').innerHTML = `
      <div class="member-group">ออนไลน์ — ${online.length}</div>${online.map(row).join('')}
      <div class="member-group">ออฟไลน์ — ${offline.length}</div>${offline.map(row).join('')}`;
  }

  function renderVoicePanel() {
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
      <div class="vp-title"><span>🔊 ${escapeHtml(channel.name)}</span><span>${users.length} คน</span></div>
      <div class="vp-users">${users.length
        ? users.map((uid) => `${avatar(userById(uid), 'xs')} ${escapeHtml(userById(uid).display_name)}`).join('<br />')
        : 'ยังไม่มีใครอยู่ในห้องนี้'}</div>
      <div class="vp-buttons">
        <button class="vp-join" data-action="${joined ? 'voice-leave' : 'voice-join'}" data-id="${escapeHtml(id)}">
          ${joined ? 'ออกจากห้องเสียง' : 'เข้าร่วมห้องเสียง'}
        </button>
        ${joined ? `
          <button class="vp-icon ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="${state.muted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'}">🎤</button>
          <button class="vp-icon ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="${state.deafened ? 'เปิดเสียง' : 'ปิดเสียง'}">🎧</button>` : ''}
      </div>
      <div class="vp-note">ตอนนี้แสดงรายชื่อคนในห้อง ยังไม่รองรับการคุยด้วยเสียง</div>`;
  }

  function renderVoiceBar() {
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
        <button class="icon-btn ${state.muted ? 'off' : ''}" data-action="toggle-mute" title="ไมโครโฟน">🎤</button>
        <button class="icon-btn ${state.deafened ? 'off' : ''}" data-action="toggle-deafen" title="หูฟัง">🎧</button>
        <button class="icon-btn" data-action="voice-leave" data-id="${escapeHtml(channelId)}" title="ออกจากห้องเสียง">⏻</button>
      </div>`;
  }

  function renderTyping() {
    const entries = [...state.typing.entries()];
    const names = entries.map(([, name]) => name);
    $('typingRow').innerHTML = names.length
      ? `<span class="typing-avatars">${entries.slice(0, 3).map(([id]) => avatar(userById(id), 'xs')).join('')}</span>
         <span class="typing-dots"><i></i><i></i><i></i></span>
         <span><b>${escapeHtml(names.slice(0, 3).join(', '))}</b>${names.length > 3 ? ` และอีก ${names.length - 3} คน` : ''} กำลังพิมพ์…</span>`
      : '';
  }

  function renderReplyBar() {
    const target = state.replyTo;
    if (!target) { $('replyBar').hidden = true; return; }
    $('replyBar').hidden = false;
    $('replyBar').innerHTML = `
      <span class="rb-icon">↩</span>
      <span class="rb-text">ตอบกลับ <b>${escapeHtml(target.author.display_name)}</b>
        <span class="rb-preview">${escapeHtml(target.content.slice(0, 90))}</span></span>
      <button class="rb-close" data-action="cancel-reply" title="ยกเลิกการตอบกลับ" aria-label="ยกเลิก">✕</button>`;
  }

  function renderAll() {
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

  // ------------------------------------------------------------------ actions
  async function loadBootstrap() {
    const data = await api('/bootstrap');
    state.me = data.me;
    state.servers = data.servers;
    state.online = new Set(data.online);
    state.voice = data.voice || {};
    state.currentServerId = data.default_server_id || null;
    state.currentChannelId = data.default_channel_id || null;
    state.voiceChannelId = null;
  }

  async function selectServer(id) {
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
    closeOverlays();
    renderAll();
    await loadMessages();
  }

  async function selectChannel(id) {
    const channel = currentServer()?.channels.find((c) => c.id === id);
    if (!channel) return;
    if (channel.kind === 'voice') {
      state.voiceChannelId = id;
      state.typing.clear();
      state.typingTimers.forEach((timer) => clearTimeout(timer));
      state.typingTimers.clear();
      renderSidebar();
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
    closeOverlays();
    renderSidebar();
    renderHeader();
    renderTyping();
    renderRail();
    await loadMessages();
  }

  async function loadMessages() {
    const channel = currentChannel();
    if (!channel || channel.kind !== 'text') { state.messages = []; renderMessages(); $('jumpBtn').hidden = true; return; }
    try {
      state.messages = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
      renderMessages();
      scrollToBottom();
      $('jumpBtn').hidden = true;
    } catch (error) { handleError(error); }
  }

  async function refreshMessages() {
    const channel = currentChannel();
    if (!channel || channel.kind !== 'text') return;
    try {
      const stick = nearBottom();
      state.messages = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
      renderMessages();
      if (stick) scrollToBottom();
    } catch (error) { handleError(error); }
  }

  function appendMessage(message) {
    if (state.messages.some((m) => m.id === message.id)) return;
    const stick = nearBottom();
    state.messages.push(message);
    if (state.messages.length > 200) state.messages.shift();
    renderMessages();
    if (stick) scrollToBottom();
  }

  async function sendMessage() {
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
    } catch (error) { handleError(error); }
  }

  function autoGrow() {
    const input = $('messageInput');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    $('sendBtn').disabled = !input.value.trim();
    updateCharCount();
  }

  // --------------------------------------------------------------- WebSockets
  function connectWs() {
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

  function handleEvent(event) {
    switch (event.type) {
      case 'ready':
        state.online = new Set(event.online || []);
        renderMembers();
        break;
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
      case 'message_update': {
        if (state.me && event.actor_id === state.me.id) break; // REST response already applied
        if (event.message.channel_id === state.currentChannelId && !state.searchOpen) refreshMessages();
        break;
      }
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
      case 'member_join': {
        const server = state.servers.find((s) => s.id === event.server_id);
        if (server && !server.members.some((m) => m.id === event.user.id)) {
          server.members.push(event.user);
          renderMembers();
        }
        break;
      }
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
      default: break; // heartbeat, pong, server_create
    }
  }

  // -------------------------------------------------------------------- modals
  let modalHandler = null;
  function openModal({ title, desc, html, submitText = 'สร้าง', hideSubmit = false, onSubmit }) {
    $('modalTitle').textContent = title;
    $('modalDesc').textContent = desc || '';
    $('modalFields').innerHTML = html || '';
    $('modalError').textContent = '';
    $('modalSubmit').textContent = submitText;
    $('modalSubmit').hidden = hideSubmit;
    modalHandler = onSubmit || null;
    $('modalBackdrop').hidden = false;
    const firstInput = $('modalFields').querySelector('input, select');
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
  }
  function closeModal() { $('modalBackdrop').hidden = true; modalHandler = null; }
  function field(name, label, placeholder, extra = '') {
    return `<label for="f_${name}">${label}</label>
            <input id="f_${name}" name="${name}" placeholder="${escapeHtml(placeholder)}" ${extra} />`;
  }

  function openCreateServer() {
    openModal({
      title: 'สร้างเซิร์ฟเวอร์',
      desc: 'ตั้งชื่อพื้นที่ของคุณ ระบบจะสร้างช่อง #general ให้โดยอัตโนมัติ',
      html: field('name', 'ชื่อเซิร์ฟเวอร์', 'เช่น ทีมการตลาด') +
            field('icon', 'ไอคอน (emoji ไม่บังคับ)', '💬'),
      onSubmit: async () => {
        const name = $('f_name').value.trim();
        if (!name) throw new Error('กรุณาใส่ชื่อเซิร์ฟเวอร์');
        const icon = $('f_icon').value.trim();
        const server = await api('/servers', {
          method: 'POST', body: JSON.stringify({ name, icon: icon || undefined }),
        });
        state.servers.push(server);
        await selectServer(server.id);
        toast(`สร้างเซิร์ฟเวอร์ "${server.name}" แล้ว`, 'ok');
      },
    });
  }

  function openCreateChannel(kind = 'text') {
    if (!currentServer()) { toast('เลือกเซิร์ฟเวอร์ก่อน', 'err'); return; }
    openModal({
      title: 'สร้างช่องใหม่',
      desc: `ในเซิร์ฟเวอร์ ${currentServer().name}`,
      html: field('name', 'ชื่อช่อง', kind === 'text' ? 'my-channel' : 'Lounge') +
            `<label for="f_kind">ประเภท</label>
             <select id="f_kind" name="kind">
               <option value="text" ${kind === 'text' ? 'selected' : ''}>💬 ช่องข้อความ</option>
               <option value="voice" ${kind === 'voice' ? 'selected' : ''}>🔊 ช่องเสียง</option>
             </select>` +
            field('topic', 'หัวข้อ (ไม่บังคับ)', 'ช่องนี้เอาไว้คุยเรื่อง...'),
      onSubmit: async () => {
        const name = $('f_name').value.trim();
        if (!name) throw new Error('กรุณาใส่ชื่อช่อง');
        const channel = await api(`/servers/${encodeURIComponent(state.currentServerId)}/channels`, {
          method: 'POST',
          body: JSON.stringify({ name, kind: $('f_kind').value, topic: $('f_topic').value.trim() }),
        });
        const server = currentServer();
        if (!server.channels.some((c) => c.id === channel.id)) server.channels.push(channel);
        renderSidebar();
        toast(`สร้างช่อง "${channel.name}" แล้ว`, 'ok');
        if (channel.kind === 'text') await selectChannel(channel.id);
      },
    });
  }

  async function openDirectory() {
    try {
      const servers = await api('/servers');
      const rows = servers.map((s) => `
        <div class="member" style="justify-content:space-between">
          <span style="display:flex;align-items:center;gap:10px">
            <span class="avatar sm" style="background:var(--brand)">${escapeHtml(s.icon)}</span>
            <span><b>${escapeHtml(s.name)}</b><br /><small style="color:var(--muted)">สมาชิก ${s.member_count} คน</small></span>
          </span>
          ${s.joined
            ? '<span style="color:var(--green);font-size:12px">✓ เข้าร่วมแล้ว</span>'
            : `<button class="primary-btn" style="width:auto;margin:0;padding:6px 12px;font-size:12px" data-join="${escapeHtml(s.id)}">เข้าร่วม</button>`}
        </div>`).join('');
      openModal({
        title: 'ค้นหาเซิร์ฟเวอร์',
        desc: 'เข้าร่วมเซิร์ฟเวอร์อื่น หรือสร้างของตัวเอง',
        hideSubmit: true,
        html: `<div style="max-height:260px;overflow-y:auto">${rows || 'ยังไม่มีเซิร์ฟเวอร์'}</div>
               <button class="ghost-btn" id="directoryCreate" style="margin-top:12px;padding-left:0">+ สร้างเซิร์ฟเวอร์ใหม่</button>`,
      });
    } catch (error) { handleError(error); }
  }

  async function joinFromDirectory(serverId) {
    try {
      const view = await api(`/servers/${encodeURIComponent(serverId)}/join`, { method: 'POST' });
      const index = state.servers.findIndex((s) => s.id === view.id);
      if (index === -1) state.servers.push(view); else state.servers[index] = view;
      closeModal();
      renderRail();
      await selectServer(view.id);
      toast(`เข้าร่วม "${view.name}" แล้ว`, 'ok');
    } catch (error) { handleError(error); }
  }

  // ---------------------------------------------------------------- lifecycle
  function logout(expired = false) {
    localStorage.removeItem('ob_token');
    state.token = '';
    state.me = null;
    state.servers = [];
    state.messages = [];
    state.voice = {};
    state.unread.clear();
    state.mentions.clear();
    clearReply();
    closeOverlays();
    if (state.ws) { state.ws.onclose = null; state.ws.close(); }
    clearTimeout(state.reconnectTimer);
    $('shell').hidden = true;
    $('login').hidden = false;
    $('loginError').textContent = expired ? 'เซสชันหมดอายุ กรุณาเข้าร่วมอีกครั้ง' : '';
  }

  async function start() {
    $('login').hidden = true;
    $('shell').hidden = false;
    try {
      await loadBootstrap();
    } catch (error) { handleError(error); $('login').hidden = false; $('shell').hidden = true; return; }
    const channel = currentChannel();
    $('messageInput').placeholder = channel ? `ส่งข้อความไปที่ #${channel.name}` : 'เลือกช่องก่อนส่งข้อความ';
    renderAll();
    await loadMessages();
    connectWs();
  }

  async function doLogin() {
    const button = $('loginBtn');
    const username = $('usernameInput').value.trim();
    $('loginError').textContent = '';
    if (!username) { $('loginError').textContent = 'กรุณาใส่ชื่อก่อน'; return; }
    button.disabled = true;
    button.textContent = 'กำลังเข้าร่วม…';
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'เข้าร่วมไม่สำเร็จ');
      state.token = data.token;
      localStorage.setItem('ob_token', data.token);
      await start();
    } catch (error) {
      $('loginError').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'เข้าร่วมเลย →';
    }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ob_theme', next);
    renderRail();
  }

  // ------------------------------------------------------------------ bindings
  document.documentElement.dataset.theme = localStorage.getItem('ob_theme') || 'dark';
  $('loginBtn').addEventListener('click', doLogin);
  $('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  $('rail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'server') selectServer(btn.dataset.id);
    else if (action === 'create-server') openCreateServer();
    else if (action === 'directory') openDirectory();
    else if (action === 'theme') toggleTheme();
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
    }
    else if (action === 'channel-info') openChannelInfo(id, btn);
    else if (action === 'channel-copy' || action === 'copy-server') {
      const text = action === 'copy-server' ? currentServer()?.name || '' : `#${currentServer()?.channels.find((c) => c.id === id)?.name || ''}`;
      navigator.clipboard?.writeText(text).then(() => toast(`คัดลอก "${text}" แล้ว`, 'ok')).catch(() => toast(text, 'ok'));
      closeOverlays();
    }
    else if (action === 'channel-mark-read' || action === 'mark-read') {
      state.unread.delete(id); state.mentions.delete(id);
      renderSidebar(); renderRail(); closeOverlays();
    }
    else if (action === 'profile') openProfile(id, btn);
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
      renderSidebar();
      renderVoicePanel();
      renderVoiceBar();
    } catch (error) { handleError(error); }
  }
  $('voicePanel').addEventListener('click', handleVoiceClick);
  $('voiceBar').addEventListener('click', handleVoiceClick);

  $('messageList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'delete-message') {
      try {
        await api(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.messages = state.messages.filter((m) => m.id !== id);
        renderMessages();
      } catch (error) { handleError(error); }
    }
    else if (action === 'reaction') toggleReaction(id, btn.dataset.emoji);
    else if (action === 'quick-react') toggleReaction(id, '👍');
    else if (action === 'react-more') openEmojiPicker(btn, { type: 'reaction', messageId: id });
    else if (action === 'reply') setReply(id);
    else if (action === 'copy-message') {
      const targetMsg = state.messages.find((m) => m.id === id);
      if (targetMsg) {
        navigator.clipboard?.writeText(targetMsg.content)
          .then(() => toast('คัดลอกข้อความแล้ว', 'ok'))
          .catch(() => toast('คัดลอกไม่สำเร็จ', 'err'));
      }
    }
    else if (action === 'profile') openProfile(id, btn);
    else if (action === 'clear-search') clearSearch();
    else if (action === 'goto-message') {
      const target = document.querySelector(`.msg[data-id="${id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1400);
      } else toast('ข้อความต้นฉบับอยู่นอกช่วงที่โหลดไว้');
    }
  });

  $('messageInput').addEventListener('input', () => {
    autoGrow();
    const now = Date.now();
    if (now - state.lastTypingSent > 1800 && state.ws && state.ws.readyState === 1 && currentChannel()) {
      state.lastTypingSent = now;
      state.ws.send(JSON.stringify({ type: 'typing', channel_id: state.currentChannelId }));
    }
  });
  $('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('sendBtn').addEventListener('click', sendMessage);
  $('attachBtn').addEventListener('click', () => toast('ยังไม่รองรับการแนบไฟล์ในเวอร์ชันนี้'));
  $('emojiBtn').addEventListener('click', (e) => {
    if (state.popover === 'emoji') { closeOverlays(); return; }
    openEmojiPicker(e.currentTarget, { type: 'composer' });
  });
  $('emojiPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (btn) pickEmoji(btn.dataset.emoji);
  });
  $('replyBar').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel-reply"]')) clearReply();
  });
  $('jumpBtn').addEventListener('click', () => { scrollToBottom(); $('jumpBtn').hidden = true; });
  $('messageScroll').addEventListener('scroll', updateJumpButton);

  $('modalFields').addEventListener('click', (e) => {
    const join = e.target.closest('[data-join]');
    if (join) joinFromDirectory(join.dataset.join);
    if (e.target.id === 'directoryCreate') { closeModal(); openCreateServer(); }
  });
  $('modalCancel').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target === $('modalBackdrop')) closeModal(); });
  $('modalSubmit').addEventListener('click', async () => {
    if (!modalHandler) return;
    const button = $('modalSubmit');
    button.disabled = true;
    $('modalError').textContent = '';
    try {
      await modalHandler();
      closeModal();
    } catch (error) {
      $('modalError').textContent = error.message || 'ทำรายการไม่สำเร็จ';
    } finally { button.disabled = false; }
  });
  $('chatHeader').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'toggle-search') toggleSearch();
    else if (action === 'toggle-members') {
      state.membersVisible = !state.membersVisible;
      $('memberList').hidden = !state.membersVisible;
      renderHeader();
    }
    else if (action === 'toggle-sidebar') $('sidebar').classList.toggle('mobile-open');
    else if (action === 'toggle-theme') toggleTheme();
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
    else if (action === 'my-status') openStatusMenu(btn);
    else if (action === 'toggle-mute' || action === 'toggle-deafen') handleVoiceClick(e);
  });

  $('overlay').addEventListener('click', closeOverlays);
  $('dropdown').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'create-channel') { closeOverlays(); openCreateChannel('text'); }
    else if (action === 'directory') { closeOverlays(); openDirectory(); }
    else if (action === 'copy-server') {
      const name = currentServer()?.name || '';
      navigator.clipboard?.writeText(name).then(() => toast(`คัดลอก "${name}" แล้ว`, 'ok')).catch(() => toast(name, 'ok'));
      closeOverlays();
    }
    else if (action === 'channel-copy') {
      const channel = currentServer()?.channels.find((c) => c.id === btn.dataset.id);
      navigator.clipboard?.writeText(`#${channel?.name || ''}`).then(() => toast('คัดลอกชื่อช่องแล้ว', 'ok')).catch(() => {});
      closeOverlays();
    }
    else if (action === 'channel-mark-read') {
      state.unread.delete(btn.dataset.id); state.mentions.delete(btn.dataset.id);
      renderSidebar(); renderRail(); closeOverlays();
    }
    else if (action === 'toggle-members') {
      state.membersVisible = !state.membersVisible;
      $('memberList').hidden = !state.membersVisible;
      renderHeader(); closeOverlays();
    }
    else if (action === 'toggle-theme') { toggleTheme(); closeOverlays(); }
    else if (action === 'set-status') {
      state.myStatus = btn.dataset.status;
      renderUserPanel(); renderMembers(); renderRail(); closeOverlays();
      toast(`ตั้งสถานะเป็น${statusLabel(state.myStatus)}`, 'ok');
    }
  });

  $('profilePopout').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'mention-user') insertMention(id);
    else if (btn.dataset.action === 'reply-to-user') {
      const last = [...state.messages].reverse().find((m) => m.author.id === id);
      closeOverlays();
      if (last) setReply(last.id); else toast('ยังไม่มีข้อความจากคนนี้ในช่องนี้');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('modalBackdrop').hidden) { closeModal(); return; }
      if (state.popover) { closeOverlays(); return; }
      if (state.replyTo) { clearReply(); return; }
      if (state.searchOpen) { clearSearch(); return; }
    }
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleSearch(); }
    if (e.key === '/' && document.activeElement !== $('messageInput') && !state.searchOpen) {
      e.preventDefault(); toggleSearch();
    }
  });
  window.addEventListener('resize', () => { if (state.popover) closeOverlays(); });

  autoGrow();
  if (state.token) start();
})();

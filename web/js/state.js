/**
 * Client-side application state, theme engine, SVG icon registry,
 * and formatting helpers for Outbox Chat.
 */

export const $ = (id) => document.getElementById(id);

export const DEFAULT_CUSTOM_COLORS = {
  brand: '#5865f2',
  sidebar: '#2b2d31',
  chat: '#313338',
};

export const AVATAR_COLORS = [
  '#5865f2', '#eb459e', '#ed4245', '#faa61a', '#23a559', '#1abc9c', '#3498db', '#9b59b6',
];

export const VALID_THEMES = ['dark', 'light', 'slate', 'forest', 'midnight', 'amber', 'custom'];

export const QUICK_REACTIONS = ['+1', 'Like', 'Ack', 'Done', 'Help', 'Idea'];

export const STATUS_LIST = [
  { key: 'online', label: 'ออนไลน์', dot: 'online' },
  { key: 'idle', label: 'ไม่อยู่', dot: 'idle' },
  { key: 'dnd', label: 'ห้ามรบกวน', dot: 'dnd' },
  { key: 'invisible', label: 'ซ่อนตัว', dot: '' },
];

export const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.3 2a10 10 0 0 0-1.9 19.8 10 10 0 0 0 11.5-11.5A10 10 0 0 0 12.3 2z"/></svg>',
  voice: '<svg class="ch-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zm-2.5-1.23L6.5 6H3c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h3.5l5 4c.66.53 1.5.06 1.5-.77V2.77c0-.83-.84-1.3-1.5-.77z"/></svg>',
  voiceLg: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zm-2.5-1.23L6.5 6H3c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h3.5l5 4c.66.53 1.5.06 1.5-.77V2.77c0-.83-.84-1.3-1.5-.77z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  searchLg: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  chatLg: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',
  members: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>',
  reply: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  caret: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
};

/** Validates and normalizes hex color strings; returns fallback on invalid input. */
export function safeColor(c, fallback = '#5865f2') {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c || '').trim()) ? String(c).trim() : fallback;
}

/** Converts 3-digit hex colors to lowercase 6-digit hex for `<input type="color">`. */
export function normalizeHex6(c, fallback = '#5865f2') {
  const clean = safeColor(c, fallback);
  if (clean.length === 4) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`.toLowerCase();
  }
  return clean.toLowerCase();
}

function loadStoredColors() {
  try {
    const raw = localStorage.getItem('ob_custom_colors');
    if (!raw) return { ...DEFAULT_CUSTOM_COLORS };
    const parsed = JSON.parse(raw);
    return {
      brand: safeColor(parsed?.brand, DEFAULT_CUSTOM_COLORS.brand),
      sidebar: safeColor(parsed?.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
      chat: safeColor(parsed?.chat, DEFAULT_CUSTOM_COLORS.chat),
    };
  } catch {
    return { ...DEFAULT_CUSTOM_COLORS };
  }
}

export const state = {
  token: localStorage.getItem('ob_token') || '',
  me: null,
  settings: {
    theme: localStorage.getItem('ob_theme') || 'dark',
    custom_colors: loadStoredColors(),
    status: 'online',
  },
  userStatuses: new Map(),
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

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const initials = (name) => String(name || '?').trim().slice(0, 2).toUpperCase();
export const avatar = (user, size = '') =>
  `<span class="avatar ${size}" style="background:${safeColor(user.color)}">${escapeHtml(initials(user.display_name))}</span>`;

export const currentServer = () => state.servers.find((s) => s.id === state.currentServerId);
export const currentChannel = () => currentServer()?.channels.find((c) => c.id === state.currentChannelId);
export const userById = (id) =>
  currentServer()?.members.find((m) => m.id === id) ||
  (state.me && state.me.id === id ? state.me : null) ||
  { id, username: 'user', display_name: 'สมาชิก', color: '#5865f2', bot: false };

export function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function fmtFull(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function dayKey(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function fmtDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'วันนี้';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const statusLabel = (key) => (STATUS_LIST.find((s) => s.key === key) || STATUS_LIST[0]).label;
export const statusDotFor = (key) => (STATUS_LIST.find((s) => s.key === key) || STATUS_LIST[0]).dot;
export const myStatusDot = () => statusDotFor(state.myStatus);
export const userStatusKey = (userId) => (state.me && userId === state.me.id ? state.myStatus : state.userStatuses.get(userId) || 'online');
export const isOnline = (userId) => {
  if (state.me && userId === state.me.id && state.myStatus === 'invisible') return false;
  if (state.userStatuses.get(userId) === 'invisible') return false;
  return state.online.has(userId);
};
export const activityText = (userId) => statusLabel(userStatusKey(userId));

/** Escapes HTML first, then applies inline code, bold, @mentions, links, and search highlight. */
export function formatContent(raw, query = '') {
  let formatted = escapeHtml(raw)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)@([\p{L}\p{N}._-]+)/gu, '$1<span class="mention">@$2</span>')
    .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
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

/** Applies a preset or custom color palette directly to CSS custom properties in real time. */
export function applyTheme(theme, customColors = state.settings.custom_colors) {
  const validTheme = VALID_THEMES.includes(theme) ? theme : 'dark';
  const colors = {
    brand: safeColor(customColors?.brand, DEFAULT_CUSTOM_COLORS.brand),
    sidebar: safeColor(customColors?.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
    chat: safeColor(customColors?.chat, DEFAULT_CUSTOM_COLORS.chat),
  };
  state.settings.theme = validTheme;
  state.settings.custom_colors = colors;
  localStorage.setItem('ob_theme', validTheme);
  localStorage.setItem('ob_custom_colors', JSON.stringify(colors));

  const root = document.documentElement;
  root.dataset.theme = validTheme;
  const customProps = [
    '--brand', '--brand-hover', '--sidebar', '--members',
    '--rail', '--chat', '--header', '--input', '--hover', '--active', '--elevated',
  ];
  if (validTheme === 'custom') {
    root.style.setProperty('--brand', colors.brand);
    root.style.setProperty('--brand-hover', colors.brand);
    root.style.setProperty('--sidebar', colors.sidebar);
    root.style.setProperty('--members', colors.sidebar);
    root.style.setProperty('--rail', `color-mix(in srgb, ${colors.sidebar} 75%, #000)`);
    root.style.setProperty('--elevated', `color-mix(in srgb, ${colors.sidebar} 65%, #000)`);
    root.style.setProperty('--chat', colors.chat);
    root.style.setProperty('--header', colors.chat);
    root.style.setProperty('--input', `color-mix(in srgb, ${colors.chat} 85%, #fff)`);
    root.style.setProperty('--hover', `color-mix(in srgb, ${colors.chat} 90%, #fff)`);
    root.style.setProperty('--active', `color-mix(in srgb, ${colors.chat} 82%, #fff)`);
  } else {
    customProps.forEach((prop) => root.style.removeProperty(prop));
  }
}

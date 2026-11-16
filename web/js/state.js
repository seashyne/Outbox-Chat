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
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
  screen: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>',
  saver: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 14l-3.5-3.5 1.41-1.41L11 12.17l4.59-4.58L17 9l-6 6z"/></svg>',
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
  joinedVoiceChannelId: null,
  meetingDataSaver: true,
  meetingVideo: false,
  meetingScreen: false,
  meetingListenOnly: false,
  meetingPeers: new Map(),
  meetingStats: { kbpsUp: 0, kbpsDown: 0, totalKb: 0, rttMs: null },
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

/** Computes WCAG relative luminance (0..1) from a valid hex color. */
export function hexLuminance(hex) {
  const full = normalizeHex6(hex);
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Computes WCAG contrast ratio (1..21) between two hex colors. */
export function contrastRatio(hexA, hexB) {
  const l1 = hexLuminance(hexA);
  const l2 = hexLuminance(hexB);
  const [bright, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (bright + 0.05) / (dark + 0.05);
}

/** Manages shell inertness and focus restoration when custom modal overlays open/close. */
export function setModalInert(active) {
  const shell = $('shell');
  if (shell) shell.inert = active;
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
    '--brand', '--brand-hover', '--sidebar', '--members', '--rail', '--chat', '--header',
    '--input', '--hover', '--active', '--elevated', '--text', '--muted', '--faint',
    '--border', '--focus-ring', '--scrollbar-thumb', 'color-scheme',
  ];
  if (validTheme === 'custom') {
    const lightChat = hexLuminance(colors.chat) > 0.36;
    const mixTarget = lightChat ? '#000' : '#fff';
    root.style.setProperty('color-scheme', lightChat ? 'light' : 'dark');
    root.style.setProperty('--brand', colors.brand);
    root.style.setProperty('--brand-hover', `color-mix(in oklab, ${colors.brand} 85%, ${lightChat ? '#000' : '#fff'})`);
    root.style.setProperty('--sidebar', colors.sidebar);
    root.style.setProperty('--members', colors.sidebar);
    root.style.setProperty('--rail', `color-mix(in srgb, ${colors.sidebar} 78%, #000)`);
    root.style.setProperty('--elevated', lightChat ? '#ffffff' : `color-mix(in srgb, ${colors.sidebar} 70%, #000)`);
    root.style.setProperty('--chat', colors.chat);
    root.style.setProperty('--header', colors.chat);
    root.style.setProperty('--input', `color-mix(in srgb, ${colors.chat} 90%, ${mixTarget})`);
    root.style.setProperty('--hover', `color-mix(in srgb, ${colors.chat} 92%, ${mixTarget})`);
    root.style.setProperty('--active', `color-mix(in srgb, ${colors.chat} 84%, ${mixTarget})`);
    root.style.setProperty('--text', lightChat ? '#111827' : '#f3f4f6');
    root.style.setProperty('--muted', lightChat ? '#4b5563' : '#b0b6c2');
    root.style.setProperty('--faint', lightChat ? '#6b7280' : '#8c93a0');
    root.style.setProperty('--border', lightChat ? 'rgba(17, 24, 39, .1)' : 'rgba(255, 255, 255, .1)');
    root.style.setProperty('--focus-ring', lightChat ? '#111827' : '#f3f4f6');
    root.style.setProperty('--scrollbar-thumb', lightChat ? 'rgba(75, 85, 99, .3)' : 'rgba(160, 168, 184, .34)');
  } else {
    customProps.forEach((prop) => root.style.removeProperty(prop));
  }
}

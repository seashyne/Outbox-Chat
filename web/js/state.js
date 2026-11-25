/**
 * Client-side application state, theme engine,
 * and formatting helpers for Outbox Chat.
 */

import { getIntlLocale, getLanguage, t } from './i18n.js';
import { ICONS } from './icons.js';

export { ICONS };
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
  { key: 'online', dot: 'online' },
  { key: 'idle', dot: 'idle' },
  { key: 'dnd', dot: 'dnd' },
  { key: 'invisible', dot: '' },
];

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
  account: null,
  settings: {
    theme: localStorage.getItem('ob_theme') || 'dark',
    custom_colors: loadStoredColors(),
    status: 'online',
    language: getLanguage(),
  },
  userStatuses: new Map(),
  servers: [],
  online: new Set(),
  voice: {},
  unread: new Set(),
  mentions: new Set(),
  currentServerId: null,
  currentChannelId: null,
  homeMode: false,
  dmChannel: null,
  dmPeer: null,
  friends: { friends: [], incoming: [], outgoing: [] },
  messageCache: new Map(),
  voiceChannelId: null,
  joinedVoiceChannelId: null,
  meetingDataSaver: true,
  meetingVideo: false,
  meetingScreen: false,
  meetingScreenPreset: 'hd',
  meetingSpotlightId: null,
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

export const safeAvatarUrl = (raw) => {
  const s = String(raw || '').trim();
  if (
    s.startsWith('data:image/png;base64,') ||
    s.startsWith('data:image/jpeg;base64,') ||
    s.startsWith('data:image/webp;base64,') ||
    s.startsWith('https://')
  ) {
    return /[<"'\x00-\x1F\x7F]/.test(s) ? '' : s;
  }
  return '';
};
export const initials = (name) => String(name || '?').trim().slice(0, 2).toUpperCase();
export const avatar = (user, size = '') => {
  const img = safeAvatarUrl(user?.avatar_url);
  if (img) {
    return `<span class="avatar ${size}" style="background:${safeColor(user?.color)}"><img src="${escapeHtml(img)}" alt="${escapeHtml(user?.display_name || '')}" loading="lazy" /></span>`;
  }
  return `<span class="avatar ${size}" style="background:${safeColor(user?.color)}">${escapeHtml(initials(user?.display_name))}</span>`;
};

export const currentServer = () =>
  state.homeMode ? null : state.servers.find((s) => s.id === state.currentServerId);
export const currentChannel = () =>
  state.homeMode ? state.dmChannel : currentServer()?.channels.find((c) => c.id === state.currentChannelId);
export const userById = (id) =>
  currentServer()?.members.find((m) => m.id === id) ||
  (state.me && state.me.id === id ? state.me : null) ||
  { id, username: 'user', display_name: t('common.member'), color: '#5865f2', bot: false };

export function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function fmtFull(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString(getIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' });
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
  if (dayKey(iso) === dayKey(today.toISOString())) return t('date.today');
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('date.yesterday');
  return d.toLocaleDateString(getIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export const statusLabel = (key) => {
  const entry = STATUS_LIST.find((s) => s.key === key) || STATUS_LIST[0];
  return t(`status.${entry.key}`);
};
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

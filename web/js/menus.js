/**
 * Popout menus, context dropdowns, and clean text reaction picker.
 */

import { toggleReaction } from './actions.js';
import { autoGrow } from './render_chat.js';
import {
  $,
  ICONS,
  QUICK_REACTIONS,
  STATUS_LIST,
  avatar,
  currentServer,
  escapeHtml,
  isOnline,
  myStatusDot,
  safeColor,
  state,
  statusDotFor,
  statusLabel,
  userById,
  userStatusKey,
} from './state.js';

export function closeOverlays() {
  $('overlay').hidden = true;
  $('profilePopout').hidden = true;
  $('dropdown').hidden = true;
  $('emojiPicker').hidden = true;
  state.popover = null;
}

export function openOverlay(kind) {
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

/** Opens the clean text reaction picker (`+1`, `Like`, `Ack`, `Done`, `Help`, `Idea`). */
export function openEmojiPicker(anchor, target) {
  state.emojiTarget = target;
  const picker = $('emojiPicker');
  picker.innerHTML = `
    <div class="ep-head">เพิ่มปฏิกิริยา</div>
    <div class="ep-grid">${QUICK_REACTIONS.map((token) =>
      `<button data-emoji="${escapeHtml(token)}" title="${escapeHtml(token)}">${escapeHtml(token)}</button>`).join('')}</div>`;
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

export function pickEmoji(token) {
  const target = state.emojiTarget;
  closeOverlays();
  if (!target || !token) return;
  if (target.type === 'reaction') {
    toggleReaction(target.messageId, token);
  } else {
    const input = $('messageInput');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    autoGrow();
  }
}

export function openProfile(userId, anchor) {
  const user = userById(userId);
  const server = currentServer();
  const online = isOnline(userId);
  const isMe = state.me && userId === state.me.id;
  const role = userId === server?.owner_id ? 'เจ้าของเซิร์ฟเวอร์' : user.bot ? 'บอท' : 'สมาชิก';
  const node = $('profilePopout');
  node.innerHTML = `
    <div class="pp-banner" style="background:${safeColor(user.color)}"></div>
    <div class="pp-avatar"><span class="avatar-wrap">${avatar(user, 'lg')}<span class="status-dot ${isMe ? myStatusDot() : (online ? statusDotFor(userStatusKey(userId)) : '')}"></span></span></div>
    <div class="pp-body">
      <b class="pp-name">${escapeHtml(user.display_name)}</b>
      <span class="pp-username">${escapeHtml(user.username)}</span>
      ${user.bot ? '<span class="bot-tag">bot</span>' : ''}
      <div class="pp-divider"></div>
      <div class="pp-label">ตำแหน่ง</div><div class="pp-value">${role}</div>
      <div class="pp-label">สถานะ</div><div class="pp-value">${isMe ? statusLabel(state.myStatus) : (online ? statusLabel(userStatusKey(userId)) : 'ออฟไลน์')}</div>
      ${isMe ? `
        <button class="pp-action" data-action="open-settings-profile">แก้ไขโปรไฟล์และตั้งค่า</button>
        <button class="pp-action ghost" data-action="open-settings-appearance">ปรับแต่งธีมและสี</button>` : `
        <button class="pp-action" data-action="mention-user" data-id="${escapeHtml(userId)}">กล่าวถึงในข้อความ</button>
        <button class="pp-action ghost" data-action="reply-to-user" data-id="${escapeHtml(userId)}">ตอบกลับข้อความล่าสุด</button>`}
    </div>`;
  openOverlay('profile');
  positionPopout(anchor, node);
}

export function openDropdown(html, anchor) {
  const node = $('dropdown');
  node.innerHTML = html;
  openOverlay('dropdown');
  positionMenu(anchor, node);
}

export function openServerMenu(anchor) {
  const server = currentServer();
  const canLeave = server && state.me && server.owner_id !== state.me.id;
  openDropdown(`
    <button data-action="create-channel">${ICONS.plus} <span>สร้างช่องใหม่</span></button>
    <button data-action="directory">${ICONS.search} <span>ค้นหาเซิร์ฟเวอร์</span></button>
    <button data-action="copy-server">${ICONS.copy} <span>คัดลอกชื่อเซิร์ฟเวอร์</span></button>
    <div class="dd-sep"></div>
    <button data-action="toggle-members">${ICONS.members} <span>${state.membersVisible ? 'ซ่อน' : 'แสดง'}รายชื่อสมาชิก</span></button>
    <button data-action="open-settings-appearance">${ICONS.settings} <span>ตั้งค่าธีมและสี</span></button>
    ${canLeave ? `
      <div class="dd-sep"></div>
      <button class="danger" data-action="leave-server" data-id="${escapeHtml(server.id)}">${ICONS.logout} <span>ออกจากเซิร์ฟเวอร์</span></button>` : ''}`, anchor);
}

export function openStatusMenu(anchor) {
  openDropdown(`
    <div class="dd-title">ตั้งสถานะของคุณ</div>
    ${STATUS_LIST.map((s) => `
      <button data-action="set-status" data-status="${s.key}" class="${state.myStatus === s.key ? 'selected' : ''}">
        <span class="status-dot ${s.dot} dd-dot"></span><span>${s.label}</span>${state.myStatus === s.key ? `<b>${ICONS.check}</b>` : ''}
      </button>`).join('')}
    <div class="dd-sep"></div>
    <button data-action="open-settings-profile">${ICONS.settings} <span>ตั้งค่าบัญชีและธีม</span></button>`, anchor);
}

export function openChannelInfo(channelId, anchor) {
  const server = currentServer();
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!channel) return;
  const canManage = ['owner', 'admin'].includes(server.role);
  openDropdown(`
    <div class="dd-title">${channel.kind === 'text' ? '#' : ICONS.voice} ${escapeHtml(channel.name)}</div>
    <div class="dd-info">${escapeHtml(channel.topic || 'ไม่มีหัวข้อ')}</div>
    <div class="dd-sep"></div>
    <button data-action="channel-copy" data-id="${escapeHtml(channelId)}">${ICONS.copy} <span>คัดลอกชื่อช่อง</span></button>
    <button data-action="channel-mark-read" data-id="${escapeHtml(channelId)}">${ICONS.check} <span>ทำเครื่องหมายว่าอ่านแล้ว</span></button>
    ${canManage ? `
      <div class="dd-sep"></div>
      <button class="danger" data-action="channel-delete" data-id="${escapeHtml(channelId)}">${ICONS.trash} <span>ลบช่องนี้</span></button>` : ''}`, anchor);
}

export function openComposerMenu(anchor) {
  openDropdown(`
    <div class="dd-title">แทรกรูปแบบข้อความ</div>
    <button data-action="insert-snippet" data-snippet="code"><span>โค้ดบล็อก (\`code\`)</span></button>
    <button data-action="insert-snippet" data-snippet="bold"><span>ตัวหนา (**text**)</span></button>
    <button data-action="insert-snippet" data-snippet="mention"><span>กล่าวถึงสมาชิก (@)</span></button>`, anchor);
}

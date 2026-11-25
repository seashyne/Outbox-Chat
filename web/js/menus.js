/**
 * Popout menus, context dropdowns, and clean text reaction picker.
 */

import { planBadgeHtml } from './account_ui.js';
import { toggleReaction } from './actions.js';
import { t } from './i18n.js';
import { autoGrow } from './render_chat.js';
import { bannerStyle, resolveProfile } from './profile_helpers.js';
import { memberRoleFor, roleMeta } from './server_templates.js';
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

let lastAnchor = null;

export function closeOverlays(restoreFocus = false) {
  $('overlay').hidden = true;
  $('profilePopout').hidden = true;
  $('dropdown').hidden = true;
  $('emojiPicker').hidden = true;
  state.popover = null;
  if (restoreFocus && lastAnchor?.isConnected) lastAnchor.focus();
  lastAnchor = null;
}

export function openOverlay(kind, anchor = null) {
  $('profilePopout').hidden = true;
  $('dropdown').hidden = true;
  if (kind !== 'emoji') $('emojiPicker').hidden = true;
  $('overlay').hidden = false;
  state.popover = kind;
  lastAnchor = anchor;
}

function positionPopout(anchor, node, preferred = 'right') {
  const rect = anchor.getBoundingClientRect();
  node.hidden = false;
  const width = node.offsetWidth || 288;
  const height = node.offsetHeight || 220;
  let flippedX = false;
  let left = preferred === 'right' ? rect.right + 10 : rect.left - width - 10;
  let top = rect.top;
  if (left + width > window.innerWidth - 8) {
    left = rect.left - width - 10;
    flippedX = true;
  }
  if (left < 8) left = 8;
  if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
  if (top < 8) top = 8;
  node.style.transformOrigin = flippedX ? 'top right' : 'top left';
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function positionMenu(anchor, node) {
  const rect = anchor.getBoundingClientRect();
  node.hidden = false;
  const width = node.offsetWidth || 224;
  const height = node.offsetHeight || 180;
  let left = rect.left;
  let originX = 'left';
  if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8;
    originX = 'right';
  }
  let top = rect.bottom + 6;
  let originY = 'top';
  if (top + height > window.innerHeight - 8) {
    top = rect.top - height - 6;
    originY = 'bottom';
  }
  node.style.transformOrigin = `${originY} ${originX}`;
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
}

/** Opens the clean text reaction picker (`+1`, `Like`, `Ack`, `Done`, `Help`, `Idea`). */
export function openEmojiPicker(anchor, target) {
  state.emojiTarget = target;
  const picker = $('emojiPicker');
  picker.innerHTML = `
    <div class="ep-head">${escapeHtml(t('chat.addReaction'))}</div>
    <div class="ep-grid">${QUICK_REACTIONS.map((token) =>
      `<button data-emoji="${escapeHtml(token)}" title="${escapeHtml(token)}">${escapeHtml(token)}</button>`).join('')}</div>`;
  const rect = anchor.getBoundingClientRect();
  picker.hidden = false;
  const width = picker.offsetWidth || 276;
  let left = rect.right - width;
  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  let top = rect.top - picker.offsetHeight - 10;
  let originY = 'bottom';
  if (top < 8) {
    top = rect.bottom + 10;
    originY = 'top';
  }
  picker.style.transformOrigin = `${originY} right`;
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
  openOverlay('emoji', anchor);
  picker.querySelector('button')?.focus();
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
  const server = currentServer();
  const user = resolveProfile(userId, server);
  const online = isOnline(userId);
  const isMe = state.me && userId === state.me.id;
  const rKey = memberRoleFor(server, userId);
  const rMeta = user.bot ? { label: t('common.bot'), color: 'var(--brand)' } : roleMeta(server, rKey);
  const canAdjustRole = Boolean(server && state.me && server.owner_id === state.me.id && userId !== server.owner_id);
  const nextRole = rKey === 'admin' ? 'member' : 'admin';
  const nextMeta = roleMeta(server, nextRole);
  const isFriend = (state.friends?.friends || []).some((f) => f.user.id === userId);
  const isIncoming = (state.friends?.incoming || []).some((f) => f.user.id === userId);
  const isOutgoing = (state.friends?.outgoing || []).some((f) => f.user.id === userId);
  const node = $('profilePopout');
  node.innerHTML = `
    <div class="pp-banner" style="${bannerStyle(user)}"></div>
    <div class="pp-avatar"><span class="avatar-wrap">${avatar(user, 'lg')}<span class="status-dot ${isMe ? myStatusDot() : (online ? statusDotFor(userStatusKey(userId)) : '')}"></span></span></div>
    <div class="pp-body">
      <b class="pp-name">${escapeHtml(user.display_name)} ${planBadgeHtml(user.plan)}</b>
      <span class="pp-username">@${escapeHtml(user.username)}</span>
      ${user.status_text ? `<div class="pp-status-note">${escapeHtml(user.status_text)}</div>` : ''}
      ${user.bio ? `<div class="pp-bio">${escapeHtml(user.bio)}</div>` : ''}
      ${user.bot ? `<span class="bot-tag">${escapeHtml(t('common.bot'))}</span>` : ''}
      <div class="pp-divider"></div>
      ${server ? `<div class="pp-label">${escapeHtml(t('profile.role'))}</div><div class="pp-value"><span class="role-pill" style="--role-color:${rMeta.color}">${escapeHtml(rMeta.label)}</span></div>` : ''}
      <div class="pp-label">${escapeHtml(t('profile.status'))}</div><div class="pp-value">${escapeHtml(isMe ? statusLabel(state.myStatus) : (online ? statusLabel(userStatusKey(userId)) : t('common.offline')))}</div>
      ${isMe ? `
        <button class="pp-action" data-action="open-settings-profile">${escapeHtml(t('profile.editSettings'))}</button>
        <button class="pp-action ghost" data-action="open-settings-appearance">${escapeHtml(t('profile.customizeTheme'))}</button>` : `
        ${!user.bot ? `<button class="pp-action" data-action="start-dm" data-id="${escapeHtml(userId)}">${escapeHtml(t('profile.sendDm'))}</button>` : ''}
        ${!user.bot && !isFriend && !isOutgoing ? `<button class="pp-action ghost" data-action="${isIncoming ? 'accept-friend' : 'add-friend'}" data-id="${escapeHtml(userId)}" data-username="${escapeHtml(user.username)}">${escapeHtml(isIncoming ? t('profile.acceptFriend') : t('profile.addFriend'))}</button>` : ''}
        ${!user.bot && isOutgoing ? `<div class="pp-value" style="margin-top:6px;color:var(--muted)">${escapeHtml(t('profile.friendRequested'))}</div>` : ''}
        <button class="pp-action ghost" data-action="mention-user" data-id="${escapeHtml(userId)}">${escapeHtml(t('profile.mention'))}</button>
        <button class="pp-action ghost" data-action="reply-to-user" data-id="${escapeHtml(userId)}">${escapeHtml(t('profile.replyLast'))}</button>
        ${canAdjustRole ? `<button class="pp-action ghost" data-action="toggle-member-role" data-id="${escapeHtml(userId)}" data-role="${nextRole}">${escapeHtml(t('profile.setRole', { role: nextMeta.label }))}</button>` : ''}
        ${server && ['owner', 'admin'].includes(server.role) && userId !== server.owner_id && (server.role === 'owner' || targetRole === 'member') ? `
          <div class="pp-divider"></div>
          <div class="pp-mod-row">
            <button class="pp-action ghost" data-action="mod-timeout" data-id="${escapeHtml(userId)}" data-name="${escapeHtml(user.display_name)}">${escapeHtml(t('mod.timeoutBtn'))}</button>
            <button class="pp-action ghost" data-action="mod-kick" data-id="${escapeHtml(userId)}" data-name="${escapeHtml(user.display_name)}">${escapeHtml(t('mod.kickBtn'))}</button>
            <button class="pp-action danger" data-action="mod-ban" data-id="${escapeHtml(userId)}" data-name="${escapeHtml(user.display_name)}">${escapeHtml(t('mod.banBtn'))}</button>
          </div>` : ''}`}
    </div>`;
  openOverlay('profile', anchor);
  positionPopout(anchor, node);
  node.querySelector('button')?.focus();
}

export function openDropdown(html, anchor) {
  const node = $('dropdown');
  node.innerHTML = html;
  openOverlay('dropdown', anchor);
  positionMenu(anchor, node);
  node.querySelector('button')?.focus();
}

/** Adds arrow-key navigation across open dropdown items. */
export function handleDropdownKeydown(e) {
  const buttons = [...$('dropdown').querySelectorAll('button:not([disabled])')];
  if (!buttons.length) return;
  const idx = buttons.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    buttons[(idx + 1) % buttons.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    buttons[(idx - 1 + buttons.length) % buttons.length].focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    buttons[0].focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    buttons[buttons.length - 1].focus();
  }
}

export function openServerMenu(anchor) {
  const server = currentServer();
  const canLeave = server && state.me && server.owner_id !== state.me.id;
  openDropdown(`
    <button data-action="server-invite">${ICONS.link} <span>${escapeHtml(t('menu.inviteFriends'))}</span></button>
    <button data-action="server-search">${ICONS.search} <span>${escapeHtml(t('chat.serverSearchTitle'))}</span></button>
    <button data-action="server-settings">${ICONS.settings} <span>${escapeHtml(t('menu.serverSettings'))}</span></button>
    <button data-action="create-channel">${ICONS.plus} <span>${escapeHtml(t('menu.createChannel'))}</span></button>
    <button data-action="directory">${ICONS.search} <span>${escapeHtml(t('menu.directory'))}</span></button>
    <button data-action="copy-server">${ICONS.copy} <span>${escapeHtml(t('menu.copyServer'))}</span></button>
    <div class="dd-sep"></div>
    <button data-action="toggle-members">${ICONS.members} <span>${escapeHtml(state.membersVisible ? t('menu.hideMembers') : t('menu.showMembers'))}</span></button>
    <button data-action="open-settings-appearance">${ICONS.settings} <span>${escapeHtml(t('menu.myAppearance'))}</span></button>
    ${canLeave ? `
      <div class="dd-sep"></div>
      <button class="danger" data-action="leave-server" data-id="${escapeHtml(server.id)}">${ICONS.logout} <span>${escapeHtml(t('menu.leaveServer'))}</span></button>` : ''}`, anchor);
}

export function openStatusMenu(anchor) {
  openDropdown(`
    <div class="dd-title">${escapeHtml(t('status.menuTitle'))}</div>
    ${STATUS_LIST.map((s) => `
      <button data-action="set-status" data-status="${s.key}" class="${state.myStatus === s.key ? 'selected' : ''}">
        <span class="status-dot ${s.dot} dd-dot"></span><span>${escapeHtml(statusLabel(s.key))}</span>${state.myStatus === s.key ? `<b>${ICONS.check}</b>` : ''}
      </button>`).join('')}
    <div class="dd-sep"></div>
    <button data-action="open-settings-profile">${ICONS.settings} <span>${escapeHtml(t('menu.accountSettings'))}</span></button>
    <button class="danger" data-action="logout">${ICONS.logout} <span>${escapeHtml(t('settings.logoutBtn'))}</span></button>`, anchor);
}

export function openChannelInfo(channelId, anchor) {
  const server = currentServer();
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!channel) return;
  const canManage = ['owner', 'admin'].includes(server.role);
  openDropdown(`
    <div class="dd-title">${channel.kind === 'text' ? '#' : ICONS.voice} ${escapeHtml(channel.name)}</div>
    <div class="dd-info">${escapeHtml(channel.topic || t('common.noTopic'))}</div>
    <div class="dd-sep"></div>
    <button data-action="channel-copy" data-id="${escapeHtml(channelId)}">${ICONS.copy} <span>${escapeHtml(t('sidebar.copyChannel'))}</span></button>
    <button data-action="channel-mark-read" data-id="${escapeHtml(channelId)}">${ICONS.check} <span>${escapeHtml(t('menu.markRead'))}</span></button>
    ${canManage ? `
      <div class="dd-sep"></div>
      <button data-action="channel-edit" data-id="${escapeHtml(channelId)}">${ICONS.settings} <span>${escapeHtml(t('chEdit.menuEdit'))}</span></button>
      <button class="danger" data-action="channel-delete" data-id="${escapeHtml(channelId)}">${ICONS.trash} <span>${escapeHtml(t('menu.deleteChannel'))}</span></button>` : ''}`, anchor);
}

export function openComposerMenu(anchor) {
  openDropdown(`
    <div class="dd-title">${escapeHtml(t('composer.attach'))}</div>
    <button data-action="attach-file">${ICONS.clip} <span>${escapeHtml(t('chat.attachFileMenu'))}</span></button>
    <button data-action="open-stickers">${ICONS.sticker} <span>${escapeHtml(t('chat.stickerMenu'))}</span></button>
    <div class="dd-sep"></div>
    <button data-action="insert-snippet" data-snippet="code"><span>${escapeHtml(t('composer.snippetCode'))}</span></button>
    <button data-action="insert-snippet" data-snippet="bold"><span>${escapeHtml(t('composer.snippetBold'))}</span></button>
    <button data-action="insert-snippet" data-snippet="mention"><span>${escapeHtml(t('composer.snippetMention'))}</span></button>`, anchor);
}

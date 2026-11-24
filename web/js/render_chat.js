/**
 * Message stream renderer, scroll tracking, and composer sizing helpers.
 */

import { getPendingAttachments, renderMessageAttachments } from './attachments.js';
import { hydrateLinkPreviews, renderLinkPreviews } from './chat_features.js';
import { t } from './i18n.js';
import { resolveProfile } from './profile_helpers.js';
import {
  $,
  ICONS,
  avatar,
  currentChannel,
  currentServer,
  dayKey,
  escapeHtml,
  fmtDay,
  fmtFull,
  fmtTime,
  formatContent,
  safeColor,
  state,
} from './state.js';

/** Returns true when the message viewport is scrolled near the bottom. */
export function nearBottom() {
  const el = $('messageScroll');
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

/** Smoothly jumps the message viewport to the latest message on next animation frame. */
export function scrollToBottom() {
  const el = $('messageScroll');
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

/** Shows remaining character budget once the composer exceeds 1,800 chars. */
export function updateCharCount() {
  const length = $('messageInput').value.length;
  const node = $('charCount');
  node.hidden = length < 1800;
  node.textContent = `${2000 - length}`;
  node.className = `char-count ${length > 1950 ? 'danger' : length > 1900 ? 'warn' : ''}`;
}

/** Toggles the floating jump-to-present button when scrolled far above bottom. */
export function updateJumpButton() {
  const el = $('messageScroll');
  $('jumpBtn').hidden = state.searchOpen || el.scrollHeight - el.scrollTop - el.clientHeight < 200;
}

/** Resizes the message composer textarea up to 160px and updates send button state. */
export function autoGrow() {
  const input = $('messageInput');
  input.style.height = 'auto';
  if (input.scrollHeight > 0) {
    input.style.height = `${Math.max(30, Math.min(input.scrollHeight, 160))}px`;
  }
  $('sendBtn').disabled = !input.value.trim() && !getPendingAttachments().length;
  updateCharCount();
}

/** Renders channel intro banner, day dividers, grouped messages, replies, and clean reactions. */
export function renderMessages() {
  const channel = currentChannel();
  $('channelIntro').hidden = !!state.search;
  $('channelIntro').innerHTML = channel ? `
    <div class="intro-icon">${channel.kind === 'text' ? '#' : ICONS.voiceLg}</div>
    <h2>${escapeHtml(t('chat.welcome', { name: channel.name }))}</h2>
    <p>${escapeHtml(channel.topic || t('chat.channelStart'))}</p>
    <div class="intro-line"></div>` : '';

  const canDeleteAll = ['owner', 'admin'].includes(currentServer()?.role);
  const query = state.search;
  const needle = query.toLowerCase();
  const visible = needle
    ? state.messages.filter((m) =>
        m.content.toLowerCase().includes(needle) || m.author.display_name.toLowerCase().includes(needle))
    : state.messages;

  let html = needle
    ? `<div class="search-summary">${escapeHtml(t('chat.searchSummary', { count: visible.length, query }))}
         <button data-action="clear-search">${escapeHtml(t('chat.clearSearch'))}</button></div>`
    : '';

  if (!visible.length) {
    html += needle
      ? `<div class="empty-state"><div class="empty-icon">${ICONS.searchLg}</div><h3>${escapeHtml(t('chat.noSearchTitle'))}</h3><p>${escapeHtml(t('chat.noSearchDesc'))}</p></div>`
      : `<div class="empty-state"><div class="empty-icon">${ICONS.chatLg}</div><h3>${escapeHtml(t('chat.emptyTitle'))}</h3><p>${escapeHtml(t('chat.emptyDesc'))}</p></div>`;
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
    const author = resolveProfile(m.author);
    const grouped = !needle && m.author.id === lastAuthor && time - lastTime < 5 * 60 * 1000 && !m.reply;
    const canDelete = canDeleteAll || (state.me && author.id === state.me.id);
    const replyAuthor = m.reply ? resolveProfile(m.reply.author) : null;
    const replyQuote = m.reply ? `
      <button class="reply-quote" data-action="goto-message" data-id="${escapeHtml(m.reply.id)}" title="${escapeHtml(t('chat.gotoOriginal'))}">
        ${avatar(replyAuthor, 'xs')}
        <span class="rq-name" style="color:${safeColor(replyAuthor.color)}">${escapeHtml(replyAuthor.display_name)}</span>
        <span class="rq-text">${escapeHtml(m.reply.content)}</span>
        <span class="rq-icon">${ICONS.reply}</span>
      </button>` : '';
    const reactions = m.reactions || [];
    const reactionHtml = reactions.length ? `
      <div class="reactions">
        ${reactions.map((r) => {
          const mine = Array.isArray(r.users) ? !!(state.me && r.users.includes(state.me.id)) : !!r.me;
          return `
          <button class="reaction ${mine ? 'mine' : ''}" data-action="reaction" data-id="${escapeHtml(m.id)}"
                  data-emoji="${escapeHtml(r.emoji)}" title="${escapeHtml(mine ? t('chat.removeReaction') : t('chat.addReaction'))}">
            <span>${escapeHtml(r.emoji)}</span><b>${r.count}</b>
          </button>`;
        }).join('')}
        <button class="reaction add" data-action="react-more" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.addReaction'))}">${ICONS.plus}</button>
      </div>` : '';

    html += `
      <div class="msg ${grouped ? 'grouped' : ''}" data-id="${escapeHtml(m.id)}">
        <div class="gutter">${grouped
          ? `<span class="timestamp-mini">${fmtTime(m.created_at)}</span>`
          : `<button class="avatar-btn" data-action="profile" data-id="${escapeHtml(author.id)}" aria-label="${escapeHtml(t('chat.profileAria', { name: author.display_name }))}">${avatar(author)}</button>`}</div>
        <div class="body">
          ${replyQuote}
          ${grouped ? '' : `<div class="meta">
            <button class="author" data-action="profile" data-id="${escapeHtml(author.id)}" style="color:${safeColor(author.color)}">${escapeHtml(author.display_name)}</button>
            ${author.bot ? `<span class="bot-tag">${escapeHtml(t('common.bot'))}</span>` : ''}
            ${m.pinned ? `<span class="pin-tag">${ICONS.pin} ${escapeHtml(t('chat.pinnedTag'))}</span>` : ''}
            <span class="time" title="${escapeHtml(fmtFull(m.created_at))}">${fmtTime(m.created_at)}</span>
          </div>`}
          <div class="content">${formatContent(m.content, query)}${m.edited_at ? `<span class="edited">${escapeHtml(t('chat.edited'))}</span>` : ''}</div>
          ${renderLinkPreviews(m.content)}
          ${renderMessageAttachments(m.attachments)}
          ${reactionHtml}
        </div>
        <div class="msg-toolbar">
          <button data-action="quick-react" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.quickReact'))}">+1</button>
          <button data-action="react-more" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.addReaction'))}">${ICONS.plus}</button>
          <button data-action="reply" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.reply'))}">${ICONS.reply}</button>
          <button data-action="pin-message" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.pinMessage'))}">${ICONS.pin}</button>
          ${state.me && author.id === state.me.id ? `<button data-action="edit-message" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.editMessage'))}">${ICONS.edit}</button>` : ''}
          <button data-action="copy-message" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.copyMessage'))}">${ICONS.copy}</button>
          ${canDelete ? `<button data-action="delete-message" data-id="${escapeHtml(m.id)}" title="${escapeHtml(t('chat.deleteMessage'))}">${ICONS.trash}</button>` : ''}
        </div>
      </div>`;
    lastAuthor = author.id;
    lastTime = time;
  }
  $('messageList').innerHTML = html;
  hydrateLinkPreviews();
}

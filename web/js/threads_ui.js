/**
 * Discussion thread management for channels and parent messages:
 * list channel threads, create new threads, live reply stream inside thread modal.
 */

import { api, handleError, toast } from './api.js';
import { renderMessageAttachments } from './attachments.js';
import { t } from './i18n.js';
import { openInspector } from './inspector_ui.js';
import { openModal } from './modals.js';
import { resolveProfile } from './profile_helpers.js';
import { renderMessages } from './render_chat.js';
import { $, avatar, currentChannel, currentServer, escapeHtml, fmtFull, fmtTime, formatContent, safeColor, state } from './state.js';

let activeThreadId = null;

function renderThreadMsgRow(m) {
  const author = resolveProfile(m.author);
  return `
    <div class="thread-msg">
      <div class="thread-msg-head">
        ${avatar(author, 'xs')}
        <b style="color:${safeColor(author.color)}">${escapeHtml(author.display_name)}</b>
        <span class="time" title="${escapeHtml(fmtFull(m.created_at))}">${fmtTime(m.created_at)}</span>
      </div>
      <div class="content">${formatContent(m.content, '')}</div>
      ${renderMessageAttachments(m.attachments)}
    </div>`;
}

function appendThreadMsgDom(msg) {
  const box = $('threadStream');
  if (!box) return;
  const empty = box.querySelector('.gal-empty');
  if (empty) empty.remove();
  box.insertAdjacentHTML('beforeend', renderThreadMsgRow(msg));
  box.scrollTop = box.scrollHeight;
}

/** Opens the interactive discussion stream in the right-side Inspector Panel. */
export async function openThreadViewModal(thread) {
  activeThreadId = thread.id;
  openInspector({
    title: thread.title,
    subtitle: t('thread.viewDesc', { count: thread.message_count ?? 0 }),
    onClose: () => { activeThreadId = null; },
    html: `
      <div id="threadStream" class="thread-stream"><p class="gal-empty">${escapeHtml(t('thread.loading'))}</p></div>
      <form id="threadReplyForm" class="thread-reply-form">
        <label for="threadReplyInput" class="visually-hidden">${escapeHtml(t('thread.replyLabel'))}</label>
        <input id="threadReplyInput" type="text" maxlength="2000" placeholder="${escapeHtml(t('thread.replyPh'))}" />
        <button type="submit" class="primary-btn" style="width:auto;margin:0;padding:8px 16px">${escapeHtml(t('thread.sendBtn'))}</button>
      </form>`,
  });

  const input = $('threadReplyInput');
  const form = $('threadReplyForm');
  input?.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
  });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input?.value?.trim() || '';
    if (!text) return;
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const msg = await api(`/threads/${encodeURIComponent(thread.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text, attachments: [] }),
      });
      input.value = '';
      if (!$(`#threadStream`)?.dataset[msg.id]) appendThreadMsgDom(msg);
      const parent = state.messages.find((m) => m.thread_id === thread.id);
      if (parent) {
        parent.thread_count = (parent.thread_count || 0) + 1;
        renderMessages();
      }
    } catch (err) {
      handleError(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  try {
    const list = await api(`/threads/${encodeURIComponent(thread.id)}/messages?limit=100`);
    const box = $('threadStream');
    if (box) {
      box.innerHTML = list.length
        ? list.map(renderThreadMsgRow).join('')
        : `<p class="gal-empty">${escapeHtml(t('thread.empty'))}</p>`;
      box.scrollTop = box.scrollHeight;
    }
  } catch (err) {
    handleError(err);
  }
}

/** Opens existing thread for a message, or opens a modal to start a new thread on it. */
export async function openMessageThread(messageId) {
  const msg = state.messages.find((m) => m.id === messageId);
  if (!msg) return;
  if (msg.thread_id) {
    await openThreadViewModal({ id: msg.thread_id, title: msg.thread_title || t('thread.defaultTitle'), message_count: msg.thread_count || 0 });
    return;
  }
  const ch = currentChannel();
  if (!ch || ch.kind !== 'text') return;
  openModal({
    title: t('thread.createTitle'),
    desc: t('thread.createDesc'),
    submitText: t('thread.createBtn'),
    html: `
      <label for="th_title">${escapeHtml(t('thread.titleLabel'))}</label>
      <input id="th_title" type="text" maxlength="80" placeholder="${escapeHtml(t('thread.titlePh'))}" />
      <label for="th_first">${escapeHtml(t('thread.firstMsgLabel'))}</label>
      <textarea id="th_first" rows="3" maxlength="2000" placeholder="${escapeHtml(t('thread.firstMsgPh'))}"></textarea>`,
    onSubmit: async () => {
      const title = $('th_title').value.trim();
      if (!title) throw new Error(t('thread.errTitle'));
      const content = $('th_first').value.trim();
      const created = await api(`/channels/${encodeURIComponent(ch.id)}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title, parent_message_id: msg.id, content: content || undefined }),
      });
      msg.thread_id = created.id;
      msg.thread_title = created.title;
      msg.thread_count = created.message_count || (content ? 1 : 0);
      renderMessages();
      toast(t('thread.createdToast'), 'ok');
      setTimeout(() => openThreadViewModal(created), 40);
    },
  });
}

/** Lists active channel threads inside the right-side Inspector Panel. */
export async function openChannelThreadsModal() {
  const ch = currentChannel();
  if (!ch || ch.kind !== 'text') return;
  openInspector({
    title: t('thread.listTitle', { name: ch.name }),
    subtitle: t('thread.listDesc'),
    html: `
      <form id="newChanThreadForm" class="thread-reply-form" style="margin:0 0 12px">
        <label for="newChanThreadTitle" class="visually-hidden">${escapeHtml(t('thread.titleLabel'))}</label>
        <input id="newChanThreadTitle" type="text" maxlength="80" placeholder="${escapeHtml(t('thread.newChanPh'))}" />
        <button type="submit" class="primary-btn" style="width:auto;margin:0;padding:8px 14px">${escapeHtml(t('thread.createBtn'))}</button>
      </form>
      <div id="channelThreadRows" class="gal-scroll"><p class="gal-empty">${escapeHtml(t('thread.loading'))}</p></div>`,
  });

  const renderRows = (threads) => {
    const wrap = $('channelThreadRows');
    if (!wrap) return;
    if (!threads.length) { wrap.innerHTML = `<p class="gal-empty">${escapeHtml(t('thread.noneInChannel'))}</p>`; return; }
    wrap.innerHTML = threads.map((th) => `
      <button type="button" class="thread-list-row" data-open-thread="${escapeHtml(th.id)}">
        <div><b>${escapeHtml(th.title)}</b><small>${escapeHtml(th.creator_name)} · ${escapeHtml(t('thread.replyCount', { count: th.message_count }))}</small></div>
        <span>${escapeHtml(t('thread.openBtn'))}</span>
      </button>`).join('');
    wrap.querySelectorAll('[data-open-thread]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = threads.find((x) => x.id === btn.dataset.openThread);
        if (target) openThreadViewModal(target);
      });
    });
  };

  $('newChanThreadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('newChanThreadTitle')?.value?.trim() || '';
    if (!title) return;
    try {
      const created = await api(`/channels/${encodeURIComponent(ch.id)}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      toast(t('thread.createdToast'), 'ok');
      openThreadViewModal(created);
    } catch (err) {
      handleError(err);
    }
  });

  try {
    const threads = await api(`/channels/${encodeURIComponent(ch.id)}/threads`);
    renderRows(threads);
  } catch (err) {
    handleError(err);
  }
}

/** Handles realtime `thread_create` WS event to update message badges. */
export function handleThreadCreateWs(thread) {
  if (!thread?.parent_message_id) return;
  const target = state.messages.find((m) => m.id === thread.parent_message_id);
  if (target) {
    target.thread_id = thread.id;
    target.thread_title = thread.title;
    target.thread_count = thread.message_count || 0;
    renderMessages();
  }
}

/** Handles realtime `thread_message_create` WS event for counters and open thread dialog. */
export function handleThreadMessageWs(event) {
  const parent = state.messages.find((m) => m.thread_id === event.thread_id);
  if (parent) {
    parent.thread_count = (parent.thread_count || 0) + 1;
    renderMessages();
  }
  const backdrop = $('modalBackdrop');
  if (backdrop && !backdrop.hidden && activeThreadId === event.thread_id && event.message) {
    const srv = currentServer();
    if (srv && event.server_id === srv.id && event.message.author?.id !== state.me?.id) {
      appendThreadMsgDom(event.message);
    }
  }
}

/**
 * Chat stream and composer DOM event bindings: message actions, IME-safe submit,
 * typing notifications, reaction picker selection, reply bar, and jump-to-present.
 */

import { clearReply, clearSearch, sendMessage, setReply, toggleReaction } from './actions.js';
import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { openComposerMenu, openEmojiPicker, openProfile, pickEmoji } from './menus.js';
import { autoGrow, renderMessages, scrollToBottom, updateJumpButton } from './render_chat.js';
import { $, currentChannel, state } from './state.js';

/** Wires event delegation for the message stream, composer textarea, and scroll helpers. */
export function bindMessageEvents() {
  $('messageList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'delete-message') {
      try {
        await api(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.messages = state.messages.filter((m) => m.id !== id);
        renderMessages();
      } catch (error) { handleError(error); }
    } else if (action === 'reaction') toggleReaction(id, btn.dataset.emoji);
    else if (action === 'quick-react') toggleReaction(id, '+1');
    else if (action === 'react-more') openEmojiPicker(btn, { type: 'reaction', messageId: id });
    else if (action === 'reply') setReply(id);
    else if (action === 'copy-message') {
      const targetMsg = state.messages.find((m) => m.id === id);
      if (targetMsg) {
        navigator.clipboard?.writeText(targetMsg.content)
          .then(() => toast(t('chat.copiedMessage'), 'ok'))
          .catch(() => toast(t('common.copyFailed'), 'err'));
      }
    } else if (action === 'profile') openProfile(id, btn);
    else if (action === 'clear-search') clearSearch();
    else if (action === 'goto-message') {
      const target = document.querySelector(`.msg[data-id="${id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1400);
      } else toast(t('chat.originalOutOfRange'));
    }
  });

  $('messageInput').addEventListener('input', () => {
    autoGrow();
    const now = Date.now();
    if (now - state.lastTypingSent > 1800 && state.ws?.readyState === 1 && currentChannel()) {
      state.lastTypingSent = now;
      state.ws.send(JSON.stringify({ type: 'typing', channel_id: state.currentChannelId }));
    }
  });
  $('messageInput').addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('sendBtn').addEventListener('click', sendMessage);
  $('attachBtn').addEventListener('click', (e) => openComposerMenu(e.currentTarget));
  $('emojiPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (btn) pickEmoji(btn.dataset.emoji);
  });
  $('replyBar').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel-reply"]')) clearReply();
  });
  $('jumpBtn').addEventListener('click', () => { scrollToBottom(); $('jumpBtn').hidden = true; });
  $('messageScroll').addEventListener('scroll', updateJumpButton);
}

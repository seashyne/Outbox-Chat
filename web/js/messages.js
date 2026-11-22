/**
 * Message stream loading, caching, posting, replies, and reactions.
 */

import { api, handleError } from './api.js';
import { autoGrow, nearBottom, renderMessages, scrollToBottom } from './render_chat.js';
import { renderReplyBar } from './render_shell.js';
import { $, currentChannel, state } from './state.js';

/** Clears any active reply target and updates the reply bar. */
export function clearReply() {
  state.replyTo = null;
  renderReplyBar();
}

/** Targets a specific message for replying and focuses the composer. */
export function setReply(messageId) {
  const message = state.messages.find((m) => m.id === messageId);
  if (!message) return;
  state.replyTo = message;
  renderReplyBar();
  $('messageInput').focus();
}

/** Toggles a reaction token on a message and updates the message list. */
export async function toggleReaction(messageId, emoji) {
  try {
    const updated = await api(`/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index !== -1) state.messages[index] = updated;
    renderMessages();
  } catch (error) {
    handleError(error);
  }
}

/** Loads cached messages immediately then refreshes from `/api/channels/{id}/messages`. */
export async function loadMessages() {
  const channel = currentChannel();
  if (!channel || channel.kind !== 'text' || (state.homeMode && !state.dmChannel)) {
    state.messages = [];
    renderMessages();
    $('jumpBtn').hidden = true;
    return;
  }
  const cid = channel.id;
  const cached = state.messageCache.get(cid);
  if (cached) {
    state.messages = [...cached];
    renderMessages();
    scrollToBottom();
    $('jumpBtn').hidden = true;
  }
  try {
    const fresh = await api(`/channels/${encodeURIComponent(cid)}/messages?limit=60`);
    state.messageCache.set(cid, fresh);
    if (currentChannel()?.id === cid) {
      state.messages = [...fresh];
      renderMessages();
      if (!cached || nearBottom()) scrollToBottom();
      $('jumpBtn').hidden = true;
    }
  } catch (error) {
    if (!cached) handleError(error);
  }
}

/** Reloads current channel messages while preserving scroll position. */
export async function refreshMessages() {
  const channel = currentChannel();
  if (!channel || channel.kind !== 'text') return;
  try {
    const stick = nearBottom();
    const fresh = await api(`/channels/${encodeURIComponent(channel.id)}/messages?limit=60`);
    state.messageCache.set(channel.id, fresh);
    state.messages = [...fresh];
    renderMessages();
    if (stick) scrollToBottom();
  } catch (error) {
    handleError(error);
  }
}

/** Appends a new incoming or sent message into cache and active stream without duplicates. */
export function appendMessage(message) {
  const cid = message.channel_id;
  const list = state.messageCache.get(cid);
  if (list && list !== state.messages && !list.some((m) => m.id === message.id)) {
    list.push(message);
    if (list.length > 200) list.shift();
  }
  if (currentChannel()?.id !== cid) return;
  if (state.messages.some((m) => m.id === message.id)) return;
  const stick = nearBottom();
  state.messages.push(message);
  if (state.messages.length > 200) state.messages.shift();
  renderMessages();
  if (stick) scrollToBottom();
}

/** Sends composer input to the active text channel or 1-on-1 DM channel. */
export async function sendMessage() {
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
  } catch (error) {
    handleError(error);
  }
}

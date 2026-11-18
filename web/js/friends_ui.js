/**
 * Friends & 1-on-1 Direct Message UI controller: manages `@username` friend requests,
 * incoming/outgoing lists, and opening private chats from the Home view or profile card.
 */

import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { $, avatar, escapeHtml, isOnline, state, statusLabel, userStatusKey } from './state.js';

let activeTab = 'all';

/** Refreshes `state.friends` from `/api/friends`. */
export async function loadFriends() {
  if (!state.token) return;
  try {
    const data = await api('/friends');
    if (data) state.friends = data;
  } catch {}
}

/** Sends a friend request by `@handle` and refreshes UI lists. */
export async function sendFriendRequest(username, onUpdated) {
  const handle = String(username || '').trim().replace(/^@+/, '');
  if (!handle) { toast(t('friends.enterHandleErr'), 'err'); return; }
  const data = await api('/friends/request', {
    method: 'POST',
    body: JSON.stringify({ username: handle }),
  });
  state.friends = data;
  toast(t('friends.requestSentToast'), 'ok');
  onUpdated?.();
}

/** Accepts a pending incoming friend request from `userId`. */
export async function acceptFriendRequest(userId, onUpdated) {
  const data = await api(`/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST' });
  state.friends = data;
  toast(t('friends.acceptedToast'), 'ok');
  onUpdated?.();
}

/** Removes a friend or cancels/declines a pending request. */
export async function removeFriendEntry(userId, onUpdated) {
  const data = await api(`/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  state.friends = data;
  toast(t('friends.updatedToast'));
  onUpdated?.();
}

/** Opens a 1-on-1 private chat (`POST /api/dm/{userId}`) and returns the channel + peer. */
export async function openDirectChat(userId, fallbackUser, onOpenChannel) {
  const res = await api(`/dm/${encodeURIComponent(userId)}`, { method: 'POST' });
  const peer =
    fallbackUser ||
    state.friends?.friends?.find((f) => f.user.id === userId)?.user ||
    { id: userId, username: 'user', display_name: t('friends.dmFallback'), color: '#5865f2' };
  state.homeMode = true;
  state.voiceChannelId = null;
  state.dmChannel = res.channel;
  state.dmPeer = peer;
  onOpenChannel?.(res.channel, peer);
}

/** Renders the sidebar DM list when Home/Friends mode is active. */
export function renderHomeSidebar() {
  const friends = state.friends?.friends || [];
  const incomingCount = (state.friends?.incoming || []).length;
  $('serverHeader').innerHTML = `
    <span class="server-name" style="padding:0 6px;cursor:default">${escapeHtml(t('friends.sidebarTitle'))}</span>`;
  $('channelList').innerHTML = `
    <div class="channel-group">
      <div class="group-head"><span>${escapeHtml(t('friends.home'))}</span></div>
      <div class="channel-row">
        <button class="channel-item ${!state.dmChannel ? 'active' : ''}" data-action="home-friends">
          <span class="hash">@</span>
          <span class="ch-name">${escapeHtml(t('friends.list'))}</span>
          ${incomingCount ? `<span class="mention-badge">${incomingCount}</span>` : ''}
        </button>
      </div>
    </div>
    <div class="channel-group">
      <div class="group-head"><span>${escapeHtml(t('friends.dms', { count: friends.length }))}</span></div>
      ${friends.length
        ? friends.map((f) => {
            const active = state.dmChannel?.id === f.dm_channel_id;
            return `<div class="channel-row">
              <button class="channel-item ${active ? 'active' : ''}" data-action="open-dm" data-id="${escapeHtml(f.user.id)}">
                ${avatar(f.user, 'xs')}
                <span class="ch-name">${escapeHtml(f.user.display_name)}</span>
              </button>
            </div>`;
          }).join('')
        : `<div class="channel-empty">${escapeHtml(t('friends.none'))}</div>`}
    </div>`;
}

/** Renders the main Friends panel inside `#friendsStage` when in Home/Friends view. */
export function renderFriendsStage(refreshUi, openDmCb) {
  const stage = $('friendsStage');
  const msgScroll = $('messageScroll');
  const typingRow = $('typingRow');
  const composerWrap = document.querySelector('.composer-wrap');
  const jumpBtn = $('jumpBtn');
  if (!stage) return;

  const showFriends = Boolean(state.homeMode && !state.dmChannel);
  if (!showFriends) {
    stage.hidden = true;
    return;
  }

  stage.hidden = false;
  if ($('meetingStage')) $('meetingStage').hidden = true;
  msgScroll.hidden = true;
  typingRow.hidden = true;
  if (composerWrap) composerWrap.hidden = true;
  if (jumpBtn) jumpBtn.hidden = true;

  const friends = state.friends?.friends || [];
  const incoming = state.friends?.incoming || [];
  const outgoing = state.friends?.outgoing || [];
  const list = activeTab === 'pending' ? incoming : activeTab === 'sent' ? outgoing : friends;

  const cardHtml = (item) => {
    const u = item.user;
    const online = isOnline(u.id);
    const st = online ? (u.status_text || statusLabel(userStatusKey(u.id))) : t('common.offline');
    const removeLabel = item.direction === 'friend'
      ? t('friends.removeBtn')
      : item.direction === 'incoming'
        ? t('friends.declineBtn')
        : t('common.cancel');
    return `
      <div class="friend-card">
        <div class="fc-left">
          ${avatar(u, 'sm')}
          <div class="fc-meta">
            <b>${escapeHtml(u.display_name)} <span>@${escapeHtml(u.username)}</span></b>
            <small>${escapeHtml(st)}</small>
          </div>
        </div>
        <div class="fc-actions">
          ${item.direction === 'friend' ? `<button type="button" class="mt-btn join" data-f-action="dm" data-id="${escapeHtml(u.id)}">${escapeHtml(t('friends.chatBtn'))}</button>` : ''}
          ${item.direction === 'incoming' ? `<button type="button" class="mt-btn join" data-f-action="accept" data-id="${escapeHtml(u.id)}">${escapeHtml(t('friends.acceptBtn'))}</button>` : ''}
          <button type="button" class="mt-btn" data-f-action="remove" data-id="${escapeHtml(u.id)}">${escapeHtml(removeLabel)}</button>
        </div>
      </div>`;
  };

  stage.innerHTML = `
    <div class="friends-head">
      <h2>${escapeHtml(t('friends.heading'))}</h2>
      <div class="friends-tabs" role="tablist">
        <button type="button" class="ftab ${activeTab === 'all' ? 'active' : ''}" data-ftab="all">${escapeHtml(t('friends.tabAll', { count: friends.length }))}</button>
        <button type="button" class="ftab ${activeTab === 'pending' ? 'active' : ''}" data-ftab="pending">${escapeHtml(t('friends.tabIncoming', { count: incoming.length }))}</button>
        <button type="button" class="ftab ${activeTab === 'sent' ? 'active' : ''}" data-ftab="sent">${escapeHtml(t('friends.tabSent', { count: outgoing.length }))}</button>
      </div>
    </div>
    <form class="friend-add-bar" id="friendAddForm">
      <input id="friendAddInput" type="text" maxlength="33" placeholder="${escapeHtml(t('friends.addPlaceholder'))}" aria-label="${escapeHtml(t('friends.addAria'))}" />
      <button type="submit" class="primary-btn">${escapeHtml(t('friends.addBtn'))}</button>
    </form>
    <div class="friends-list">
      ${list.length ? list.map(cardHtml).join('') : `<div class="channel-empty" style="padding:28px 10px">${escapeHtml(t('friends.emptyTab'))}</div>`}
    </div>`;

  stage.querySelectorAll('[data-ftab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.ftab; renderFriendsStage(refreshUi, openDmCb); });
  });
  $('friendAddForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sendFriendRequest($('friendAddInput').value, refreshUi);
      $('friendAddInput').value = '';
    } catch (error) { handleError(error); }
  });
  stage.querySelector('.friends-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-f-action]');
    if (!btn) return;
    const uid = btn.dataset.id;
    try {
      if (btn.dataset.fAction === 'dm') await openDirectChat(uid, null, openDmCb);
      else if (btn.dataset.fAction === 'accept') await acceptFriendRequest(uid, refreshUi);
      else if (btn.dataset.fAction === 'remove') await removeFriendEntry(uid, refreshUi);
    } catch (error) { handleError(error); }
  });
}

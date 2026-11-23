/**
 * Notification helpers: gentle Web Audio notification chimes and optional browser
 * desktop alerts for new DMs, mentions, incoming friend requests, and DM calls.
 */

import { toast } from './api.js';
import { t } from './i18n.js';
import { $, ICONS, avatar, escapeHtml, state } from './state.js';

const SOUND_KEY = 'ob_notify_sound';
let audioCtx = null;

/** Returns true when notification sound is enabled in local preferences. */
export function isSoundEnabled() {
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

/** Persists notification sound toggle (`true` = enabled, `false` = muted). */
export function setSoundEnabled(enabled) {
  localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
}

function playTone(freq, startAt, duration, gainPeak = 0.055) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Plays a soft chime (`message`, `friend`, or `call`) respecting DND and sound toggle. */
export function playNotifyChime(kind = 'message') {
  if (!isSoundEnabled()) return;
  if (state.myStatus === 'dnd' || state.myStatus === 'invisible' || state.deafened) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    if (kind === 'call') {
      playTone(660, now, 0.16, 0.07);
      playTone(880, now + 0.19, 0.22, 0.07);
    } else if (kind === 'friend') {
      playTone(587, now, 0.12);
      playTone(784, now + 0.13, 0.18);
    } else {
      playTone(740, now, 0.1);
      playTone(880, now + 0.11, 0.14);
    }
  } catch {}
}

/** Shows a desktop Notification when permission is granted and the tab is backgrounded. */
export function sendDesktopNotification(title, body, onClick) {
  if (state.myStatus === 'dnd' || state.myStatus === 'invisible') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const note = new Notification(title, { body: String(body || '').slice(0, 140), tag: 'outbox-chat' });
    note.onclick = () => {
      window.focus();
      note.close();
      onClick?.();
    };
  } catch {}
}

/** Requests desktop notification permission from a user-initiated button click. */
export async function requestDesktopNotifications() {
  if (typeof Notification === 'undefined') {
    toast(t('notify.unsupported'), 'err');
    return 'unsupported';
  }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? t('notify.enabledToast') : t('notify.deniedToast'), perm === 'granted' ? 'ok' : 'err');
  return perm;
}

/** Renders or hides the incoming 1-on-1 DM call notification banner (`#dmCallBanner`). */
export function renderDmCallBanner(incoming) {
  const banner = $('dmCallBanner');
  if (!banner) return;
  if (!incoming || !incoming.channelId || state.joinedVoiceChannelId === incoming.channelId) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  const peer = incoming.peer || { display_name: t('friends.dmHeader'), color: '#5865f2' };
  banner.hidden = false;
  banner.innerHTML = `
    <div class="dm-call-who">
      ${avatar(peer, 'xs')}
      <span>${escapeHtml(t('dm.incomingCall', { name: peer.display_name }))}</span>
    </div>
    <div class="dm-call-actions">
      <button type="button" class="mt-btn join" data-action="dm-call-accept" data-id="${escapeHtml(incoming.channelId)}">${ICONS.phone} ${escapeHtml(t('dm.acceptCall'))}</button>
      <button type="button" class="mt-btn leave" data-action="dm-call-decline" data-id="${escapeHtml(incoming.channelId)}">${escapeHtml(t('dm.declineCall'))}</button>
    </div>`;
}

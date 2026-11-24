/**
 * Voice note recording in the chat composer using `MediaRecorder` + binary upload.
 */

import { appendMessage, clearReply } from './actions.js';
import { api, handleError, toast } from './api.js';
import { clearPendingAttachments, getPendingAttachments } from './attachments.js';
import { t } from './i18n.js';
import { uploadBinaryAttachment } from './media_gallery.js';
import { autoGrow, scrollToBottom } from './render_chat.js';
import { $, currentChannel, currentServer, escapeHtml, state } from './state.js';

let recorder = null;
let recStream = null;
let recChunks = [];
let recTimer = null;
let recStartedAt = 0;
let recDiscard = false;

function preferredAudioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const cand of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(cand)) return cand;
  }
  return '';
}

function stopStream() {
  clearInterval(recTimer);
  recTimer = null;
  recStream?.getTracks().forEach((tr) => tr.stop());
  recStream = null;
}

function renderRecBar(active, secs = 0) {
  const bar = $('voiceRecBar');
  if (!bar) return;
  bar.hidden = !active;
  $('voiceNoteBtn')?.classList.toggle('recording', active);
  if (!active) { bar.innerHTML = ''; return; }
  const mm = String(Math.floor(secs / 60)).padStart(1, '0');
  const ss = String(secs % 60).padStart(2, '0');
  bar.innerHTML = `
    <span class="vr-dot" aria-hidden="true"></span>
    <span class="vr-label">${escapeHtml(t('voiceNote.recording', { time: `${mm}:${ss}` }))}</span>
    <span class="spacer"></span>
    <button type="button" class="ghost-btn" data-vr="cancel">${escapeHtml(t('common.cancel'))}</button>
    <button type="button" class="primary-btn" style="width:auto;min-height:30px;margin:0;padding:4px 12px" data-vr="send">${escapeHtml(t('voiceNote.sendBtn'))}</button>`;
}

/** Starts or sends a voice message recording directly to the active channel/DM. */
export async function toggleVoiceNoteRecording() {
  if (recorder && recorder.state === 'recording') {
    recDiscard = false;
    recorder.stop();
    return;
  }
  const ch = currentChannel();
  if (!ch || ch.kind !== 'text') return;
  const server = currentServer();
  const isManager = ['owner', 'admin'].includes(server?.role);
  if (!state.homeMode && server?.my_timeout_until && Date.parse(server.my_timeout_until) > Date.now()) {
    toast(t('mod.timedOutNotice'), 'err');
    return;
  }
  if (!state.homeMode && ch.read_only && !isManager) {
    toast(t('perm.readOnlyNotice'), 'err');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast(t('voiceNote.unsupported'), 'err');
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = preferredAudioMime();
    recChunks = [];
    recDiscard = false;
    recorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    recorder.ondataavailable = (ev) => { if (ev.data?.size > 0) recChunks.push(ev.data); };
    recorder.onstop = async () => {
      stopStream();
      renderRecBar(false);
      const chunks = recChunks;
      const usedMime = (recorder?.mimeType || mime || 'audio/webm').split(';')[0].trim();
      recorder = null;
      recChunks = [];
      if (recDiscard || !chunks.length) return;
      const ext = usedMime.includes('mp4') ? 'm4a' : usedMime.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks, { type: usedMime });
      await sendRecordedVoiceBlob(blob, `voice-note-${Date.now().toString().slice(-4)}.${ext}`, ch);
    };
    recStartedAt = Date.now();
    recorder.start(250);
    renderRecBar(true, 0);
    recTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - recStartedAt) / 1000);
      renderRecBar(true, secs);
      if (secs >= 120 && recorder?.state === 'recording') {
        recDiscard = false;
        recorder.stop();
      }
    }, 500);
  } catch {
    stopStream();
    renderRecBar(false);
    toast(t('voiceNote.micDenied'), 'err');
  }
}

async function sendRecordedVoiceBlob(blob, filename, channel) {
  try {
    toast(t('voiceNote.uploading'));
    const uploaded = await uploadBinaryAttachment(blob, filename);
    const input = $('messageInput');
    const content = input?.value?.trim() || '';
    const extraAtts = getPendingAttachments();
    const message = await api(`/channels/${encodeURIComponent(channel.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        reply_to: state.replyTo ? state.replyTo.id : null,
        attachments: [...extraAtts, { name: uploaded.name, mime: uploaded.mime, size: uploaded.size, data_url: uploaded.url }],
      }),
    });
    if (input) input.value = '';
    clearPendingAttachments();
    clearReply();
    autoGrow();
    appendMessage(message);
    scrollToBottom();
  } catch (err) {
    handleError(err);
  }
}

/** Wires click events for the voice note record button and floating recorder bar. */
export function bindVoiceNoteEvents() {
  $('voiceNoteBtn')?.addEventListener('click', toggleVoiceNoteRecording);
  $('voiceRecBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vr]');
    if (!btn || !recorder || recorder.state !== 'recording') return;
    recDiscard = btn.dataset.vr === 'cancel';
    recorder.stop();
  });
}

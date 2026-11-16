/**
 * Meeting Room Stage UI controller: renders active room participant tiles,
 * audio-only/data-saver status, remote media streams, and accessible media toolbar.
 * Lazily imports `meeting_rtc.js` only when joining an active Meeting Room.
 */

import { api, handleError, toast } from './api.js';
import { memberRoleFor, roleMeta } from './server_templates.js';
import { $, ICONS, avatar, escapeHtml, state, userById } from './state.js';

let rtcMod = null;
const remoteStreams = new Map();
let localStreamRef = null;

async function getRtc() {
  if (!rtcMod) rtcMod = await import('./meeting_rtc.js');
  return rtcMod;
}

function attachMediaNodes() {
  const audioBox = $('meetingAudio');
  if (audioBox) {
    for (const [peerId, stream] of remoteStreams.entries()) {
      let audio = audioBox.querySelector(`audio[data-peer="${peerId}"]`);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.peer = peerId;
        audioBox.appendChild(audio);
      }
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.muted = Boolean(state.deafened);
    }
    audioBox.querySelectorAll('audio[data-peer]').forEach((el) => {
      if (!remoteStreams.has(el.dataset.peer)) el.remove();
    });
  }

  document.querySelectorAll('#meetingStage video[data-video-peer]').forEach((vid) => {
    const peerId = vid.dataset.videoPeer;
    const stream = peerId === state.me?.id ? localStreamRef : remoteStreams.get(peerId);
    if (stream && vid.srcObject !== stream) vid.srcObject = stream;
  });
}

function resolveViewedVoiceChannel() {
  const id = state.voiceChannelId || state.joinedVoiceChannelId;
  if (!id) return null;
  for (const s of state.servers) {
    const ch = s.channels.find((c) => c.id === id && c.kind === 'voice');
    if (ch) return { channel: ch, server: s };
  }
  return null;
}

/** Renders the Meeting Room Stage inside `<main class="chat">` when a voice room is focused. */
export function renderMeetingStage(renderSidebarFn, renderUserFn) {
  const stage = $('meetingStage');
  const msgScroll = $('messageScroll');
  const typingRow = $('typingRow');
  const composerWrap = document.querySelector('.composer-wrap');
  const jumpBtn = $('jumpBtn');
  if (!stage) return;

  const focused = Boolean(state.voiceChannelId);
  const ctx = focused ? resolveViewedVoiceChannel() : null;
  if (!focused || !ctx) {
    stage.hidden = true;
    msgScroll.hidden = false;
    typingRow.hidden = false;
    if (composerWrap) composerWrap.hidden = false;
    attachMediaNodes();
    return;
  }

  const { channel, server } = ctx;
  const users = state.voice[channel.id] || [];
  const inThisRoom = Boolean(state.me && state.joinedVoiceChannelId === channel.id && users.includes(state.me.id));
  const saver = Boolean(state.meetingDataSaver);
  const stats = state.meetingStats || {};
  const canCreate = ['owner', 'admin'].includes(server.role) || server.roles_config?.allow_member_create_channel !== false;

  stage.hidden = false;
  msgScroll.hidden = true;
  typingRow.hidden = true;
  if (composerWrap) composerWrap.hidden = true;
  if (jumpBtn) jumpBtn.hidden = true;

  const tileHtml = (uid) => {
    const u = userById(uid);
    const isMe = state.me && uid === state.me.id;
    const peer = state.meetingPeers.get(uid) || {};
    const muted = isMe ? state.muted : Boolean(peer.muted);
    const deafened = isMe ? state.deafened : Boolean(peer.deafened);
    const speaking = Boolean(peer.speaking && !muted && !deafened);
    const stream = isMe ? localStreamRef : remoteStreams.get(uid);
    const liveVideo = Boolean(stream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted));
    const hasVideo = isMe ? (Boolean(state.meetingVideo || state.meetingScreen) && liveVideo) : (peer.video !== false && liveVideo);
    const rMeta = roleMeta(server, memberRoleFor(server, uid));
    return `
      <div class="meeting-tile ${speaking ? 'speaking' : ''} ${hasVideo ? 'has-video' : ''}">
        ${hasVideo
          ? `<video autoplay playsinline ${isMe ? 'muted' : ''} data-video-peer="${escapeHtml(uid)}"></video>`
          : avatar(u, 'lg')}
        <div class="mt-footer">
          <span class="mt-name" style="color:${hasVideo ? '#fff' : rMeta.color}">${escapeHtml(u.display_name)}${isMe ? ' (คุณ)' : ''}</span>
        </div>
        <div class="mt-flags">
          ${muted ? '<span class="mt-flag muted">ปิดไมค์</span>' : '<span class="mt-flag live">เปิดไมค์</span>'}
          ${deafened ? '<span class="mt-flag muted">ปิดเสียง</span>' : ''}
          ${isMe && state.meetingListenOnly ? '<span class="mt-flag">ฟังอย่างเดียว</span>' : ''}
        </div>
      </div>`;
  };

  stage.innerHTML = `
    <div class="meeting-head">
      <div class="meeting-title-wrap">
        <div class="meeting-title">
          ${ICONS.voice} <span>${escapeHtml(channel.name)}</span>
          <span class="voice-badge">${users.length} คนในห้อง</span>
        </div>
        <div class="meeting-sub">${escapeHtml(channel.topic || 'ห้องสนทนาเสียงและแชร์หน้าจอแบบประหยัดข้อมูล')}</div>
      </div>
      <div class="meeting-metrics">
        <span class="meeting-chip ${saver ? 'saver-on' : ''}">${ICONS.saver} ${saver ? 'ประหยัดข้อมูล (16 kbps)' : 'เสียงคมชัด (48 kbps)'}</span>
        ${inThisRoom ? `<span class="meeting-chip">${stats.kbpsUp || 0} / ${stats.kbpsDown || 0} kbps · ${stats.totalKb || 0} KB${stats.rttMs != null ? ` · ${stats.rttMs} ms` : ''}</span>` : ''}
        ${canCreate ? `<button type="button" class="meeting-create-btn" data-action="create-voice-room">${ICONS.plus} สร้างห้องประชุม</button>` : ''}
      </div>
    </div>
    <div class="meeting-body">
      ${users.length
        ? `<div class="meeting-grid" id="meetingGrid">${users.map(tileHtml).join('')}</div>`
        : `<div class="meeting-empty">
             ${ICONS.voiceLg}
             <h3>ห้องประชุม "${escapeHtml(channel.name)}" พร้อมใช้งาน</h3>
             <p>เชื่อมต่อเสียงแบบ P2P ทันทีพร้อมโหมดประหยัดข้อมูล (DTX ~16 kbps ปิดวิดีโออัตโนมัติ)</p>
             <button type="button" class="meeting-join-cta" data-action="voice-join" data-id="${escapeHtml(channel.id)}">เข้าร่วมห้องประชุมทันที</button>
           </div>`}
    </div>
    <div class="meeting-toolbar-wrap">
      <div class="meeting-toolbar" role="toolbar" aria-label="ตัวควบคุมห้องประชุม">
        ${inThisRoom ? `
          <button type="button" class="mt-btn danger" data-action="toggle-mute" aria-pressed="${state.muted ? 'true' : 'false'}" aria-label="ไมโครโฟน">${ICONS.mic} <span>${state.muted ? 'เปิดไมค์' : 'ปิดไมค์'}</span></button>
          <button type="button" class="mt-btn danger" data-action="toggle-deafen" aria-pressed="${state.deafened ? 'true' : 'false'}" aria-label="เสียงลำโพง">${ICONS.headphones} <span>${state.deafened ? 'เปิดเสียง' : 'ปิดเสียง'}</span></button>
          <button type="button" class="mt-btn" data-action="toggle-cam" aria-pressed="${state.meetingVideo ? 'true' : 'false'}" aria-label="กล้อง">${ICONS.video} <span>กล้อง</span></button>
          <button type="button" class="mt-btn" data-action="toggle-screen" aria-pressed="${state.meetingScreen ? 'true' : 'false'}" aria-label="แชร์หน้าจอ">${ICONS.screen} <span>แชร์จอ</span></button>
          <button type="button" class="mt-btn saver" data-action="toggle-data-saver" aria-pressed="${saver ? 'true' : 'false'}" aria-label="โหมดประหยัดข้อมูล">${ICONS.saver} <span>ประหยัดข้อมูล</span></button>
          <button type="button" class="mt-btn" data-action="focus-text-chat">กลับไปหน้าแชท</button>
          <button type="button" class="mt-btn leave" data-action="voice-leave" data-id="${escapeHtml(channel.id)}">${ICONS.logout} <span>ออกจากห้อง</span></button>
        ` : `
          <button type="button" class="mt-btn saver" data-action="toggle-data-saver" aria-pressed="${saver ? 'true' : 'false'}">${ICONS.saver} <span>โหมดประหยัดข้อมูล: ${saver ? 'เปิด' : 'ปิด'}</span></button>
          <button type="button" class="mt-btn join" data-action="voice-join" data-id="${escapeHtml(channel.id)}">${ICONS.voice} <span>เข้าร่วมห้องประชุม</span></button>
          <button type="button" class="mt-btn" data-action="focus-text-chat">กลับไปหน้าแชท</button>
        `}
      </div>
    </div>`;

  attachMediaNodes();
  void renderSidebarFn;
  void renderUserFn;
}

/** Joins voice room via REST + dynamically initializes WebRTC P2P session. */
export async function joinMeetingRoom(channelId, refreshUi) {
  if (!state.ws || state.ws.readyState !== 1) {
    toast('กำลังเชื่อมต่ออยู่ กรุณารอสักครู่แล้วลองใหม่', 'err');
    return;
  }
  const res = await api(`/channels/${encodeURIComponent(channelId)}/voice/join`, { method: 'POST' });
  if (res.users.length) state.voice[channelId] = res.users;
  state.voiceChannelId = channelId;
  state.joinedVoiceChannelId = channelId;
  refreshUi();

  const rtc = await getRtc();
  await rtc.joinMeetingRtc(channelId, res.users, {
    onRemoteStream: (peerId, stream) => {
      if (stream) remoteStreams.set(peerId, stream);
      else remoteStreams.delete(peerId);
      refreshUi();
    },
    onLocalVideo: (stream) => { localStreamRef = stream; refreshUi(); },
    onStateChange: () => refreshUi(),
  });
  if (state.meetingListenOnly) toast('เข้าร่วมในโหมดฟังอย่างเดียว (ไม่พบไมค์)', 'ok');
  else toast('เข้าร่วมห้องประชุมแล้ว (โหมดประหยัดข้อมูล)', 'ok');
  refreshUi();
}

/** Leaves active voice room and cleans up WebRTC streams immediately. */
export async function leaveMeetingRoom(channelId, refreshUi) {
  const targetId = channelId || state.joinedVoiceChannelId;
  if (rtcMod) await rtcMod.leaveMeetingRtc();
  remoteStreams.clear();
  localStreamRef = null;
  state.joinedVoiceChannelId = null;
  state.meetingPeers.clear();
  if (targetId && state.token) {
    try {
      const res = await api(`/channels/${encodeURIComponent(targetId)}/voice/leave`, { method: 'POST' });
      if (res.users.length) state.voice[targetId] = res.users;
      else delete state.voice[targetId];
    } catch (error) { handleError(error); }
  }
  refreshUi();
}

/** Forwards `voice_state`, `rtc_signal`, and `meeting_state` WS events to active RTC session. */
export async function handleMeetingWsEvent(event, refreshUi) {
  if (event.type === 'voice_state' && state.joinedVoiceChannelId === event.channel_id && rtcMod) {
    await rtcMod.syncMeetingPeers(event.users || []);
  } else if (event.type === 'rtc_signal' && rtcMod) {
    await rtcMod.handleRtcSignal(event);
  } else if (event.type === 'meeting_state' && event.user_id) {
    state.meetingPeers.set(event.user_id, {
      muted: event.muted,
      deafened: event.deafened,
      video: event.video,
      speaking: event.speaking,
      data_saver: event.data_saver,
    });
    refreshUi();
  }
}

/** Triggers RTC control updates (`mute`, `deafen`, `data-saver`, `cam`, `screen`). */
export async function updateMeetingControl(kind, refreshUi) {
  const rtc = await getRtc();
  if (kind === 'cam' || kind === 'screen') {
    try {
      await rtc.toggleMeetingVideo(kind === 'cam' ? 'camera' : 'screen');
    } catch {
      toast(kind === 'cam' ? 'ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์กล้อง' : 'ยกเลิกหรือไม่สามารถแชร์หน้าจอได้', 'err');
      refreshUi();
    }
  } else if (kind === 'data-saver') {
    state.meetingDataSaver = !state.meetingDataSaver;
    if (state.joinedVoiceChannelId) await rtc.syncLocalMediaSettings();
    toast(state.meetingDataSaver ? 'เปิดโหมดประหยัดข้อมูล (~16 kbps)' : 'เปลี่ยนเป็นโหมดเสียงคมชัด (~48 kbps)', 'ok');
    refreshUi();
  } else if (state.joinedVoiceChannelId) {
    await rtc.syncLocalMediaSettings();
    attachMediaNodes();
  }
}

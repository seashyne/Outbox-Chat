/**
 * Meeting Room Stage UI controller: renders active room participant tiles,
 * audio-only/data-saver status, remote media streams, and accessible media toolbar.
 * Lazily imports `meeting_rtc.js` only when joining an active Meeting Room.
 */

import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { cycleScreenPreset, getScreenPreset } from './meeting_sdp.js';
import { resolveProfile } from './profile_helpers.js';
import { memberRoleFor, roleMeta } from './server_templates.js';
import { $, ICONS, avatar, escapeHtml, state } from './state.js';

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
  if (id.startsWith('dm:')) {
    const friendPeer = state.friends?.friends?.find((f) => f.dm_channel_id === id)?.user;
    const peer = (state.dmChannel?.id === id ? state.dmPeer : null) || friendPeer;
    return {
      isDm: true,
      channel: state.dmChannel?.id === id
        ? state.dmChannel
        : { id, name: peer?.display_name || t('friends.dmHeader'), kind: 'voice', topic: '' },
      server: { id, name: t('friends.dmHeader'), members: [state.me, peer].filter(Boolean), roles_config: {}, member_profiles: {} },
    };
  }
  for (const s of state.servers) {
    const ch = s.channels.find((c) => c.id === id && c.kind === 'voice');
    if (ch) return { isDm: false, channel: ch, server: s };
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

  const isDmView = Boolean(state.voiceChannelId?.startsWith('dm:'));
  const focused = Boolean(state.voiceChannelId) && (!state.homeMode || isDmView);
  const ctx = focused ? resolveViewedVoiceChannel() : null;
  if (!focused || !ctx) {
    stage.hidden = true;
    const hideChat = Boolean(state.homeMode && !state.dmChannel);
    msgScroll.hidden = hideChat;
    typingRow.hidden = hideChat;
    if (composerWrap) composerWrap.hidden = hideChat;
    attachMediaNodes();
    return;
  }

  const { isDm, channel, server } = ctx;
  const users = state.voice[channel.id] || [];
  const inThisRoom = Boolean(state.me && state.joinedVoiceChannelId === channel.id && users.includes(state.me.id));
  const saver = Boolean(state.meetingDataSaver);
  const canCreate = !isDm && (['owner', 'admin'].includes(server.role) || server.roles_config?.allow_member_create_channel !== false);

  stage.hidden = false;
  msgScroll.hidden = true;
  typingRow.hidden = true;
  if (composerWrap) composerWrap.hidden = true;
  if (jumpBtn) jumpBtn.hidden = true;

  const tileHtml = (uid) => {
    const u = resolveProfile(uid, server);
    const isMe = state.me && uid === state.me.id;
    const peer = state.meetingPeers.get(uid) || {};
    const muted = isMe ? state.muted : Boolean(peer.muted);
    const deafened = isMe ? state.deafened : Boolean(peer.deafened);
    const speaking = Boolean(peer.speaking && !muted && !deafened);
    const stream = isMe ? localStreamRef : remoteStreams.get(uid);
    const liveVideo = Boolean(stream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted));
    const hasVideo = isMe ? (Boolean(state.meetingVideo || state.meetingScreen) && liveVideo) : (peer.video !== false && liveVideo);
    const isSpotlight = hasVideo && state.meetingSpotlightId === uid;
    const rMeta = roleMeta(server, memberRoleFor(server, uid));
    return `
      <div class="meeting-tile ${speaking ? 'speaking' : ''} ${hasVideo ? 'has-video' : ''} ${isSpotlight ? 'spotlight' : ''}">
        ${hasVideo ? `<button type="button" class="mt-zoom-btn" data-action="spotlight-peer" data-id="${escapeHtml(uid)}">${escapeHtml(isSpotlight ? t('meeting.zoomOut') : t('meeting.zoomIn'))}</button>` : ''}
        ${hasVideo
          ? `<video autoplay playsinline ${isMe ? 'muted' : ''} data-video-peer="${escapeHtml(uid)}"></video>`
          : avatar(u, 'lg')}
        <div class="mt-footer">
          <span class="mt-name" style="color:${hasVideo ? '#fff' : rMeta.color}">${escapeHtml(u.display_name)}${isMe ? ` (${escapeHtml(t('common.you'))})` : ''}</span>
        </div>
        <div class="mt-flags">
          ${muted ? `<span class="mt-flag muted">${escapeHtml(t('meeting.micOff'))}</span>` : `<span class="mt-flag live">${escapeHtml(t('meeting.micOn'))}</span>`}
          ${deafened ? `<span class="mt-flag muted">${escapeHtml(t('meeting.audioOff'))}</span>` : ''}
          ${isMe && state.meetingListenOnly ? `<span class="mt-flag">${escapeHtml(t('meeting.listenOnly'))}</span>` : ''}
        </div>
      </div>`;
  };

  stage.innerHTML = `
    <div class="meeting-head">
      <div class="meeting-title-wrap">
        <div class="meeting-title">
          ${ICONS.voice} <span>${escapeHtml(channel.name)}</span>
          <span class="voice-badge">${escapeHtml(t('meeting.inRoomCount', { count: users.length }))}</span>
        </div>
        <div class="meeting-sub">${escapeHtml(channel.topic || t('meeting.defaultSub'))}</div>
      </div>
      <div class="meeting-metrics">
        <span class="meeting-chip ${saver ? 'saver-on' : ''}">${ICONS.saver} ${escapeHtml(saver ? t('voice.dataSaverMode') : t('voice.hdMode'))}</span>
        ${canCreate ? `<button type="button" class="meeting-create-btn" data-action="create-voice-room">${ICONS.plus} ${escapeHtml(t('meeting.createRoom'))}</button>` : ''}
      </div>
    </div>
    <div class="meeting-body">
      ${users.length
        ? `<div class="meeting-grid" id="meetingGrid">${users.map(tileHtml).join('')}</div>`
        : `<div class="meeting-empty">
             ${ICONS.voiceLg}
             <h3>${escapeHtml(t('meeting.readyTitle', { name: channel.name }))}</h3>
             <p>${escapeHtml(t('meeting.readyDesc'))}</p>
             <button type="button" class="meeting-join-cta" data-action="voice-join" data-id="${escapeHtml(channel.id)}">${escapeHtml(t('meeting.joinNow'))}</button>
           </div>`}
    </div>
    <div class="meeting-toolbar-wrap">
      <div class="meeting-toolbar" role="toolbar" aria-label="${escapeHtml(t('meeting.aria'))}">
        ${inThisRoom ? `
          <button type="button" class="mt-btn danger" data-action="toggle-mute" aria-pressed="${state.muted ? 'true' : 'false'}" aria-label="${escapeHtml(t('voice.micLabel'))}">${ICONS.mic} <span>${escapeHtml(state.muted ? t('meeting.micOn') : t('meeting.micOff'))}</span></button>
          <button type="button" class="mt-btn danger" data-action="toggle-deafen" aria-pressed="${state.deafened ? 'true' : 'false'}" aria-label="${escapeHtml(t('voice.speakerLabel'))}">${ICONS.headphones} <span>${escapeHtml(state.deafened ? t('voice.undeafen') : t('voice.deafen'))}</span></button>
          <button type="button" class="mt-btn" data-action="toggle-cam" aria-pressed="${state.meetingVideo ? 'true' : 'false'}" aria-label="${escapeHtml(t('meeting.cam'))}">${ICONS.video} <span>${escapeHtml(t('meeting.cam'))}</span></button>
          <button type="button" class="mt-btn" data-action="toggle-screen" aria-pressed="${state.meetingScreen ? 'true' : 'false'}" aria-label="${escapeHtml(t('meeting.screen'))}">${ICONS.screen} <span>${escapeHtml(t('meeting.screen'))}</span></button>
          <button type="button" class="mt-btn" data-action="cycle-screen-quality" aria-label="${escapeHtml(t('meeting.quality', { label: getScreenPreset().label }))}"><span>${escapeHtml(t('meeting.quality', { label: getScreenPreset().label }))}</span></button>
          <button type="button" class="mt-btn saver" data-action="toggle-data-saver" aria-pressed="${saver ? 'true' : 'false'}" aria-label="${escapeHtml(t('meeting.saverLabel'))}">${ICONS.saver} <span>${escapeHtml(t('meeting.saverLabel'))}</span></button>
          <button type="button" class="mt-btn" data-action="focus-text-chat">${escapeHtml(t('meeting.backToChat'))}</button>
          <button type="button" class="mt-btn leave" data-action="voice-leave" data-id="${escapeHtml(channel.id)}">${ICONS.logout} <span>${escapeHtml(t('meeting.leaveBtn'))}</span></button>
        ` : `
          <button type="button" class="mt-btn saver" data-action="toggle-data-saver" aria-pressed="${saver ? 'true' : 'false'}">${ICONS.saver} <span>${escapeHtml(t('meeting.saverToggle', { state: saver ? t('meeting.on') : t('meeting.off') }))}</span></button>
          <button type="button" class="mt-btn join" data-action="voice-join" data-id="${escapeHtml(channel.id)}">${ICONS.voice} <span>${escapeHtml(t('meeting.joinBtn'))}</span></button>
          <button type="button" class="mt-btn" data-action="focus-text-chat">${escapeHtml(t('meeting.backToChat'))}</button>
        `}
      </div>
    </div>`;

  attachMediaNodes();
  void renderSidebarFn;
  void renderUserFn;
}

/** Joins voice room optimistically and runs signaling/mic/ICE initialization in parallel. */
export async function joinMeetingRoom(channelId, refreshUi) {
  if (!state.ws || state.ws.readyState !== 1) {
    toast(t('meeting.connectingToast'), 'err');
    return;
  }
  const prevJoined = state.joinedVoiceChannelId;
  state.homeMode = channelId.startsWith('dm:');
  state.voiceChannelId = channelId;
  state.joinedVoiceChannelId = channelId;
  state.voice[channelId] = state.voice[channelId] || [];
  if (state.me && !state.voice[channelId].includes(state.me.id)) {
    state.voice[channelId].push(state.me.id);
  }
  refreshUi();

  try {
    const [res, rtc] = await Promise.all([
      api(`/channels/${encodeURIComponent(channelId)}/voice/join`, { method: 'POST' }),
      getRtc(),
    ]);
    if (res.users.length) state.voice[channelId] = res.users;
    refreshUi();

    await rtc.joinMeetingRtc(channelId, res.users, {
      onRemoteStream: (peerId, stream) => {
        if (stream) remoteStreams.set(peerId, stream);
        else remoteStreams.delete(peerId);
        refreshUi();
      },
      onLocalVideo: (stream) => { localStreamRef = stream; refreshUi(); },
      onStateChange: () => refreshUi(),
    });
    if (state.meetingListenOnly) toast(t('meeting.joinedListenOnly'), 'ok');
    else toast(t('meeting.joinedToast'), 'ok');
    refreshUi();
  } catch (error) {
    state.joinedVoiceChannelId = prevJoined || null;
    refreshUi();
    throw error;
  }
}

/** Leaves active voice room and cleans up WebRTC streams immediately. */
export async function leaveMeetingRoom(channelId, refreshUi) {
  const targetId = channelId || state.joinedVoiceChannelId;
  if (rtcMod) await rtcMod.leaveMeetingRtc();
  remoteStreams.clear();
  localStreamRef = null;
  state.joinedVoiceChannelId = null;
  state.meetingSpotlightId = null;
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

/** Starts a 1-on-1 DM voice or video call in the active DM channel. */
export async function startDmCall(withVideo, refreshUi) {
  const cid = state.dmChannel?.id;
  if (!cid) return;
  await joinMeetingRoom(cid, refreshUi);
  if (withVideo && state.joinedVoiceChannelId === cid && !state.meetingVideo) {
    await updateMeetingControl('cam', refreshUi);
  }
}

/** Triggers RTC control updates (`mute`, `deafen`, `data-saver`, `cam`, `screen`). */
export async function updateMeetingControl(kind, refreshUi) {
  if (kind === 'screen-quality') {
    const preset = cycleScreenPreset();
    if (rtcMod) await rtcMod.updateScreenQuality();
    toast(t('meeting.qualityToast', { label: preset.label }), 'ok');
    refreshUi();
    return;
  }
  const rtc = await getRtc();
  if (kind === 'cam' || kind === 'screen') {
    try {
      await rtc.toggleMeetingVideo(kind === 'cam' ? 'camera' : 'screen');
    } catch {
      toast(kind === 'cam' ? t('meeting.camErr') : t('meeting.screenErr'), 'err');
      refreshUi();
    }
  } else if (kind === 'data-saver') {
    state.meetingDataSaver = !state.meetingDataSaver;
    if (state.joinedVoiceChannelId) await rtc.syncLocalMediaSettings();
    toast(state.meetingDataSaver ? t('meeting.saverOnToast') : t('meeting.saverOffToast'), 'ok');
    refreshUi();
  } else if (state.joinedVoiceChannelId) {
    await rtc.syncLocalMediaSettings();
    attachMediaNodes();
  }
}

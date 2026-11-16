/**
 * WebRTC P2P Meeting Engine: glare-free WS signaling mesh, audio-first join
 * with listen-only fallback, and on-demand camera/screen share switching.
 */

import { api } from './api.js';
import {
  applySenderCaps,
  getScreenPreset,
  samplePeersStats,
  screenCaptureConstraints,
  startVadMonitor,
  stopVadMonitor,
  tuneOpusSdp,
} from './meeting_sdp.js';
import { state } from './state.js';

const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let activeIceCfg = { iceServers: DEFAULT_ICE_SERVERS, iceCandidatePoolSize: 2 };

async function refreshIceConfig() {
  try {
    const res = await api('/rtc/ice');
    if (Array.isArray(res?.iceServers) && res.iceServers.length) {
      activeIceCfg = { iceServers: res.iceServers, iceCandidatePoolSize: 2 };
    }
  } catch {
    activeIceCfg = { iceServers: DEFAULT_ICE_SERVERS, iceCandidatePoolSize: 2 };
  }
}

let activeChannelId = null;
let localAudioStream = null;
let localVideoStream = null;
let peers = new Map();
let statsTimer = null;
let prevStats = { sent: 0, recv: 0, ts: 0 };
let hooks = { onRemoteStream: () => {}, onLocalVideo: () => {}, onStateChange: () => {} };

function sendWs(payload) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(payload));
}

export function broadcastMeetingState(speaking = false) {
  if (!activeChannelId) return;
  sendWs({
    type: 'meeting_state',
    channel_id: activeChannelId,
    muted: Boolean(state.muted),
    deafened: Boolean(state.deafened),
    video: Boolean(state.meetingVideo || state.meetingScreen),
    speaking: Boolean(speaking && !state.muted && !state.deafened),
    data_saver: Boolean(state.meetingDataSaver),
  });
}

function attachLocalTracks(pc) {
  const audioTrack = localAudioStream?.getAudioTracks()[0] || null;
  const videoTrack = localVideoStream?.getVideoTracks()[0] || null;
  if (audioTrack) pc.addTrack(audioTrack, localAudioStream);
  else pc.addTransceiver('audio', { direction: 'recvonly' });
  return videoTrack ? pc.addTrack(videoTrack, localVideoStream) : null;
}

function createPeerEntry(peerId) {
  const existing = peers.get(peerId);
  if (existing) return existing;
  const pc = new RTCPeerConnection(activeIceCfg);
  const entry = { pc, iceQueue: [], remoteDescSet: false, remoteStream: new MediaStream(), videoSender: null };
  peers.set(peerId, entry);
  entry.videoSender = attachLocalTracks(pc);

  pc.onicecandidate = (e) => {
    if (e.candidate && activeChannelId) {
      sendWs({ type: 'rtc_signal', channel_id: activeChannelId, to: peerId, signal: { ice: e.candidate } });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams?.[0] || entry.remoteStream;
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    entry.remoteStream = stream;
    e.track.onmute = () => hooks.onStateChange();
    e.track.onunmute = () => hooks.onStateChange();
    e.track.onended = () => hooks.onStateChange();
    hooks.onRemoteStream(peerId, stream);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce?.();
  };
  return entry;
}

async function sendOffer(peerId) {
  const { pc } = createPeerEntry(peerId);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  offer.sdp = tuneOpusSdp(offer.sdp, state.meetingDataSaver);
  await pc.setLocalDescription(offer);
  await applySenderCaps(pc);
  sendWs({ type: 'rtc_signal', channel_id: activeChannelId, to: peerId, signal: { sdp: pc.localDescription } });
}

function closePeer(peerId) {
  const entry = peers.get(peerId);
  if (!entry) return;
  try { entry.pc.close(); } catch {}
  peers.delete(peerId);
  hooks.onRemoteStream(peerId, null);
}

/** Joins `channelId`, starts mono/DTX mic (or listen-only fallback), and connects peers. */
export async function joinMeetingRtc(channelId, initialUsers, callbacks) {
  await leaveMeetingRtc();
  await refreshIceConfig();
  activeChannelId = channelId;
  hooks = { ...hooks, ...callbacks };
  state.meetingListenOnly = false;

  if (navigator.mediaDevices?.getUserMedia) {
    try {
      localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 },
        video: false,
      });
      localAudioStream.getAudioTracks().forEach((t) => { t.enabled = !state.muted && !state.deafened; });
      startVadMonitor(localAudioStream, (speaking) => {
        if (state.me) {
          const cur = state.meetingPeers.get(state.me.id) || {};
          state.meetingPeers.set(state.me.id, { ...cur, speaking });
        }
        broadcastMeetingState(speaking);
        hooks.onStateChange();
      });
    } catch {
      state.meetingListenOnly = true;
      state.muted = true;
    }
  } else {
    state.meetingListenOnly = true;
    state.muted = true;
  }

  clearInterval(statsTimer);
  prevStats = { sent: 0, recv: 0, ts: performance.now() };
  statsTimer = setInterval(async () => {
    const res = await samplePeersStats(peers, prevStats);
    state.meetingStats = res.stats;
    prevStats = res.nextPrev;
    hooks.onStateChange();
  }, 2000);

  broadcastMeetingState(false);
  await syncMeetingPeers(initialUsers);
}

/** Reconciles active WebRTC peer connections with the room's participant IDs. */
export async function syncMeetingPeers(users = []) {
  if (!activeChannelId || !state.me) return;
  const activeSet = new Set(users.filter((id) => id !== state.me.id));
  for (const id of [...peers.keys()]) {
    if (!activeSet.has(id)) closePeer(id);
  }
  for (const peerId of activeSet) {
    if (!peers.has(peerId)) {
      createPeerEntry(peerId);
      if (state.me.id > peerId) await sendOffer(peerId);
    }
  }
}

/** Handles incoming targeted `rtc_signal` (SDP offer/answer and ICE candidates). */
export async function handleRtcSignal({ channel_id, from, signal }) {
  if (!activeChannelId || channel_id !== activeChannelId || !from || !signal) return;
  const entry = createPeerEntry(from);
  const { pc } = entry;
  if (signal.sdp) {
    const desc = new RTCSessionDescription(signal.sdp);
    if (desc.type === 'offer' && pc.signalingState !== 'stable') {
      if (state.me.id > from) return;
      await pc.setLocalDescription({ type: 'rollback' });
    }
    await pc.setRemoteDescription(desc);
    entry.remoteDescSet = true;
    while (entry.iceQueue.length) {
      try { await pc.addIceCandidate(entry.iceQueue.shift()); } catch {}
    }
    if (desc.type === 'offer') {
      const ans = await pc.createAnswer();
      ans.sdp = tuneOpusSdp(ans.sdp, state.meetingDataSaver);
      await pc.setLocalDescription(ans);
      await applySenderCaps(pc);
      sendWs({ type: 'rtc_signal', channel_id: activeChannelId, to: from, signal: { sdp: pc.localDescription } });
    }
  } else if (signal.ice) {
    const cand = new RTCIceCandidate(signal.ice);
    if (entry.remoteDescSet) { try { await pc.addIceCandidate(cand); } catch {} }
    else entry.iceQueue.push(cand);
  }
}

/** Applies mute/deafen/data-saver updates instantly without reconnecting the room. */
export async function syncLocalMediaSettings() {
  if (localAudioStream) {
    const enabled = !state.muted && !state.deafened && !state.meetingListenOnly;
    localAudioStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }
  for (const { pc } of peers.values()) await applySenderCaps(pc);
  broadcastMeetingState(false);
}

/** Toggles low-data camera or screen share stream across all active peers. */
export async function toggleMeetingVideo(kind = 'camera', forceOff = false) {
  if (!activeChannelId) return;
  const turningOff = forceOff || (kind === 'camera' && state.meetingVideo) || (kind === 'screen' && state.meetingScreen);
  let nextStream = null;

  if (!turningOff) {
    const saver = state.meetingDataSaver;
    nextStream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: screenCaptureConstraints(), audio: false })
      : await navigator.mediaDevices.getUserMedia({ video: { width: saver ? 320 : 640, height: saver ? 240 : 480, frameRate: saver ? 12 : 24 }, audio: false });
  }

  if (localVideoStream) { localVideoStream.getTracks().forEach((t) => t.stop()); localVideoStream = null; }
  state.meetingVideo = false;
  state.meetingScreen = false;

  const track = nextStream?.getVideoTracks()[0] || null;
  if (track) {
    localVideoStream = nextStream;
    if (kind === 'screen' && 'contentHint' in track) track.contentHint = getScreenPreset().hint;
    track.onended = () => {
      if (localVideoStream?.getVideoTracks()[0] === track) toggleMeetingVideo(kind, true).catch(() => {});
    };
    state.meetingVideo = kind === 'camera';
    state.meetingScreen = kind === 'screen';
  }

  for (const [peerId, entry] of peers.entries()) {
    const { pc } = entry;
    if (!entry.videoSender) {
      entry.videoSender = pc.getSenders().find((s) => s.track?.kind === 'video') || null;
    }
    if (entry.videoSender) {
      await entry.videoSender.replaceTrack(track);
      await applySenderCaps(pc);
    } else if (track) {
      entry.videoSender = pc.addTrack(track, localVideoStream);
      await sendOffer(peerId);
    }
  }
  hooks.onLocalVideo(localVideoStream);
  broadcastMeetingState(false);
  hooks.onStateChange();
}

/** Updates active screen-share track constraints and sender bitrate live (480p..1080p60). */
export async function updateScreenQuality() {
  if (!state.meetingScreen || !localVideoStream) return;
  const track = localVideoStream.getVideoTracks()[0];
  if (track) {
    if ('contentHint' in track) track.contentHint = getScreenPreset().hint;
    try { await track.applyConstraints(screenCaptureConstraints()); } catch {}
  }
  for (const { pc } of peers.values()) await applySenderCaps(pc);
}

/** Tears down all WebRTC peers, audio/video tracks, stats, and VAD timers. */
export async function leaveMeetingRtc() {
  activeChannelId = null;
  stopVadMonitor();
  clearInterval(statsTimer);
  statsTimer = null;
  for (const peerId of [...peers.keys()]) closePeer(peerId);
  if (localAudioStream) { localAudioStream.getTracks().forEach((t) => t.stop()); localAudioStream = null; }
  if (localVideoStream) { localVideoStream.getTracks().forEach((t) => t.stop()); localVideoStream = null; }
  state.meetingVideo = false;
  state.meetingScreen = false;
  state.meetingListenOnly = false;
  state.meetingStats = { kbpsUp: 0, kbpsDown: 0, totalKb: 0, rttMs: null };
  hooks.onLocalVideo(null);
}

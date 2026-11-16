/**
 * Low-bandwidth WebRTC media tuning helpers: Opus DTX/bitrate SDP shaping,
 * RTCRtpSender caps, local VAD speaking detector, and stats aggregation.
 */

import { state } from './state.js';

let vadTimer = null;
let audioCtx = null;
let analyser = null;

/** Rewrites Opus fmtp parameters for DTX silence suppression and target kbps. */
export function tuneOpusSdp(sdp, dataSaver) {
  const kbps = dataSaver ? 16 : 48;
  const ptime = dataSaver ? 40 : 20;
  const lines = sdp.split('\r\n');
  const opusPt = lines.find((l) => /a=rtpmap:\d+ opus\/48000/i.test(l))?.match(/a=rtpmap:(\d+)/)?.[1];
  if (!opusPt) return sdp;
  return lines.map((line) => {
    if (!line.startsWith(`a=fmtp:${opusPt} `)) return line;
    const cleaned = line
      .replace(/;?usedtx=\d/g, '')
      .replace(/;?stereo=\d/g, '')
      .replace(/;?sprop-stereo=\d+/g, '')
      .replace(/;?maxaveragebitrate=\d+/g, '')
      .replace(/;?ptime=\d+/g, '');
    return `${cleaned};usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=${kbps * 1000};ptime=${ptime}`;
  }).join('\r\n');
}

/** Caps outbound audio/video sender bitrates and framerates on `pc`. */
export async function applySenderCaps(pc) {
  const saver = Boolean(state.meetingDataSaver);
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    if (sender.track.kind === 'audio') {
      params.encodings[0].maxBitrate = saver ? 16_000 : 48_000;
    } else if (sender.track.kind === 'video') {
      params.encodings[0].maxBitrate = saver ? 140_000 : 450_000;
      params.encodings[0].maxFramerate = saver ? 12 : 24;
    }
    try { await sender.setParameters(params); } catch {}
  }
}

/** Monitors local mic RMS volume and fires `onSpeaking(bool)` only on state transitions. */
export function startVadMonitor(stream, onSpeaking) {
  stopVadMonitor();
  if (!stream?.getAudioTracks().length) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let wasSpeaking = false;
    vadTimer = setInterval(() => {
      if (!analyser || state.muted || state.deafened) {
        if (wasSpeaking) { wasSpeaking = false; onSpeaking(false); }
        return;
      }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) { const d = (data[i] - 128) / 128; sum += d * d; }
      const speaking = Math.sqrt(sum / data.length) > 0.025;
      if (speaking !== wasSpeaking) { wasSpeaking = speaking; onSpeaking(speaking); }
    }, 180);
  } catch {}
}

/** Stops local VAD timer and closes Web Audio context. */
export function stopVadMonitor() {
  clearInterval(vadTimer);
  vadTimer = null;
  analyser = null;
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
}

/** Aggregates live upload/download bytes and RTT across active peer connections. */
export async function samplePeersStats(peers, prevStats) {
  let totalSent = 0;
  let totalRecv = 0;
  let rttMs = null;
  for (const { pc } of peers.values()) {
    try {
      const rep = await pc.getStats();
      rep.forEach((s) => {
        if (s.type === 'outbound-rtp') totalSent += s.bytesSent || 0;
        if (s.type === 'inbound-rtp') totalRecv += s.bytesReceived || 0;
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
          rttMs = Math.round(s.currentRoundTripTime * 1000);
        }
      });
    } catch {}
  }
  const now = performance.now();
  const dt = Math.max(0.5, (now - prevStats.ts) / 1000);
  return {
    stats: {
      kbpsUp: Math.max(0, Math.round(((totalSent - prevStats.sent) * 8) / (dt * 1000))),
      kbpsDown: Math.max(0, Math.round(((totalRecv - prevStats.recv) * 8) / (dt * 1000))),
      totalKb: Math.round((totalSent + totalRecv) / 1024),
      rttMs,
    },
    nextPrev: { sent: totalSent, recv: totalRecv, ts: now },
  };
}

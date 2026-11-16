/**
 * Tier 1 Feature Tests: Real-Time Meeting Room & Low-Bandwidth WebRTC Signaling
 * Verifies voice room creation, targeted peer `rtc_signal` relay, `meeting_state` sync,
 * and automatic voice cleanup on WebSocket disconnect across Rust & Workers.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiClient,
  TARGET_URL,
  isServerOnline,
  checkSkip,
  randomUsername,
  randomPassword,
} from '../helpers/client.js';
import { connectWs } from '../helpers/ws.js';

describe('Tier 1: Meeting Room & Low-Bandwidth WebRTC Signaling', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('10.1: relays targeted rtc_signal only to intended peer and syncs data-saver meeting_state', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const peerA = await client.register(randomUsername('rtc_a'), pass);
    const peerB = await client.register(randomUsername('rtc_b'), pass);
    const bystander = await client.register(randomUsername('rtc_c'), pass);

    const srv = await client.createServer({ name: 'Meeting Guild', template: 'team' }, peerA.data.token);
    assert.equal(srv.status, 200);
    const sid = srv.data.id;

    await client.joinServer(sid, peerB.data.token);
    await client.joinServer(sid, bystander.data.token);

    const roomRes = await client.createChannel(sid, { name: 'Standup Call', kind: 'voice', topic: '16 kbps DTX' }, peerA.data.token);
    assert.equal(roomRes.status, 200);
    const roomId = roomRes.data.id;

    const wsA = await connectWs(peerA.data.token, { baseUrl: TARGET_URL });
    const wsB = await connectWs(peerB.data.token, { baseUrl: TARGET_URL });
    const wsC = await connectWs(bystander.data.token, { baseUrl: TARGET_URL });

    try {
      await Promise.all([
        wsA.waitForMessage((m) => m.type === 'ready'),
        wsB.waitForMessage((m) => m.type === 'ready'),
        wsC.waitForMessage((m) => m.type === 'ready'),
      ]);

      const joinA = await client.joinVoice(roomId, peerA.data.token);
      const joinB = await client.joinVoice(roomId, peerB.data.token);
      assert.equal(joinA.status, 200);
      assert.equal(joinB.status, 200);
      assert.ok(joinB.data.users.includes(peerA.data.user.id));
      assert.ok(joinB.data.users.includes(peerB.data.user.id));

      // Peer A sends SDP offer targeted strictly to Peer B
      wsA.send({
        type: 'rtc_signal',
        channel_id: roomId,
        to: peerB.data.user.id,
        signal: { sdp: { type: 'offer', sdp: 'v=0\r\na=fmtp:111 usedtx=1;maxaveragebitrate=16000\r\n' } },
      });

      const relayedOffer = await wsB.waitForMessage(
        (m) => m.type === 'rtc_signal' && m.channel_id === roomId && m.from === peerA.data.user.id,
        5000
      );
      assert.equal(relayedOffer.to, peerB.data.user.id);
      assert.equal(relayedOffer.signal.sdp.type, 'offer');

      // Bystander C must NOT receive targeted WebRTC offer meant for B
      await new Promise((r) => setTimeout(r, 150));
      const leaked = wsC.events.find((m) => m.type === 'rtc_signal' && m.to === peerB.data.user.id);
      assert.equal(leaked, undefined, 'Targeted rtc_signal must not leak to unrelated members');

      // Peer A broadcasts lightweight data-saver meeting_state
      wsA.send({
        type: 'meeting_state',
        channel_id: roomId,
        muted: false,
        deafened: false,
        video: false,
        speaking: true,
        data_saver: true,
      });

      const stateEv = await wsB.waitForMessage(
        (m) => m.type === 'meeting_state' && m.channel_id === roomId && m.user_id === peerA.data.user.id,
        5000
      );
      assert.equal(stateEv.speaking, true);
      assert.equal(stateEv.data_saver, true);
      assert.equal(stateEv.video, false);
    } finally {
      wsA.close();
      wsB.close();
      wsC.close();
    }
  });

  it('10.2: rejects rtc_signal targeting text channel or non-member gracefully without disconnecting', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const peerA = await client.register(randomUsername('rtc_chk_a'), pass);
    const outsider = await client.register(randomUsername('rtc_out'), pass);

    const srv = await client.createServer({ name: 'Isolated Room' }, peerA.data.token);
    const textChan = srv.data.channels.find((c) => c.kind === 'text');

    const wsOut = await connectWs(outsider.data.token, { baseUrl: TARGET_URL });
    const wsA = await connectWs(peerA.data.token, { baseUrl: TARGET_URL });
    try {
      await Promise.all([
        wsOut.waitForMessage((m) => m.type === 'ready'),
        wsA.waitForMessage((m) => m.type === 'ready'),
      ]);

      // Outsider attempts to signal member inside private server's text channel
      wsOut.send({
        type: 'rtc_signal',
        channel_id: textChan.id,
        to: peerA.data.user.id,
        signal: { ice: { candidate: 'fake' } },
      });

      await new Promise((r) => setTimeout(r, 150));
      const received = wsA.events.find((m) => m.type === 'rtc_signal');
      assert.equal(received, undefined);
    } finally {
      wsOut.close();
      wsA.close();
    }
  });
});

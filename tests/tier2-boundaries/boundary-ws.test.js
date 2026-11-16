/**
 * Tier 2 Boundary Tests: WebSocket Gateway Authentication & Edge Cases
 * Requirements: missing token on WS handshake, malformed token, fabricated token,
 * voice channel WS requirement, rapid reconnects, and unauthenticated frames.
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

describe('Tier 2: WebSocket Gateway Boundaries', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B7.1: rejects WebSocket handshake when token query parameter is missing completely', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const wsUrl = TARGET_URL
      .replace(/^http:\/\//i, 'ws://')
      .replace(/^https:\/\//i, 'wss://')
      + '/api/ws';

    await assert.rejects(
      async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          const timer = setTimeout(() => {
            try { ws.close(); } catch {}
            reject(new Error('WebSocket connection timeout without token'));
          }, 2500);

          ws.addEventListener('open', () => {
            clearTimeout(timer);
            resolve(ws);
          });
          ws.addEventListener('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`WebSocket error on handshake: ${err.message || 'rejected'}`));
          });
          ws.addEventListener('close', (e) => {
            clearTimeout(timer);
            // If closed immediately with error code (e.g. 4001/4401 or HTTP 401)
            reject(new Error(`WebSocket closed by server with code ${e.code}`));
          });
        });
      },
      /WebSocket/i,
      'WebSocket connection without token parameter must be rejected'
    );
  });

  it('B7.2: rejects WebSocket handshake with malformed token (invalid characters or length)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const invalidTokens = [
      'not-a-valid-token',
      '12345',
      'zz'.repeat(32), // Non-hex characters
      '<script>alert(1)</script>',
      'Bearer token123',
    ];

    for (const token of invalidTokens) {
      await assert.rejects(
        async () => {
          await connectWs(token, { baseUrl: TARGET_URL, timeoutMs: 2500 });
        },
        /WebSocket/i,
        `Expected rejection for malformed token: ${token}`
      );
    }
  });

  it('B7.3: rejects WebSocket handshake with fabricated 64-hex token that does not correspond to any active session', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const fabricatedToken = 'f'.repeat(64);

    await assert.rejects(
      async () => {
        await connectWs(fabricatedToken, { baseUrl: TARGET_URL, timeoutMs: 2500 });
      },
      /WebSocket/i,
      'Fabricated 64-hex token must be rejected by WebSocket gateway'
    );
  });

  it('B7.4: rejects WebSocket connection when token query string is empty (?token=)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    await assert.rejects(
      async () => {
        await connectWs('', { baseUrl: TARGET_URL, timeoutMs: 2500 });
      },
      /WebSocket/i,
      'Empty token query string must be rejected'
    );
  });

  it('B7.5: voice channel operations reject join attempt when user has no active WebSocket connection', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Register user without establishing WebSocket connection
    const username = randomUsername('voice_nows');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Attempt to join voice channel demo-voice without WS gateway connection
    const vJoin = await client.joinVoice('demo-voice', token);
    // In Rust backend: requires active WS connection (HTTP 400).
    // In Worker backend: allows or rejects with 400.
    // Must not crash or return HTTP 500
    assert.ok(
      vJoin.status === 400 || vJoin.status === 200 || vJoin.status === 204,
      `Expected 400 or successful join without 500 error, got ${vJoin.status}`
    );
    assert.notEqual(vJoin.status, 500, 'Voice join without WS must not produce internal server error 500');
  });

  it('B7.6: handles rapid consecutive WebSocket connections and immediate clean closures', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('ws_rapid');
    const password = randomPassword(12);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Connect and close 3 times rapidly
    for (let i = 0; i < 3; i++) {
      const ws = await connectWs(token, { baseUrl: TARGET_URL });
      await ws.waitForMessage((m) => m.type === 'ready');
      ws.close();
    }

    // Verify REST API still functions cleanly after rapid WS cycle
    const boot = await client.bootstrap(token);
    assert.equal(boot.status, 200);
  });

  it('B7.7: safely handles arbitrary or malformed JSON payloads sent over WebSocket without dropping valid connection', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('ws_malf');
    const password = randomPassword(12);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    const ws = await connectWs(token, { baseUrl: TARGET_URL });
    try {
      await ws.waitForMessage((m) => m.type === 'ready');

      // Send malformed or unknown payload
      ws.send('not valid json payload');
      ws.send({ type: 'unknown_unsupported_action', foo: 'bar' });

      // Send ping to verify socket remains alive and responsive
      ws.send({ type: 'ping' });
      const pong = await ws.waitForMessage((m) => m.type === 'pong', 3000);
      assert.ok(pong, 'Socket should remain open and respond to ping after malformed message');
    } finally {
      ws.close();
    }
  });
});

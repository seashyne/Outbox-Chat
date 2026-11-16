/**
 * Tier 3 Combination Tests: Multi-Session Support
 * Requirement R1: Multiple sessions for single user, independent concurrent tokens
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
import { isValid64Hex } from '../helpers/crypto.js';

describe('Tier 3: Multi-Session & Concurrent Tokens', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('C2.1: issues distinct concurrent session tokens on multiple logins for the same user', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('multi_sess');
    const password = randomPassword(16);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const regToken = reg.data.token;

    const login1 = await client.login(username, password);
    assert.equal(login1.status, 200);
    const token1 = login1.data.token;

    const login2 = await client.login(username, password);
    assert.equal(login2.status, 200);
    const token2 = login2.data.token;

    assert.ok(isValid64Hex(regToken));
    assert.ok(isValid64Hex(token1));
    assert.ok(isValid64Hex(token2));

    // Ensure all tokens are distinct
    const tokenSet = new Set([regToken, token1, token2]);
    assert.equal(tokenSet.size, 3, 'All 3 tokens must be unique');

    // Verify all 3 tokens are concurrently usable
    const bootReg = await client.bootstrap(regToken);
    const boot1 = await client.bootstrap(token1);
    const boot2 = await client.bootstrap(token2);

    assert.equal(bootReg.status, 200);
    assert.equal(boot1.status, 200);
    assert.equal(boot2.status, 200);

    assert.equal(bootReg.data.me.id, boot1.data.me.id);
    assert.equal(boot1.data.me.id, boot2.data.me.id);
  });

  it('C2.2: maintains simultaneous WebSocket connections for two independent sessions of the same user', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('multi_ws');
    const password = randomPassword(16);

    await client.register(username, password);

    const login1 = await client.login(username, password);
    const login2 = await client.login(username, password);

    const ws1 = await connectWs(login1.data.token, { baseUrl: TARGET_URL });
    const ws2 = await connectWs(login2.data.token, { baseUrl: TARGET_URL });

    try {
      const ready1 = await ws1.waitForMessage((m) => m.type === 'ready');
      const ready2 = await ws2.waitForMessage((m) => m.type === 'ready');

      assert.equal(ready1.user.username, username);
      assert.equal(ready2.user.username, username);

      // Both can ping/pong
      ws1.ping();
      ws2.ping();

      const pong1 = await ws1.waitForMessage((m) => m.type === 'pong', 3000);
      const pong2 = await ws2.waitForMessage((m) => m.type === 'pong', 3000);

      assert.ok(pong1);
      assert.ok(pong2);
    } finally {
      ws1.close();
      ws2.close();
    }
  });

  it('C2.3: delivers real-time message event from Session 1 to Session 2', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('cross_sess');
    const password = randomPassword(16);

    await client.register(username, password);

    const login1 = await client.login(username, password);
    const login2 = await client.login(username, password);

    const ws2 = await connectWs(login2.data.token, { baseUrl: TARGET_URL });

    try {
      await ws2.waitForMessage((m) => m.type === 'ready');

      const uniqueContent = `Cross-session message test ${Date.now()}`;
      const postRes = await client.postMessage('demo-0', { content: uniqueContent }, login1.data.token);
      assert.equal(postRes.status, 200);

      const wsEvent = await ws2.waitForMessage(
        (m) => m.type === 'message_create' && m.message?.id === postRes.data.id,
        5000
      );
      assert.ok(wsEvent, 'Session 2 should receive real-time message created by Session 1');
      assert.equal(wsEvent.message.content, uniqueContent);
    } finally {
      ws2.close();
    }
  });

  it('C2.4: verifies parallel REST operations across 5 simultaneous sessions for same user', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('par_sess');
    const password = randomPassword(16);

    await client.register(username, password);

    // Create 5 concurrent sessions
    const loginPromises = Array.from({ length: 5 }, () => client.login(username, password));
    const loginResults = await Promise.all(loginPromises);

    loginResults.forEach((r) => assert.equal(r.status, 200));
    const tokens = loginResults.map((r) => r.data.token);

    // Concurrently fetch bootstrap using all 5 tokens
    const fetchPromises = tokens.map((token) => client.bootstrap(token));
    const fetchResults = await Promise.all(fetchPromises);

    fetchResults.forEach((res) => {
      assert.equal(res.status, 200);
      assert.equal(res.data.me.username, username);
    });
  });
});

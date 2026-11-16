/**
 * Tier 1 Feature Tests: Session Protection & Authorization
 * Requirement R1: Session validation for protected endpoints & WebSocket gateway
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

describe('Tier 1: Session Protection', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('3.1: allows access to GET /api/bootstrap with valid Bearer token', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('boot_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const token = reg.data.token;
    const res = await client.bootstrap(token);

    assert.equal(res.status, 200);
    assert.ok(res.data.me, 'Expected "me" user profile in bootstrap');
    assert.equal(res.data.me.username, username);
    assert.ok(Array.isArray(res.data.servers), 'Expected servers array');
    assert.ok(Array.isArray(res.data.online), 'Expected online users array');
  });

  it('3.2: allows access to GET /api/servers with valid Bearer token', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('srv_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const res = await client.getServers(reg.data.token);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data), 'Expected array of servers');
  });

  it('3.3: allows creating a new server via POST /api/servers with valid token', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('owner_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const serverName = `Guild_${Date.now().toString(36)}`;
    const res = await client.createServer({ name: serverName, icon: 'G' }, reg.data.token);

    assert.equal(res.status, 200, `Create server failed: ${res.text}`);
    assert.ok(res.data.id, 'Created server must have an ID');
    assert.equal(res.data.name, serverName);
    assert.equal(res.data.owner_id, reg.data.user.id);
  });

  it('3.4: blocks unauthenticated requests to GET /api/bootstrap with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const res = await client.request('GET', '/api/bootstrap');
    assert.equal(res.status, 401);
    assert.match(res.data?.error || '', /invalid or missing token/i);
  });

  it('3.5: blocks requests with invalid/fabricated token with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const fakeToken = '0'.repeat(64);
    const res = await client.bootstrap(fakeToken);

    assert.equal(res.status, 401);
    assert.match(res.data?.error || '', /invalid or missing token/i);
  });

  it('3.6: allows WebSocket upgrade with valid session token and receives ready event', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('ws_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const ws = await connectWs(reg.data.token, { baseUrl: TARGET_URL });
    try {
      const readyMsg = await ws.waitForMessage((m) => m.type === 'ready', 5000);
      assert.ok(readyMsg, 'Expected ready event');
      assert.equal(readyMsg.user.username, username);
      assert.ok(Array.isArray(readyMsg.online));
      assert.ok(readyMsg.online.includes(reg.data.user.id));
    } finally {
      ws.close();
    }
  });
});

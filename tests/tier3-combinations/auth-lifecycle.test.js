/**
 * Tier 3 Combination Tests: Authentication Lifecycle
 * Register -> Login -> Use Token -> Concurrent Login -> Re-auth
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

describe('Tier 3: Authentication Lifecycle & Token Management', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('C1.1: complete auth cycle (Register -> Token 1 -> Login -> Token 2 -> Verify consistency)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('life_u');
    const password = randomPassword(16);

    // 1. Register
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token1 = regRes.data.token;
    const userId = regRes.data.user.id;

    // 2. Use registration token to access bootstrap
    const bootRes1 = await client.bootstrap(token1);
    assert.equal(bootRes1.status, 200);
    assert.equal(bootRes1.data.me.id, userId);

    // 3. Login with credentials
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);
    const token2 = loginRes.data.token;
    assert.equal(loginRes.data.user.id, userId);

    // 4. Use login token to access bootstrap
    const bootRes2 = await client.bootstrap(token2);
    assert.equal(bootRes2.status, 200);
    assert.equal(bootRes2.data.me.id, userId);
    assert.equal(bootRes2.data.me.username, username);
  });

  it('C1.2: case variation re-authentication cycle preserving original identity', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const baseName = `LifecycleUser_${Date.now().toString(36)}`;
    const password = randomPassword(16);

    const regRes = await client.register(baseName, password);
    assert.equal(regRes.status, 200);
    const originalId = regRes.data.user.id;

    // Login with all lowercase
    const lowerLogin = await client.login(baseName.toLowerCase(), password);
    assert.equal(lowerLogin.status, 200);
    assert.equal(lowerLogin.data.user.id, originalId);
    assert.equal(lowerLogin.data.user.username, baseName, 'Original casing should be preserved in user model');

    // Login with all uppercase
    const upperLogin = await client.login(baseName.toUpperCase(), password);
    assert.equal(upperLogin.status, 200);
    assert.equal(upperLogin.data.user.id, originalId);
    assert.equal(upperLogin.data.user.username, baseName);
  });

  it('C1.3: re-authentication recovery after failed password attempts', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('retry_u');
    const password = randomPassword(16);

    await client.register(username, password);

    // Multiple failed login attempts
    for (let i = 0; i < 3; i++) {
      const failRes = await client.login(username, `WrongPassword_${i}`);
      assert.equal(failRes.status, 401);
    }

    // Immediate successful login with correct password
    const recoveryRes = await client.login(username, password);
    assert.equal(recoveryRes.status, 200);
    assert.ok(recoveryRes.data.token);

    // Verify recovery token works
    const boot = await client.bootstrap(recoveryRes.data.token);
    assert.equal(boot.status, 200);
  });

  it('C1.4: ensures token isolation between two distinct users', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const userA = randomUsername('iso_a');
    const userB = randomUsername('iso_b');
    const pass = randomPassword(14);

    const regA = await client.register(userA, pass);
    const regB = await client.register(userB, pass);

    const tokenA = regA.data.token;
    const tokenB = regB.data.token;

    // Token A bootstraps as User A
    const bootA = await client.bootstrap(tokenA);
    assert.equal(bootA.data.me.username, userA);

    // Token B bootstraps as User B
    const bootB = await client.bootstrap(tokenB);
    assert.equal(bootB.data.me.username, userB);

    assert.notEqual(bootA.data.me.id, bootB.data.me.id);
  });

  it('C1.5: persistent token viability across sequential multi-operation pipeline', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('pipe_u');
    const password = randomPassword(14);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    // Pipeline: bootstrap -> list servers -> create server -> create channel -> post message -> toggle reaction
    const boot = await client.bootstrap(token);
    assert.equal(boot.status, 200);

    const servers = await client.getServers(token);
    assert.equal(servers.status, 200);

    const newSrv = await client.createServer({ name: 'PipelineServer', icon: 'PL' }, token);
    assert.equal(newSrv.status, 200);

    const newChan = await client.createChannel(newSrv.data.id, { name: 'pipe-chan', kind: 'text' }, token);
    assert.equal(newChan.status, 200);

    const newMsg = await client.postMessage(newChan.data.id, { content: 'Pipeline success' }, token);
    assert.equal(newMsg.status, 200);

    const rx = await client.toggleReaction(newMsg.data.id, 'Done', token);
    assert.equal(rx.status, 200);
    assert.ok(rx.data.reactions.some((r) => r.emoji === 'Done'));
  });
});

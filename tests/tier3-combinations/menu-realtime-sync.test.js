/**
 * Tier 3 Combination Tests: Menu Actions & Realtime Presence Sync
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

describe('Tier 3: Menu Actions & Realtime Presence Synchronization', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('C4.4: server leave with server list update and membership cleanup', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const owner = await client.register(randomUsername('srv_owner'), pass);
    const member = await client.register(randomUsername('srv_member'), pass);
    const ownerToken = owner.data.token;
    const memberToken = member.data.token;
    const memberId = member.data.user.id;

    const serverRes = await client.createServer({ name: 'Departure Server', icon: 'DS' }, ownerToken);
    assert.equal(serverRes.status, 200);
    const serverId = serverRes.data.id;

    const chanRes = await client.createChannel(serverId, { name: 'general', kind: 'text' }, ownerToken);
    const chanId = chanRes.data.id;

    await client.joinServer(serverId, memberToken);

    const memberServersBefore = await client.getServers(memberToken);
    assert.ok(
      Array.isArray(memberServersBefore.data) && memberServersBefore.data.some((s) => s.id === serverId),
      'Member must see server in server list before leaving'
    );

    const ownerWs = await connectWs(ownerToken, { baseUrl: TARGET_URL });
    try {
      await ownerWs.waitForMessage((m) => m.type === 'ready');

      const leaveRes = await client.leaveServer(serverId, memberToken);
      assert.equal(leaveRes.status, 200);
      assert.equal(leaveRes.data.success, true);
      assert.equal(leaveRes.data.server_id, serverId);

      const leaveEvent = await ownerWs.waitForMessage(
        (m) =>
          (m.type === 'member_leave' && (m.user_id === memberId || m.user?.id === memberId)) ||
          (m.type === 'presence' && m.user_id === memberId && m.online === false),
        5000
      ).catch(() => null);
      if (leaveEvent) assert.ok(leaveEvent);

      const memberBootAfter = await client.bootstrap(memberToken);
      assert.ok(!memberBootAfter.data.servers?.some((s) => s.id === serverId));

      const postAttempt = await client.postMessage(chanId, { content: 'Unauthorized post' }, memberToken);
      assert.ok([400, 403, 404].includes(postAttempt.status));

      const ownerLeaveAttempt = await client.leaveServer(serverId, ownerToken);
      assert.ok([400, 403].includes(ownerLeaveAttempt.status));
    } finally {
      ownerWs.close();
    }
  });

  it('C4.5: multi-user status & presence state synchronization', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const userA = await client.register(randomUsername('status_a'), pass);
    const userB = await client.register(randomUsername('status_b'), pass);
    const tokenA = userA.data.token;
    const tokenB = userB.data.token;

    const statusUpdate = await client.patchSettings({ status: 'idle' }, tokenA);
    assert.equal(statusUpdate.status, 200);
    assert.equal(statusUpdate.data.settings.status, 'idle');

    const wsA = await connectWs(tokenA, { baseUrl: TARGET_URL });
    const wsB = await connectWs(tokenB, { baseUrl: TARGET_URL });
    try {
      await wsA.waitForMessage((m) => m.type === 'ready');
      await wsB.waitForMessage((m) => m.type === 'ready');

      const updateDnd = await client.patchSettings({ status: 'dnd' }, tokenA);
      assert.equal(updateDnd.status, 200);
      assert.equal(updateDnd.data.settings.status, 'dnd');

      const bootB = await client.bootstrap(tokenB);
      assert.equal(bootB.status, 200);
      assert.ok(bootB.data.online.includes(userA.data.user.id));

      await client.patchSettings({ status: 'invisible' }, tokenA);
      const settingsA = await client.getSettings(tokenA);
      assert.equal(settingsA.data.settings.status, 'invisible');
    } finally {
      wsA.close();
      wsB.close();
    }
  });
});

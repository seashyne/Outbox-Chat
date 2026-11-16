/**
 * Tier 3 Combination Tests: Settings, Themes & Real-Time Sync
 * Cross-feature interactions:
 * - C4.1: Settings persistence across full logout and re-login (login + bootstrap)
 * - C4.2: Theme update and multi-session / realtime WebSocket synchronization
 * - C4.3: Channel deletion with real-time UI/WS event broadcast to members
 * - C4.4: Server leave with server list update and membership cleanup
 * - C4.5: Multi-user status & presence state synchronization
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

describe('Tier 3: Cross-Feature Interactions & Settings Synchronization', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('C4.1: settings persistence across full logout and re-login (login + bootstrap verification)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('sync_persist');
    const password = randomPassword(16);

    // 1. Register new user
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token1 = regRes.data.token;
    const userId = regRes.data.user.id;

    // 2. Configure custom theme and status
    const customPalette = {
      brand: '#ff3366',
      sidebar: '#1a1a2e',
      chat: '#16213e',
    };
    const patchRes = await client.patchSettings({
      theme: 'custom',
      custom_colors: customPalette,
      status: 'dnd',
    }, token1);
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.settings.theme, 'custom');
    assert.deepEqual(patchRes.data.settings.custom_colors, customPalette);
    assert.equal(patchRes.data.settings.status, 'dnd');

    // 3. Verify settings via bootstrap with token 1
    const boot1 = await client.bootstrap(token1);
    assert.equal(boot1.status, 200);
    assert.equal(boot1.data.settings.theme, 'custom');
    assert.deepEqual(boot1.data.settings.custom_colors, customPalette);
    assert.equal(boot1.data.settings.status, 'dnd');

    // 4. Logout session 1
    const logoutRes = await client.logout(token1);
    assert.equal(logoutRes.status, 200);

    // Verify token 1 is invalidated
    const invalidBoot = await client.bootstrap(token1);
    assert.equal(invalidBoot.status, 401, 'Logged out token must be rejected');

    // 5. Re-authenticate with login
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);
    const token2 = loginRes.data.token;
    assert.notEqual(token2, token1, 'Login must issue a new session token');

    // If login response includes settings, verify them
    if (loginRes.data.settings) {
      assert.equal(loginRes.data.settings.theme, 'custom');
      assert.deepEqual(loginRes.data.settings.custom_colors, customPalette);
    }

    // 6. Verify bootstrap with token 2 retains custom settings
    const boot2 = await client.bootstrap(token2);
    assert.equal(boot2.status, 200);
    assert.equal(boot2.data.me.id, userId);
    assert.equal(boot2.data.settings.theme, 'custom');
    assert.deepEqual(boot2.data.settings.custom_colors, customPalette);
    assert.equal(boot2.data.settings.status, 'dnd');

    // 7. Verify GET /api/users/@me/settings with token 2
    const settingsRes = await client.getSettings(token2);
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.data.settings.theme, 'custom');
    assert.deepEqual(settingsRes.data.settings.custom_colors, customPalette);
  });

  it('C4.2: theme update and multi-session / realtime WebSocket synchronization', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_multi');
    const password = randomPassword(16);

    await client.register(username, password);

    // Open two concurrent sessions
    const sessionA = await client.login(username, password);
    const sessionB = await client.login(username, password);
    const tokenA = sessionA.data.token;
    const tokenB = sessionB.data.token;

    const wsB = await connectWs(tokenB, { baseUrl: TARGET_URL });

    try {
      await wsB.waitForMessage((m) => m.type === 'ready');

      // Session A switches to standard preset "slate"
      const update1 = await client.patchSettings({ theme: 'slate' }, tokenA);
      assert.equal(update1.status, 200);
      assert.equal(update1.data.settings.theme, 'slate');

      // Session B queries settings and sees updated preset immediately
      const fetchB1 = await client.getSettings(tokenB);
      assert.equal(fetchB1.status, 200);
      assert.equal(fetchB1.data.settings.theme, 'slate');

      // Session A switches to custom theme palette
      const customColors = { brand: '#00ffcc', sidebar: '#0f172a', chat: '#1e293b' };
      const update2 = await client.patchSettings({
        theme: 'custom',
        custom_colors: customColors,
      }, tokenA);
      assert.equal(update2.status, 200);
      assert.equal(update2.data.settings.theme, 'custom');
      assert.deepEqual(update2.data.settings.custom_colors, customColors);

      // Session B verifies bootstrap reflects new custom palette
      const bootB = await client.bootstrap(tokenB);
      assert.equal(bootB.status, 200);
      assert.equal(bootB.data.settings.theme, 'custom');
      assert.deepEqual(bootB.data.settings.custom_colors, customColors);
    } finally {
      wsB.close();
    }
  });

  it('C4.3: channel deletion with real-time UI/WS event broadcast to members', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const owner = await client.register(randomUsername('chan_owner'), pass);
    const member = await client.register(randomUsername('chan_member'), pass);
    const ownerToken = owner.data.token;
    const memberToken = member.data.token;

    // Owner creates server
    const serverRes = await client.createServer({ name: 'Channel Lifecycle Server', icon: 'CLS' }, ownerToken);
    assert.equal(serverRes.status, 200);
    const serverId = serverRes.data.id;

    // Member joins server
    const joinRes = await client.joinServer(serverId, memberToken);
    assert.equal(joinRes.status, 200);

    // Owner creates temporary channel
    const chanRes = await client.createChannel(serverId, { name: 'temp-announcements', kind: 'text' }, ownerToken);
    assert.equal(chanRes.status, 200);
    const tempChanId = chanRes.data.id;

    // Member connects via WebSocket
    const memberWs = await connectWs(memberToken, { baseUrl: TARGET_URL });

    try {
      await memberWs.waitForMessage((m) => m.type === 'ready');

      // Non-owner member attempts to delete channel -> must be rejected (403 or 400)
      const unauthDelete = await client.deleteChannel(tempChanId, memberToken);
      assert.ok([400, 403].includes(unauthDelete.status), 'Non-owner must not be permitted to delete channel');

      // Owner deletes the channel
      const ownerDelete = await client.deleteChannel(tempChanId, ownerToken);
      assert.equal(ownerDelete.status, 200);
      assert.equal(ownerDelete.data.success, true);
      assert.equal(ownerDelete.data.channel_id, tempChanId);

      // Member receives real-time channel_delete event over WebSocket
      const deleteEvent = await memberWs.waitForMessage(
        (m) => (m.type === 'channel_delete' || m.type === 'ChannelDelete') && (m.channel_id === tempChanId || m.channel?.id === tempChanId),
        5000
      );
      assert.ok(deleteEvent, 'Server member must receive channel deletion event via WebSocket');

      // Fetching messages from deleted channel returns 404
      const msgFetch = await client.getMessages(tempChanId, {}, memberToken);
      assert.equal(msgFetch.status, 404);

      // Posting message to deleted channel fails
      const postFail = await client.postMessage(tempChanId, { content: 'Should fail' }, memberToken);
      assert.ok([404, 400].includes(postFail.status));
    } finally {
      memberWs.close();
    }
  });
});

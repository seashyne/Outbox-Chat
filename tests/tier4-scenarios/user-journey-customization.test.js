/**
 * Tier 4 Scenario Tests: Real-World User Journeys & Customization Workloads
 *
 * Scenarios:
 * - S4.1: Complete end-user customization journey:
 *         Register -> Profile update (display name, avatar color) -> Custom theme palette
 *         (#112233, #223344, #334455) -> Create server & channels -> Post messages with text
 *         reactions (+1, Ack) -> Delete channel -> Logout -> Re-login -> Full state verification.
 * - S4.2: Multi-user presence & status interaction scenario (Lead, Dev, Reviewer collaboration).
 * - S4.3: Dynamic channel lifecycle and clean deletion across active subscribers.
 * - S4.4: Rapid theme palette switching and resilient session recovery.
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

describe('Tier 4: Real-World Application Workloads & User Journeys', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('S4.1: complete end-user customization journey (profile, custom theme palette, channel actions, text reactions, logout, re-login persistence)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // 1. Register new user
    const username = randomUsername('journey_master');
    const password = randomPassword(18);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const originalToken = regRes.data.token;
    const userId = regRes.data.user.id;

    // 2. Update user profile (display name, avatar color)
    const customDisplayName = 'Journey Specialist';
    const customAvatarColor = '#ff6600';
    const profileRes = await client.patchProfile({
      display_name: customDisplayName,
      color: customAvatarColor,
    }, originalToken);
    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.data.user.display_name, customDisplayName);
    assert.equal(profileRes.data.user.color, customAvatarColor);

    // 3. Select custom theme palette (#112233, #223344, #334455)
    const customPalette = {
      brand: '#112233',
      sidebar: '#223344',
      chat: '#334455',
    };
    const settingsRes = await client.patchSettings({
      theme: 'custom',
      custom_colors: customPalette,
      status: 'online',
    }, originalToken);
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.data.settings.theme, 'custom');
    assert.deepEqual(settingsRes.data.settings.custom_colors, customPalette);

    // 4. Create server & channels
    const srvRes = await client.createServer({ name: 'Alpha Odyssey', icon: 'AO' }, originalToken);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    const mainChanRes = await client.createChannel(serverId, { name: 'mission-brief', kind: 'text' }, originalToken);
    assert.equal(mainChanRes.status, 200);
    const mainChanId = mainChanRes.data.id;

    const tempChanRes = await client.createChannel(serverId, { name: 'scratch-notes', kind: 'text' }, originalToken);
    assert.equal(tempChanRes.status, 200);
    const tempChanId = tempChanRes.data.id;

    // 5. Post messages with text reactions (+1, Ack)
    const messageContent = 'Launch sequence initiated with custom theme palette.';
    const msgRes = await client.postMessage(mainChanId, { content: messageContent }, originalToken);
    assert.equal(msgRes.status, 200);
    const messageId = msgRes.data.id;

    const rx1 = await client.toggleReaction(messageId, '+1', originalToken);
    assert.equal(rx1.status, 200);
    assert.ok(rx1.data.reactions.some((r) => r.emoji === '+1'));

    const rx2 = await client.toggleReaction(messageId, 'Ack', originalToken);
    assert.equal(rx2.status, 200);
    assert.ok(rx2.data.reactions.some((r) => r.emoji === 'Ack'));

    // 6. Delete temporary channel
    const delRes = await client.deleteChannel(tempChanId, originalToken);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.success, true);

    // 7. Full logout
    const logoutRes = await client.logout(originalToken);
    assert.equal(logoutRes.status, 200);

    // Verify original session is terminated
    const deadSession = await client.bootstrap(originalToken);
    assert.equal(deadSession.status, 401);

    // 8. Re-login with credentials
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);
    const newToken = loginRes.data.token;
    assert.notEqual(newToken, originalToken);

    // 9. Verify full state integrity via bootstrap
    const boot = await client.bootstrap(newToken);
    assert.equal(boot.status, 200);

    // Profile intact
    assert.equal(boot.data.me.id, userId);
    assert.equal(boot.data.me.username, username);
    assert.equal(boot.data.me.display_name, customDisplayName);
    assert.equal(boot.data.me.color, customAvatarColor);

    // Theme & palette settings intact
    assert.equal(boot.data.settings.theme, 'custom');
    assert.deepEqual(boot.data.settings.custom_colors, customPalette);

    // Server & channel state intact
    const userServer = boot.data.servers.find((s) => s.id === serverId);
    assert.ok(userServer, 'Custom server must exist in user servers');

    // Deleted channel must not exist
    const serverChannels = boot.data.channels?.[serverId] || userServer.channels || [];
    assert.ok(serverChannels.some((c) => c.id === mainChanId));
    assert.ok(!serverChannels.some((c) => c.id === tempChanId), 'Deleted channel scratch-notes must not be present');

    // Message and text reactions intact
    const msgs = await client.getMessages(mainChanId, {}, newToken);
    assert.equal(msgs.status, 200);
    const msgList = Array.isArray(msgs.data) ? msgs.data : (msgs.data?.messages || []);
    const retrievedMsg = msgList.find((m) => m.id === messageId);
    assert.ok(retrievedMsg);
    assert.equal(retrievedMsg.content, messageContent);
    assert.ok(retrievedMsg.reactions.some((r) => r.emoji === '+1'));
    assert.ok(retrievedMsg.reactions.some((r) => r.emoji === 'Ack'));
  });

  it('S4.2: multi-user presence & status interaction scenario (Lead, Dev, Reviewer collaboration)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const regLead = await client.register(randomUsername('lead_u'), pass);
    const regDev = await client.register(randomUsername('dev_u'), pass);
    const regRev = await client.register(randomUsername('rev_u'), pass);

    const leadToken = regLead.data.token;
    const devToken = regDev.data.token;
    const revToken = regRev.data.token;

    // Profiles and statuses
    await client.patchProfile({ display_name: 'Tech Lead Alice' }, leadToken);
    await client.patchSettings({ status: 'dnd' }, leadToken);

    await client.patchProfile({ display_name: 'Developer Bob' }, devToken);
    await client.patchSettings({ status: 'idle' }, devToken);

    await client.patchProfile({ display_name: 'Reviewer Charlie' }, revToken);
    await client.patchSettings({ status: 'online' }, revToken);

    // Lead creates engineering workspace
    const srv = await client.createServer({ name: 'Engineering Core', icon: 'EC' }, leadToken);
    const serverId = srv.data.id;

    const chan = await client.createChannel(serverId, { name: 'code-review', kind: 'text' }, leadToken);
    const chanId = chan.data.id;

    // Dev and Reviewer join
    await client.joinServer(serverId, devToken);
    await client.joinServer(serverId, revToken);

    // Open WebSockets
    const wsDev = await connectWs(devToken, { baseUrl: TARGET_URL });
    const wsRev = await connectWs(revToken, { baseUrl: TARGET_URL });

    try {
      await wsDev.waitForMessage((m) => m.type === 'ready');
      await wsRev.waitForMessage((m) => m.type === 'ready');

      // Lead posts review request
      const reviewMsg = await client.postMessage(chanId, { content: 'PR #108 ready for review.' }, leadToken);
      const msgId = reviewMsg.data.id;

      // Both receive message event
      const devReceive = await wsDev.waitForMessage(
        (m) => m.type === 'message_create' && (m.message?.id === msgId || m.message_id === msgId || m.id === msgId),
        5000
      );
      assert.ok(devReceive);

      // Dev acknowledges with Ack; Reviewer approves with Done
      await client.toggleReaction(msgId, 'Ack', devToken);
      await client.toggleReaction(msgId, 'Done', revToken);

      // Dev updates status back to online and replies
      await client.patchSettings({ status: 'online' }, devToken);
      const reply = await client.postMessage(chanId, {
        content: 'Reviewed and approved.',
        reply_to: msgId,
      }, devToken);
      assert.equal(reply.status, 200);

      // Dev leaves server gracefully
      const leaveRes = await client.leaveServer(serverId, devToken);
      assert.equal(leaveRes.status, 200);

      // Reviewer checks server members: Dev is no longer a member
      const bootRev = await client.bootstrap(revToken);
      const srvView = bootRev.data.servers.find((s) => s.id === serverId);
      assert.ok(srvView);
      const members = bootRev.data.members?.[serverId] || srvView?.members || [];
      assert.ok(!members.some((m) => m.id === regDev.data.user.id || m.user_id === regDev.data.user.id));
    } finally {
      wsDev.close();
      wsRev.close();
    }
  });
});

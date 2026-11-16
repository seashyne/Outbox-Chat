/**
 * Tier 4 Scenario Tests: Multi-User Collaboration & Real-Time Sync
 * Real-world scenario exercising multi-user conversational threads,
 * consensus reactions, and WebSocket real-time broadcast delivery.
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

describe('Tier 4: Multi-User Chat Scenarios', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('S1.1: 3-user collaborative thread with consensus reactions and WebSocket broadcasting', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Register Alice, Bob, and Charlie
    const pass = randomPassword(16);
    const regAlice = await client.register(randomUsername('alice_t4'), pass);
    const regBob = await client.register(randomUsername('bob_t4'), pass);
    const regCharlie = await client.register(randomUsername('charlie_t4'), pass);

    const aliceToken = regAlice.data.token;
    const bobToken = regBob.data.token;
    const charlieToken = regCharlie.data.token;

    // Alice creates team workspace
    const srv = await client.createServer({ name: 'Sprint Workspace', icon: 'SW' }, aliceToken);
    const serverId = srv.data.id;

    // Create channel
    const chan = await client.createChannel(serverId, { name: 'sprint-planning', kind: 'text' }, aliceToken);
    const channelId = chan.data.id;

    // Bob and Charlie join
    await client.joinServer(serverId, bobToken);
    await client.joinServer(serverId, charlieToken);

    // Open WebSocket connections for Bob and Charlie
    const wsBob = await connectWs(bobToken, { baseUrl: TARGET_URL });
    const wsCharlie = await connectWs(charlieToken, { baseUrl: TARGET_URL });

    try {
      await wsBob.waitForMessage((m) => m.type === 'ready');
      await wsCharlie.waitForMessage((m) => m.type === 'ready');

      // Alice posts sprint proposal
      const proposalContent = 'Proposal: Release Outbox Chat v1.0 this week. React with +1 to approve.';
      const postAlice = await client.postMessage(channelId, { content: proposalContent }, aliceToken);
      const proposalId = postAlice.data.id;

      // Bob and Charlie receive message_create in real time
      const bobMsgEvent = await wsBob.waitForMessage(
        (m) => m.type === 'message_create' && m.message?.id === proposalId,
        5000
      );
      const charlieMsgEvent = await wsCharlie.waitForMessage(
        (m) => m.type === 'message_create' && m.message?.id === proposalId,
        5000
      );

      assert.equal(bobMsgEvent.message.content, proposalContent);
      assert.equal(charlieMsgEvent.message.content, proposalContent);

      // Bob votes +1
      await client.toggleReaction(proposalId, '+1', bobToken);

      // Charlie votes +1
      await client.toggleReaction(proposalId, '+1', charlieToken);

      // Alice votes +1
      const aliceRxRes = await client.toggleReaction(proposalId, '+1', aliceToken);
      assert.equal(aliceRxRes.status, 200);

      const plusOne = aliceRxRes.data.reactions.find((r) => r.emoji === '+1');
      assert.ok(plusOne);
      assert.equal(plusOne.count, 3, 'All 3 users should be counted');
      assert.equal(plusOne.me, true, 'Alice should have me: true');
      assert.ok(plusOne.users.includes(regAlice.data.user.id));
      assert.ok(plusOne.users.includes(regBob.data.user.id));
      assert.ok(plusOne.users.includes(regCharlie.data.user.id));

      // Charlie posts reply
      const replyRes = await client.postMessage(channelId, {
        content: 'Approved! All test suites are green.',
        reply_to: proposalId,
      }, charlieToken);
      assert.equal(replyRes.status, 200);

      // Bob receives reply over WebSocket
      const replyEvent = await wsBob.waitForMessage(
        (m) => m.type === 'message_create' && m.message?.id === replyRes.data.id,
        5000
      );
      assert.equal(replyEvent.message.reply?.id, proposalId);
    } finally {
      wsBob.close();
      wsCharlie.close();
    }
  });

  it('S1.2: real-time message moderation and deletion broadcast across subscribers', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const regAdmin = await client.register(randomUsername('mod_admin'), pass);
    const regUser = await client.register(randomUsername('mod_user'), pass);

    const adminToken = regAdmin.data.token;
    const userToken = regUser.data.token;

    // Admin creates server
    const srv = await client.createServer({ name: 'Moderated Server', icon: 'MS' }, adminToken);
    const chan = await client.createChannel(srv.data.id, { name: 'lobby', kind: 'text' }, adminToken);
    await client.joinServer(srv.data.id, userToken);

    // User connects WebSocket
    const wsUser = await connectWs(userToken, { baseUrl: TARGET_URL });

    try {
      await wsUser.waitForMessage((m) => m.type === 'ready');

      // User posts message
      const post = await client.postMessage(chan.data.id, { content: 'Message pending moderation' }, userToken);
      const msgId = post.data.id;

      // Admin deletes user's message (as server owner)
      const delRes = await client.deleteMessage(msgId, adminToken);
      assert.ok(delRes.status === 200 || delRes.status === 204);

      // User receives message_delete event via WebSocket
      const delEvent = await wsUser.waitForMessage(
        (m) => m.type === 'message_delete' && m.message_id === msgId,
        5000
      );
      assert.equal(delEvent.message_id, msgId);
      assert.equal(delEvent.server_id, srv.data.id);
    } finally {
      wsUser.close();
    }
  });
});

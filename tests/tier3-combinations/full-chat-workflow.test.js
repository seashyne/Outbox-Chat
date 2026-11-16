/**
 * Tier 3 Combination Tests: Full Chat Workflow
 * Complete End-to-End lifecycle exercising registration, server/channel creation,
 * invitation/join, messaging, replies, clean reactions, voice signaling, and administrative deletion.
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

describe('Tier 3: Full End-to-End Chat Workflow', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('C3.1: end-to-end multi-party collaboration workflow across full feature spectrum', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // 1. User A (Alice - Server Owner) registers
    const userA = randomUsername('alice_flow');
    const passA = randomPassword(16);
    const regA = await client.register(userA, passA);
    assert.equal(regA.status, 200);
    const tokenA = regA.data.token;
    const idA = regA.data.user.id;

    // 2. User B (Bob - Member) registers
    const userB = randomUsername('bob_flow');
    const passB = randomPassword(16);
    const regB = await client.register(userB, passB);
    assert.equal(regB.status, 200);
    const tokenB = regB.data.token;
    const idB = regB.data.user.id;

    // 3. Alice creates a new server "Production Hub" with clean text icon "PH"
    const srvRes = await client.createServer({ name: 'Production Hub', icon: 'PH' }, tokenA);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;
    assert.equal(srvRes.data.owner_id, idA);

    // 4. Alice creates text channel "announcements" and voice channel "conference"
    const textChanRes = await client.createChannel(serverId, {
      name: 'announcements',
      kind: 'text',
      topic: 'Important announcements',
    }, tokenA);
    assert.equal(textChanRes.status, 200);
    const textChanId = textChanRes.data.id;

    const voiceChanRes = await client.createChannel(serverId, {
      name: 'conference',
      kind: 'voice',
      topic: 'Voice conference room',
    }, tokenA);
    assert.equal(voiceChanRes.status, 200);
    const voiceChanId = voiceChanRes.data.id;

    // 5. Bob joins the server
    const joinRes = await client.joinServer(serverId, tokenB);
    assert.equal(joinRes.status, 200);
    assert.ok(joinRes.data.members.some((m) => m.id === idB));

    // 6. Alice posts an announcement message
    const msg1Res = await client.postMessage(textChanId, {
      content: 'Welcome to the Production Hub everyone! Please acknowledge.',
    }, tokenA);
    assert.equal(msg1Res.status, 200);
    const msg1Id = msg1Res.data.id;

    // 7. Bob reads channel history and adds a clean "Ack" reaction
    const listRes1 = await client.getMessages(textChanId, {}, tokenB);
    assert.equal(listRes1.status, 200);
    assert.ok(listRes1.data.some((m) => m.id === msg1Id));

    const rxAck = await client.toggleReaction(msg1Id, 'Ack', tokenB);
    assert.equal(rxAck.status, 200);
    assert.ok(rxAck.data.reactions.some((r) => r.emoji === 'Ack' && r.count === 1));

    // 8. Bob posts a threaded reply
    const replyRes = await client.postMessage(textChanId, {
      content: 'Acknowledged! Glad to be here.',
      reply_to: msg1Id,
    }, tokenB);
    assert.equal(replyRes.status, 200);
    const replyId = replyRes.data.id;
    assert.equal(replyRes.data.reply.id, msg1Id);

    // 9. Alice adds clean "+1" reaction to Bob's reply
    const rxPlus = await client.toggleReaction(replyId, '+1', tokenA);
    assert.equal(rxPlus.status, 200);
    assert.ok(rxPlus.data.reactions.some((r) => r.emoji === '+1'));

    // 10. Voice channel signaling: connect Alice to WebSocket gateway first (backend requirement)
    const wsAlice = await connectWs(tokenA, { baseUrl: TARGET_URL });
    await wsAlice.waitForMessage((m) => m.type === 'ready');

    const vJoin = await client.joinVoice(voiceChanId, tokenA);
    assert.ok(vJoin.status === 200 || vJoin.status === 204, `joinVoice failed with status ${vJoin.status}: ${vJoin.text}`);

    // Bob inspects voice state in bootstrap
    const bootBob = await client.bootstrap(tokenB);
    assert.equal(bootBob.status, 200);
    const voiceUsers = bootBob.data.voice?.[voiceChanId] || [];
    assert.ok(voiceUsers.includes(idA), 'Alice should appear in voice channel users');

    // Alice leaves voice channel
    const vLeave = await client.leaveVoice(voiceChanId, tokenA);
    assert.ok(vLeave.status === 200 || vLeave.status === 204);

    wsAlice.close();

    // 11. Security boundary check: Bob attempts to delete Alice's announcement -> Forbidden 403
    const badDelete = await client.deleteMessage(msg1Id, tokenB);
    assert.equal(badDelete.status, 403, 'Bob must not be able to delete Alice message');

    // 12. Administrative deletion: Alice (server owner) deletes the announcement
    const goodDelete = await client.deleteMessage(msg1Id, tokenA);
    assert.ok(goodDelete.status === 200 || goodDelete.status === 204);

    // Verify message is gone from channel history
    const finalHistory = await client.getMessages(textChanId, {}, tokenB);
    assert.equal(finalHistory.status, 200);
    assert.ok(!finalHistory.data.some((m) => m.id === msg1Id));
  });

  it('C3.2: server membership isolation and re-join synchronization', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user1 = randomUsername('sync_u1');
    const user2 = randomUsername('sync_u2');
    const pass = randomPassword(14);

    const reg1 = await client.register(user1, pass);
    const reg2 = await client.register(user2, pass);

    // User 1 creates isolated guild
    const srv = await client.createServer({ name: 'SyncGuild', icon: 'SG' }, reg1.data.token);
    const chan = await client.createChannel(srv.data.id, { name: 'sync-talk', kind: 'text' }, reg1.data.token);

    // User 2 cannot post prior to joining (403)
    const failPost = await client.postMessage(chan.data.id, { content: 'Premature post' }, reg2.data.token);
    assert.equal(failPost.status, 403);

    // User 2 joins
    const joinRes = await client.joinServer(srv.data.id, reg2.data.token);
    assert.equal(joinRes.status, 200);

    // User 2 can now post successfully
    const successPost = await client.postMessage(chan.data.id, { content: 'Post after joining' }, reg2.data.token);
    assert.equal(successPost.status, 200);
  });
});

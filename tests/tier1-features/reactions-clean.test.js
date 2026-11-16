/**
 * Tier 1 Feature Tests: Clean Reaction System (Text Tokens)
 * Requirement R2: Emote & Emoji Removal - Text Reaction Tokens
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

describe('Tier 1: Clean Reactions System (Text Tokens)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('5.1: adds a clean text reaction (+1) to a message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_u1');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Reaction target message 1' }, token);
    assert.equal(postRes.status, 200);
    const messageId = postRes.data.id;

    const rxRes = await client.toggleReaction(messageId, '+1', token);
    assert.equal(rxRes.status, 200, `Toggle reaction failed: ${rxRes.text}`);

    const reactions = rxRes.data.reactions;
    assert.ok(Array.isArray(reactions), 'Reactions must be an array');
    const plusOne = reactions.find((r) => r.emoji === '+1');
    assert.ok(plusOne, 'Expected "+1" reaction in message view');
    assert.equal(plusOne.count, 1);
    assert.equal(plusOne.me, true);
    assert.ok(plusOne.users.includes(reg.data.user.id));
  });

  it('5.2: adds multiple distinct clean text reactions (Like, Done) to the same message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_u2');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Reaction target message 2' }, token);
    const messageId = postRes.data.id;

    await client.toggleReaction(messageId, 'Like', token);
    const rxRes2 = await client.toggleReaction(messageId, 'Done', token);

    assert.equal(rxRes2.status, 200);
    const reactions = rxRes2.data.reactions;
    assert.ok(reactions.some((r) => r.emoji === 'Like'));
    assert.ok(reactions.some((r) => r.emoji === 'Done'));
  });

  it('5.3: toggles off a clean reaction when submitted a second time by the same user', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_u3');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Toggle reaction message' }, token);
    const messageId = postRes.data.id;

    // First toggle: ON
    const onRes = await client.toggleReaction(messageId, 'Ack', token);
    assert.equal(onRes.status, 200);
    assert.ok(onRes.data.reactions.some((r) => r.emoji === 'Ack' && r.count === 1));

    // Second toggle: OFF
    const offRes = await client.toggleReaction(messageId, 'Ack', token);
    assert.equal(offRes.status, 200);
    const ackEntry = offRes.data.reactions.find((r) => r.emoji === 'Ack');
    assert.equal(ackEntry, undefined, 'Ack reaction should be removed when toggled off');
  });

  it('5.4: increments reaction count when multiple distinct users add the same reaction', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const userA = randomUsername('rx_userA');
    const userB = randomUsername('rx_userB');
    const pass = randomPassword(12);

    const regA = await client.register(userA, pass);
    const regB = await client.register(userB, pass);

    const postRes = await client.postMessage('demo-0', { content: 'Multi-user reaction test' }, regA.data.token);
    const messageId = postRes.data.id;

    // User A reacts with "+1"
    await client.toggleReaction(messageId, '+1', regA.data.token);

    // User B reacts with "+1"
    const resB = await client.toggleReaction(messageId, '+1', regB.data.token);
    assert.equal(resB.status, 200);

    const plusOne = resB.data.reactions.find((r) => r.emoji === '+1');
    assert.ok(plusOne);
    assert.equal(plusOne.count, 2);
    assert.equal(plusOne.me, true, 'User B should see me: true for their view');
    assert.ok(plusOne.users.includes(regA.data.user.id));
    assert.ok(plusOne.users.includes(regB.data.user.id));
  });

  it('5.5: supports all specification clean reaction tokens (+1, Like, Ack, Done, Help, Idea)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_all');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'All clean tokens test' }, token);
    const messageId = postRes.data.id;

    const cleanTokens = ['+1', 'Like', 'Ack', 'Done', 'Help', 'Idea'];

    for (const tokenName of cleanTokens) {
      const res = await client.toggleReaction(messageId, tokenName, token);
      assert.equal(res.status, 200, `Failed to toggle reaction token ${tokenName}: ${res.text}`);
      assert.ok(
        res.data.reactions.some((r) => r.emoji === tokenName),
        `Reaction ${tokenName} must be present in response`
      );
    }
  });

  it('5.6: broadcasts message_update event over WebSocket when a reaction is toggled', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_ws');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const ws = await connectWs(token, { baseUrl: TARGET_URL });
    try {
      await ws.waitForMessage((m) => m.type === 'ready');

      const postRes = await client.postMessage('demo-0', { content: 'WS reaction broadcast test' }, token);
      const messageId = postRes.data.id;

      // Toggle reaction
      await client.toggleReaction(messageId, 'Like', token);

      // Verify WebSocket receives message_update
      const updateMsg = await ws.waitForMessage(
        (m) => m.type === 'message_update' && m.message?.id === messageId,
        5000
      );
      assert.ok(updateMsg, 'Expected message_update event over WebSocket');
      assert.equal(updateMsg.message.id, messageId);
      assert.ok(updateMsg.message.reactions.some((r) => r.emoji === 'Like'));
    } finally {
      ws.close();
    }
  });
});

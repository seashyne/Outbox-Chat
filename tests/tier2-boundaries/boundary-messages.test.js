/**
 * Tier 2 Boundary Tests: Messaging Boundaries & Permission Restrictions
 * Requirement: Message limits, voice channel restrictions, membership authorization
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

describe('Tier 2: Messaging Boundaries & Permissions', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B4.1: rejects posting empty or whitespace-only messages with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('bmsg_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    // Empty content
    const resEmpty = await client.postMessage('demo-0', { content: '' }, token);
    assert.equal(resEmpty.status, 400, `Expected 400 for empty message, got ${resEmpty.status}`);

    // Whitespace only
    const resSpaces = await client.postMessage('demo-0', { content: '     ' }, token);
    assert.equal(resSpaces.status, 400, `Expected 400 for whitespace message, got ${resSpaces.status}`);
  });

  it('B4.2: rejects oversized message content (> 2000 characters) with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('over_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const oversized2001 = 'm'.repeat(2001);
    const res = await client.postMessage('demo-0', { content: oversized2001 }, token);

    assert.equal(res.status, 400, `Expected 400 for >2000 character message, got ${res.status}`);
    assert.match(res.data?.error || '', /message/i);
  });

  it('B4.3: rejects posting messages to a voice channel with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('vchat_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    // Find a voice channel in demo server (demo-3 is Lounge voice channel)
    const bootstrapRes = await client.bootstrap(token);
    const demoServer = bootstrapRes.data.servers.find((s) => s.id === 'demo');
    assert.ok(demoServer);

    const voiceChannel = demoServer.channels.find((c) => c.kind === 'voice');
    assert.ok(voiceChannel, 'Expected at least one voice channel in demo server');

    const res = await client.postMessage(voiceChannel.id, { content: 'Trying to text in voice' }, token);
    assert.equal(res.status, 400, `Expected 400 when posting text to voice channel, got ${res.status}`);
    assert.match(res.data?.error || '', /cannot post messages to a voice channel/i);
  });

  it('B4.4: rejects fetching message history from a voice channel with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('vhist_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const bootstrapRes = await client.bootstrap(token);
    const demoServer = bootstrapRes.data.servers.find((s) => s.id === 'demo');
    const voiceChannel = demoServer.channels.find((c) => c.kind === 'voice');
    assert.ok(voiceChannel);

    const res = await client.getMessages(voiceChannel.id, {}, token);
    assert.equal(res.status, 400, `Expected 400 when reading voice history, got ${res.status}`);
    assert.match(res.data?.error || '', /voice channels do not have a message history/i);
  });

  it('B4.5: rejects posting messages to a server channel when user is not a member with HTTP 403', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const ownerName = randomUsername('own_priv');
    const strangerName = randomUsername('stranger');
    const pass = randomPassword(12);

    const regOwner = await client.register(ownerName, pass);
    const regStranger = await client.register(strangerName, pass);

    // Owner creates private server & channel
    const srvRes = await client.createServer({ name: 'Private Guild', icon: 'P' }, regOwner.data.token);
    assert.equal(srvRes.status, 200);

    const chanRes = await client.createChannel(srvRes.data.id, {
      name: 'members-only',
      kind: 'text',
    }, regOwner.data.token);
    assert.equal(chanRes.status, 200);

    const privateChannelId = chanRes.data.id;

    // Stranger (not member of private server) tries to post
    const postRes = await client.postMessage(
      privateChannelId,
      { content: 'Unauthorized intrusion attempt' },
      regStranger.data.token
    );

    assert.equal(postRes.status, 403, `Expected 403 Forbidden for non-member, got ${postRes.status}`);
    assert.match(postRes.data?.error || '', /not a member/i);
  });

  it('B4.6: rejects deleting another member\'s message when requester is regular member with HTTP 403', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const userA = randomUsername('author_u');
    const userB = randomUsername('attacker_u');
    const pass = randomPassword(12);

    const regA = await client.register(userA, pass);
    const regB = await client.register(userB, pass);

    // User A posts message in demo-0
    const postRes = await client.postMessage('demo-0', { content: "Author's message" }, regA.data.token);
    assert.equal(postRes.status, 200);
    const msgId = postRes.data.id;

    // User B tries to delete User A's message
    const delRes = await client.deleteMessage(msgId, regB.data.token);
    assert.equal(delRes.status, 403, `Expected 403 when deleting another's message, got ${delRes.status}`);
    assert.match(delRes.data?.error || '', /only the author or a server admin/i);
  });

  it('B4.7: returns HTTP 404 Not Found when attempting to delete a non-existent message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('del_404');
    const pass = randomPassword(12);

    const reg = await client.register(username, pass);
    const res = await client.deleteMessage('non_existent_msg_id_12345', reg.data.token);

    assert.equal(res.status, 404, `Expected 404 for non-existent message, got ${res.status}`);
    assert.match(res.data?.error || '', /message/i);
  });

  it('B4.8: rejects posting message with whitespace-only content with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('msg_ws');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);

    const res = await client.postMessage('demo-0', { content: '     ' }, reg.data.token);
    assert.ok(res.status === 400 || res.status === 422, `Expected 400 or 422 for whitespace message, got ${res.status}`);
  });

  it('B4.9: rejects posting message with excessively large content (>4000 characters)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('msg_huge');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);

    const largeContent = 'A'.repeat(5000);
    const res = await client.postMessage('demo-0', { content: largeContent }, reg.data.token);
    assert.ok(
      res.status === 400 || res.status === 413 || res.status === 422,
      `Expected 400/413/422 for message >4000 chars, got ${res.status}`
    );
  });
});

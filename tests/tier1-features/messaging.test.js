/**
 * Tier 1 Feature Tests: Channels & Messaging Lifecycle
 * Requirement: Messaging, channel operations, and message management
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

describe('Tier 1: Messaging & Channels', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('4.1: posts a message to a text channel and receives valid MessageView', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('msg_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const content = `Hello Outbox Chat! ${Date.now()}`;
    const res = await client.postMessage('demo-0', { content }, token);

    assert.equal(res.status, 200, `Post message failed: ${res.text}`);
    assert.ok(res.data.id, 'Message must have an id');
    assert.equal(res.data.channel_id, 'demo-0');
    assert.equal(res.data.content, content);
    assert.equal(res.data.author.id, reg.data.user.id);
    assert.equal(res.data.author.username, username);
    assert.ok(Array.isArray(res.data.reactions));
  });

  it('4.2: fetches message history from text channel containing newly posted message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('fetch_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const uniqueText = `Unique message content ${Date.now()}_${Math.random()}`;
    const postRes = await client.postMessage('demo-0', { content: uniqueText }, token);
    assert.equal(postRes.status, 200);

    const listRes = await client.getMessages('demo-0', { limit: 50 }, token);
    assert.equal(listRes.status, 200, `List messages failed: ${listRes.text}`);
    assert.ok(Array.isArray(listRes.data), 'Messages must be an array');

    const found = listRes.data.find((m) => m.id === postRes.data.id);
    assert.ok(found, 'Posted message must exist in channel history');
    assert.equal(found.content, uniqueText);
  });

  it('4.3: posts a threaded reply referencing an existing parent message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('reply_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const parentRes = await client.postMessage('demo-0', { content: 'Parent message' }, token);
    assert.equal(parentRes.status, 200);

    const replyRes = await client.postMessage('demo-0', {
      content: 'This is a threaded reply',
      reply_to: parentRes.data.id,
    }, token);

    assert.equal(replyRes.status, 200, `Reply failed: ${replyRes.text}`);
    assert.ok(replyRes.data.reply, 'Expected reply object in message view');
    assert.equal(replyRes.data.reply.id, parentRes.data.id);
    assert.equal(replyRes.data.reply.author.username, username);
  });

  it('4.4: deletes own message and verifies removal from history', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('del_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'To be deleted' }, token);
    assert.equal(postRes.status, 200);
    const msgId = postRes.data.id;

    const delRes = await client.deleteMessage(msgId, token);
    assert.ok(delRes.status === 200 || delRes.status === 204, `Expected 200/204 on delete, got ${delRes.status}`);

    const listRes = await client.getMessages('demo-0', { limit: 50 }, token);
    assert.equal(listRes.status, 200);
    const found = listRes.data.find((m) => m.id === msgId);
    assert.equal(found, undefined, 'Deleted message must no longer appear in history');
  });

  it('4.5: creates a new text channel in a created server and exchanges messages', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('chan_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Create server
    const srvRes = await client.createServer({ name: 'ChannelTestSrv', icon: 'CT' }, token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Create channel
    const chanRes = await client.createChannel(serverId, {
      name: 'dev-discuss',
      kind: 'text',
      topic: 'Technical discussion',
    }, token);
    assert.equal(chanRes.status, 200, `Create channel failed: ${chanRes.text}`);
    assert.equal(chanRes.data.name, 'dev-discuss');
    assert.equal(chanRes.data.kind, 'text');

    const channelId = chanRes.data.id;

    // Post to new channel
    const postRes = await client.postMessage(channelId, { content: 'First message in new channel' }, token);
    assert.equal(postRes.status, 200);
    assert.equal(postRes.data.channel_id, channelId);

    // List from new channel
    const listRes = await client.getMessages(channelId, {}, token);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.length, 1);
    assert.equal(listRes.data[0].id, postRes.data.id);
  });

  it('4.6: supports message pagination limit parameter', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('page_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Post 3 messages
    for (let i = 1; i <= 3; i++) {
      await client.postMessage('demo-0', { content: `Pagination message ${i} - ${Date.now()}` }, token);
    }

    const listRes = await client.getMessages('demo-0', { limit: 2 }, token);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.data.length <= 2, `Expected at most 2 messages, got ${listRes.data.length}`);
  });
});

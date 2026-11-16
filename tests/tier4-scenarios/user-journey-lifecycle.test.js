/**
 * Tier 4 Scenario Tests: Dynamic Channel Lifecycle & Rapid Theme Switching
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

describe('Tier 4: Channel Lifecycle & Theme Resilience Workloads', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('S4.3: dynamic channel lifecycle and clean deletion across active subscribers', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(16);
    const admin = await client.register(randomUsername('admin_u'), pass);
    const member = await client.register(randomUsername('member_u'), pass);

    const srv = await client.createServer({ name: 'Subscriber Test Hub', icon: 'ST' }, admin.data.token);
    const serverId = srv.data.id;

    const c1 = await client.createChannel(serverId, { name: 'retained-chan', kind: 'text' }, admin.data.token);
    const c2 = await client.createChannel(serverId, { name: 'ephemeral-chan', kind: 'text' }, admin.data.token);

    await client.joinServer(serverId, member.data.token);
    const memberWs = await connectWs(member.data.token, { baseUrl: TARGET_URL });

    try {
      await memberWs.waitForMessage((m) => m.type === 'ready');

      await client.postMessage(c1.data.id, { content: 'Retained message' }, admin.data.token);
      await client.postMessage(c2.data.id, { content: 'Ephemeral message' }, admin.data.token);

      const delRes = await client.deleteChannel(c2.data.id, admin.data.token);
      assert.equal(delRes.status, 200);

      const delEvent = await memberWs.waitForMessage(
        (m) => (m.type === 'channel_delete' || m.type === 'ChannelDelete') && (m.channel_id === c2.data.id || m.channel?.id === c2.data.id),
        5000
      );
      assert.ok(delEvent);

      const post2 = await client.postMessage(c1.data.id, { content: 'Post after deletion' }, member.data.token);
      assert.equal(post2.status, 200);

      const msgs = await client.getMessages(c1.data.id, {}, member.data.token);
      const msgList = Array.isArray(msgs.data) ? msgs.data : (msgs.data?.messages || []);
      assert.ok(msgList.length >= 2);
    } finally {
      memberWs.close();
    }
  });

  it('S4.4: rapid theme palette switching and resilient session recovery', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rapid_theme');
    const password = randomPassword(16);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const themes = ['dark', 'slate', 'forest', 'midnight', 'amber'];
    for (const theme of themes) {
      const res = await client.patchSettings({ theme }, token);
      assert.equal(res.status, 200);
      assert.equal(res.data.settings.theme, theme);
    }

    const finalPalette = { brand: '#abcdef', sidebar: '#123456', chat: '#654321' };
    const customRes = await client.patchSettings({ theme: 'custom', custom_colors: finalPalette }, token);
    assert.equal(customRes.status, 200);
    assert.equal(customRes.data.settings.theme, 'custom');
    assert.deepEqual(customRes.data.settings.custom_colors, finalPalette);

    const boot = await client.bootstrap(token);
    assert.equal(boot.status, 200);
    assert.equal(boot.data.settings.theme, 'custom');
    assert.deepEqual(boot.data.settings.custom_colors, finalPalette);
  });
});

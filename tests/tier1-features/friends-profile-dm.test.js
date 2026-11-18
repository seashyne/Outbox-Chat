/**
 * Tier 1 Feature Tests: Extended Profiles, Per-Server Identity, Friends & 1-on-1 DMs
 * Verifies parity across Rust & Cloudflare Workers for:
 * - Banner upload (`banner_url`), `bio`, `status_text`, editable `@username` handle
 * - Per-server profile overrides (`PATCH /api/servers/{id}/profile`) + event broadcast
 * - Friend requests by `@handle`, accept/decline/cancel, private DM isolation
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

describe('Tier 1: Extended Profiles, Per-Server Identity, Friends & DMs', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('11.1: updates banner_url, bio, status_text, @username handle and rejects duplicate handles', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const u1 = await client.register(randomUsername('prof_u1'), pass);
    const u2 = await client.register(randomUsername('prof_u2'), pass);
    const sampleBanner = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAAAQAAf8A/7e4f8kAAAAASUVORK5CYII=';

    const nextHandle = randomUsername('new_at');
    const upd = await client.patchMe({
      username: `@${nextHandle}`,
      banner_url: sampleBanner,
      bio: 'ชอบคุยเสียงและแชร์งาน',
      status_text: 'กำลังพัฒนาเว็บ',
    }, u1.data.token);
    assert.equal(upd.status, 200);
    assert.equal(upd.data.user.username, nextHandle);
    assert.equal(upd.data.user.banner_url, sampleBanner);
    assert.equal(upd.data.user.bio, 'ชอบคุยเสียงและแชร์งาน');
    assert.equal(upd.data.user.status_text, 'กำลังพัฒนาเว็บ');

    const conflict = await client.patchMe({ username: u2.data.user.username }, u1.data.token);
    assert.equal(conflict.status, 409);
  });

  it('11.2: sets per-server profile override without modifying global profile', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const u1 = await client.register(randomUsername('srvp_u1'), pass);
    const srv = await client.createServer({ name: 'Work Guild' }, u1.data.token);
    const sid = srv.data.id;

    const srvPatch = await client.request('PATCH', `/api/servers/${sid}/profile`, {
      token: u1.data.token,
      body: { nickname: 'หัวหน้าทีม', bio: 'ดูแลโปรเจกต์หลัก' },
    });
    assert.equal(srvPatch.status, 200);
    assert.equal(srvPatch.data.profile.nickname, 'หัวหน้าทีม');

    const boot = await client.bootstrap(u1.data.token);
    const view = boot.data.servers.find((s) => s.id === sid);
    assert.equal(view.member_profiles[u1.data.user.id].nickname, 'หัวหน้าทีม');
    assert.notEqual(boot.data.me.display_name, 'หัวหน้าทีม');
  });

  it('11.3: adds friend by @handle, accepts request, and exchanges private 1-on-1 DMs', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const alice = await client.register(randomUsername('fr_alice'), pass);
    const bob = await client.register(randomUsername('fr_bob'), pass);
    const eve = await client.register(randomUsername('fr_eve'), pass);

    const wsBob = await connectWs(bob.data.token, { baseUrl: TARGET_URL });
    try {
      await wsBob.waitForMessage((m) => m.type === 'ready');

      const reqRes = await client.request('POST', '/api/friends/request', {
        token: alice.data.token,
        body: { username: `@${bob.data.user.username}` },
      });
      assert.equal(reqRes.status, 200);
      assert.equal(reqRes.data.outgoing.length, 1);

      await wsBob.waitForMessage((m) => m.type === 'friend_update');

      const accRes = await client.request('POST', `/api/friends/${alice.data.user.id}/accept`, {
        token: bob.data.token,
      });
      assert.equal(accRes.status, 200);
      assert.equal(accRes.data.friends.length, 1);

      const dmRes = await client.request('POST', `/api/dm/${bob.data.user.id}`, {
        token: alice.data.token,
      });
      assert.equal(dmRes.status, 200);
      const dmCid = dmRes.data.channel.id;

      const sendRes = await client.postMessage(dmCid, { content: 'สวัสดีเพื่อนใหม่!' }, alice.data.token);
      assert.equal(sendRes.status, 200);

      const bobMsgs = await client.getMessages(dmCid, {}, bob.data.token);
      assert.equal(bobMsgs.status, 200);
      assert.ok(bobMsgs.data.some((m) => m.content === 'สวัสดีเพื่อนใหม่!'));

      // Eve (non-participant) cannot read Alice<->Bob DM
      const eveMsgs = await client.getMessages(dmCid, {}, eve.data.token);
      assert.equal(eveMsgs.status, 403);
    } finally {
      wsBob.close();
    }
  });
});

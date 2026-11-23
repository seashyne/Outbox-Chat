/**
 * E2E verification for message attachments, server invite links,
 * and 1-on-1 DM voice/video WebRTC call signaling across both backends.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient, randomPassword, randomUsername } from '../helpers/client.js';
import { connectWs } from '../helpers/ws.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Tier 1: Attachments, Invites & 1-on-1 DM Calls', () => {
  it('12.1: uploads and retrieves image/file attachments and rejects unsafe MIME types', async () => {
    const client = new ApiClient();
    const { data: reg } = await client.register(randomUsername('att'), randomPassword());
    client.setToken(reg.token);

    const { data: boot } = await client.bootstrap();
    const chId = boot.default_channel_id;

    const { status: postStatus, data: msg } = await client.request('POST', `/api/channels/${encodeURIComponent(chId)}/messages`, {
      body: {
        content: '',
        attachments: [{ name: 'photo.png', mime: 'image/png', size: 68, data_url: TINY_PNG }],
      },
    });
    assert.equal(postStatus, 200);
    assert.equal(msg.attachments.length, 1);
    assert.equal(msg.attachments[0].name, 'photo.png');
    assert.equal(msg.attachments[0].mime, 'image/png');

    const { status: badStatus } = await client.request('POST', `/api/channels/${encodeURIComponent(chId)}/messages`, {
      body: {
        content: 'bad',
        attachments: [{ name: 'evil.html', mime: 'text/html', size: 12, data_url: 'data:text/html;base64,PHNjcmlwdD4=' }],
      },
    });
    assert.equal(badStatus, 400);
  });

  it('12.2: creates invite link with max_uses=1, enforces limit, and supports revocation', async () => {
    const owner = new ApiClient();
    const u1 = new ApiClient();
    const u2 = new ApiClient();

    const rOwn = await owner.register(randomUsername('inv_own'), randomPassword());
    owner.setToken(rOwn.data.token);
    const r1 = await u1.register(randomUsername('inv_u1'), randomPassword());
    u1.setToken(r1.data.token);
    const r2 = await u2.register(randomUsername('inv_u2'), randomPassword());
    u2.setToken(r2.data.token);

    const { data: srv } = await owner.createServer('Invite Club');
    const { status: invStatus, data: inv } = await owner.request('POST', `/api/servers/${srv.id}/invites`, {
      body: { expires_in_hours: 24, max_uses: 1 },
    });
    assert.equal(invStatus, 200);
    assert.equal(inv.max_uses, 1);

    const { status: prevStatus, data: preview } = await owner.request('GET', `/api/invites/${inv.code}`);
    assert.equal(prevStatus, 200);
    assert.equal(preview.server_id, srv.id);
    assert.equal(preview.valid, true);

    const { status: j1 } = await u1.request('POST', `/api/invites/${inv.code}/join`);
    assert.equal(j1, 200);

    const { status: j2 } = await u2.request('POST', `/api/invites/${inv.code}/join`);
    assert.equal(j2, 400);

    const { status: listStatus, data: list } = await owner.request('GET', `/api/servers/${srv.id}/invites`);
    assert.equal(listStatus, 200);
    assert.equal(list[0].exhausted, true);

    const { status: delStatus } = await owner.request('DELETE', `/api/invites/${inv.code}`);
    assert.equal(delStatus, 204);
  });

  it('12.3: joins 1-on-1 DM voice/video call and relays rtc_signal between friends', async () => {
    const alice = new ApiClient();
    const bob = new ApiClient();
    const rA = await alice.register(randomUsername('dmc_a'), randomPassword());
    const rB = await bob.register(randomUsername('dmc_b'), randomPassword());
    alice.setToken(rA.data.token);
    bob.setToken(rB.data.token);

    await alice.request('POST', '/api/friends/request', { body: { username: rB.data.user.username } });
    await bob.request('POST', `/api/friends/${rA.data.user.id}/accept`);
    const { data: dmRes } = await alice.request('POST', `/api/dm/${rB.data.user.id}`);
    const dmCid = dmRes.channel.id;

    const [wsA, wsB] = await Promise.all([connectWs(rA.data.token), connectWs(rB.data.token)]);

    try {
      const { status: ja } = await alice.request('POST', `/api/channels/${encodeURIComponent(dmCid)}/voice/join`);
      assert.equal(ja, 200);

      const { status: jb } = await bob.request('POST', `/api/channels/${encodeURIComponent(dmCid)}/voice/join`);
      assert.equal(jb, 200);

      const signalPromise = wsB.waitForMessage((ev) => ev.type === 'rtc_signal' && ev.channel_id === dmCid);
      wsA.send({
        type: 'rtc_signal',
        channel_id: dmCid,
        to: rB.data.user.id,
        signal: { sdp: { type: 'offer', sdp: 'v=0' } },
      });
      const sig = await signalPromise;
      assert.equal(sig.from, rA.data.user.id);
      assert.equal(sig.signal.sdp.type, 'offer');

      await alice.request('POST', `/api/channels/${encodeURIComponent(dmCid)}/voice/leave`);
      await bob.request('POST', `/api/channels/${encodeURIComponent(dmCid)}/voice/leave`);
    } finally {
      wsA.close();
      wsB.close();
    }
  });
});

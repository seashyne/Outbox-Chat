/**
 * E2E verification for Phase 1 rich chat capabilities:
 * message editing, pinning, cross-channel search, custom server stickers, and link previews.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient, randomPassword, randomUsername } from '../helpers/client.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Tier 1: Phase 1 Rich Chat (Edit, Pin, Server Search, Stickers, Link Previews)', () => {
  it('13.1: edits own message with edited_at timestamp and blocks other users from editing', async () => {
    const alice = new ApiClient();
    const bob = new ApiClient();
    const rA = await alice.register(randomUsername('ed_a'), randomPassword());
    const rB = await bob.register(randomUsername('ed_b'), randomPassword());
    alice.setToken(rA.data.token);
    bob.setToken(rB.data.token);

    const { data: boot } = await alice.bootstrap();
    const chId = boot.default_channel_id;
    const { data: msg } = await alice.postMessage(chId, 'initial draft');
    assert.equal(msg.edited_at, null);

    const { status: editStatus, data: updated } = await alice.request('PATCH', `/api/messages/${msg.id}`, {
      body: { content: 'revised final content' },
    });
    assert.equal(editStatus, 200);
    assert.equal(updated.content, 'revised final content');
    assert.ok(updated.edited_at);

    const { status: forbidden } = await bob.request('PATCH', `/api/messages/${msg.id}`, {
      body: { content: 'hijack' },
    });
    assert.equal(forbidden, 403);
  });

  it('13.2: pins and unpins messages and lists channel pinned messages', async () => {
    const client = new ApiClient();
    const { data: reg } = await client.register(randomUsername('pin_u'), randomPassword());
    client.setToken(reg.token);

    const { data: srv } = await client.createServer('Pin HQ');
    const chId = srv.channels.find((c) => c.kind === 'text').id;
    const { data: msg } = await client.postMessage(chId, 'important announcement');
    assert.equal(msg.pinned, false);

    const { status: p1, data: pinned } = await client.request('POST', `/api/messages/${msg.id}/pin`);
    assert.equal(p1, 200);
    assert.equal(pinned.pinned, true);

    const { status: l1, data: list1 } = await client.request('GET', `/api/channels/${chId}/pins`);
    assert.equal(l1, 200);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].id, msg.id);

    const { status: p2, data: unpinned } = await client.request('POST', `/api/messages/${msg.id}/pin`);
    assert.equal(p2, 200);
    assert.equal(unpinned.pinned, false);
  });

  it('13.3: searches messages across multiple text channels in a server', async () => {
    const client = new ApiClient();
    const { data: reg } = await client.register(randomUsername('srch_u'), randomPassword());
    client.setToken(reg.token);

    const { data: srv } = await client.createServer('Search Guild');
    const ch1 = srv.channels.find((c) => c.kind === 'text').id;
    const { data: ch2Obj } = await client.createChannel(srv.id, { name: 'notes', kind: 'text' });

    const tokenWord = ` needle_${Date.now()} `;
    await client.postMessage(ch1, `first match ${tokenWord} in general`);
    await client.postMessage(ch2Obj.id, `second match ${tokenWord} in notes`);

    const { status, data: hits } = await client.request('GET', `/api/servers/${srv.id}/search`, {
      query: { q: tokenWord.trim() },
    });
    assert.equal(status, 200);
    assert.equal(hits.length, 2);
  });

  it('13.4: uploads, lists, and deletes custom server stickers', async () => {
    const client = new ApiClient();
    const { data: reg } = await client.register(randomUsername('stk_u'), randomPassword());
    client.setToken(reg.token);

    const { data: srv } = await client.createServer('Sticker Server');
    const { status: cStatus, data: stk } = await client.request('POST', `/api/servers/${srv.id}/stickers`, {
      body: { name: 'cheer', data_url: TINY_PNG },
    });
    assert.equal(cStatus, 200);
    assert.equal(stk.name, 'cheer');

    const { status: lStatus, data: list } = await client.request('GET', `/api/servers/${srv.id}/stickers`);
    assert.equal(lStatus, 200);
    assert.equal(list.length, 1);

    const { status: dStatus } = await client.request('DELETE', `/api/servers/${srv.id}/stickers/${stk.id}`);
    assert.equal(dStatus, 204);
  });

  it('13.5: generates link preview metadata and blocks private/localhost URLs', async () => {
    const client = new ApiClient();
    const { data: reg } = await client.register(randomUsername('lnk_u'), randomPassword());
    client.setToken(reg.token);

    const { status: okStatus, data: yt } = await client.request('GET', '/api/links/preview', {
      query: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    });
    assert.equal(okStatus, 200);
    assert.equal(yt.domain, 'www.youtube.com');
    assert.ok(yt.image?.includes('dQw4w9WgXcQ'));

    const { status: badStatus } = await client.request('GET', '/api/links/preview', {
      query: { url: 'http://127.0.0.1:3000/secret' },
    });
    assert.equal(badStatus, 400);
  });
});

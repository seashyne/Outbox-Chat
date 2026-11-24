/**
 * Tier 1 E2E: Phase 2 & Phase 3 Features
 * - Large media / audio / video binary upload (`POST/GET /api/files`) & channel gallery
 * - Channel categories, `PATCH /api/channels/{id}`, admin-only visibility, read-only & slowmode (429)
 * - Discussion threads (`GET/POST /api/channels/{id}/threads`, `/api/threads/{id}/messages`)
 * - Server moderation (`kick`, `ban`/`unban`, rejoin block, `timeout`, `audit` logs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, TARGET_URL, checkSkip, isServerOnline, randomPassword, randomUsername } from '../helpers/client.js';

let online = false;
test.before(async () => {
  online = await isServerOnline();
});

async function registerUser(prefix) {
  const client = new ApiClient(TARGET_URL);
  const res = await client.register(randomUsername(prefix), randomPassword());
  assert.equal(res.status, 200);
  return { user: res.data.user, token: res.data.token };
}

test('Phase 2: Binary >512KB media upload, streaming, message attachment, and media gallery', async (t) => {
  if (checkSkip(t, online)) return;
  const owner = await registerUser('p2own');
  const client = new ApiClient(TARGET_URL, owner.token);
  const srvRes = await client.createServer('Phase2 Media Lab');
  assert.equal(srvRes.status, 200);
  const textCh = srvRes.data.channels.find((c) => c.kind === 'text');
  assert.ok(textCh);

  // Upload a 620 KB binary clip (exceeds 512 KB chunk boundary on DO SQLite)
  const videoBytes = new Uint8Array(620 * 1024);
  for (let i = 0; i < videoBytes.length; i += 4096) videoBytes[i] = (i >> 12) & 0xff;
  const upVidRes = await fetch(`${TARGET_URL}/api/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${owner.token}`,
      'Content-Type': 'video/mp4',
      'X-File-Name': encodeURIComponent('demo clip.mp4'),
    },
    body: videoBytes,
  });
  assert.equal(upVidRes.status, 200);
  const upVid = await upVidRes.json();
  assert.ok(upVid.url.startsWith('/api/files/'));
  assert.equal(upVid.size, videoBytes.byteLength);

  // Stream uploaded file back without Bearer header (browser <video> / <audio> tag behavior)
  const getVid = await fetch(`${TARGET_URL}${upVid.url}`);
  assert.equal(getVid.status, 200);
  assert.equal(getVid.headers.get('content-type'), 'video/mp4');
  assert.equal(getVid.headers.get('x-content-type-options'), 'nosniff');
  const streamed = new Uint8Array(await getVid.arrayBuffer());
  assert.equal(streamed.byteLength, videoBytes.byteLength);
  assert.equal(streamed[512 * 1024], videoBytes[512 * 1024]);

  // Upload voice note audio clip
  const audioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  const upAudRes = await fetch(`${TARGET_URL}/api/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${owner.token}`,
      'Content-Type': 'audio/webm;codecs=opus',
      'X-File-Name': 'voice-note.webm',
    },
    body: audioBytes,
  });
  assert.equal(upAudRes.status, 200);
  const upAud = await upAudRes.json();

  const postVid = await client.postMessage(textCh.id, {
    content: 'clip ready',
    attachments: [{ name: upVid.name, mime: upVid.mime, size: upVid.size, data_url: upVid.url }],
  });
  assert.equal(postVid.status, 200);

  const postAud = await client.postMessage(textCh.id, {
    content: '',
    attachments: [{ name: upAud.name, mime: upAud.mime, size: upAud.size, data_url: upAud.url }],
  });
  assert.equal(postAud.status, 200);

  const galMedia = await client.request('GET', `/api/channels/${encodeURIComponent(textCh.id)}/media`, {
    query: { kind: 'media' },
  });
  assert.equal(galMedia.status, 200);
  assert.equal(galMedia.data.length, 1);
  assert.equal(galMedia.data[0].attachment.mime, 'video/mp4');

  const galAudio = await client.request('GET', `/api/channels/${encodeURIComponent(textCh.id)}/media`, {
    query: { kind: 'audio' },
  });
  assert.equal(galAudio.status, 200);
  assert.equal(galAudio.data.length, 1);
  assert.equal(galAudio.data[0].attachment.mime, 'audio/webm');
});

test('Phase 3: Categories, channel visibility, read-only, slowmode 429, and threads', async (t) => {
  if (checkSkip(t, online)) return;
  const owner = await registerUser('p3own');
  const member = await registerUser('p3mem');
  const ownApi = new ApiClient(TARGET_URL, owner.token);
  const memApi = new ApiClient(TARGET_URL, member.token);

  const srv = (await ownApi.createServer('Phase3 Lab')).data;
  assert.equal((await memApi.joinServer(srv.id)).status, 200);

  // Create categorized channel and configure permissions
  const chRes = await ownApi.createChannel(srv.id, {
    name: 'announcements',
    kind: 'text',
    topic: 'news',
    category: 'Updates',
  });
  assert.equal(chRes.status, 200);
  const chId = chRes.data.id;
  assert.equal(chRes.data.category, 'Updates');

  // Set admin-only hidden room
  const hideRes = await ownApi.request('PATCH', `/api/channels/${encodeURIComponent(chId)}`, {
    body: { visibility: 'admin', read_only: true },
  });
  assert.equal(hideRes.status, 200);
  assert.equal(hideRes.data.visibility, 'admin');
  assert.equal(hideRes.data.read_only, true);

  // Regular member cannot see it in bootstrap or access messages
  const memBoot = await memApi.bootstrap();
  const memSrv = memBoot.data.servers.find((s) => s.id === srv.id);
  assert.ok(!memSrv.channels.some((c) => c.id === chId));
  assert.equal((await memApi.getMessages(chId)).status, 403);

  // Reveal as read-only public channel -> member can read, cannot post
  const pubRes = await ownApi.request('PATCH', `/api/channels/${encodeURIComponent(chId)}`, {
    body: { visibility: 'public', read_only: true },
  });
  assert.equal(pubRes.status, 200);
  assert.equal((await memApi.getMessages(chId)).status, 200);
  assert.equal((await memApi.postMessage(chId, 'try post')).status, 403);

  // Owner can still post in read-only channel
  const ownMsg = await ownApi.postMessage(chId, 'official post');
  assert.equal(ownMsg.status, 200);

  // Enable slowmode and verify 429 on rapid second post by member
  assert.equal((await ownApi.request('PATCH', `/api/channels/${encodeURIComponent(chId)}`, {
    body: { read_only: false, slowmode_seconds: 10 },
  })).status, 200);
  assert.equal((await memApi.postMessage(chId, 'first')).status, 200);
  assert.equal((await memApi.postMessage(chId, 'too fast')).status, 429);

  // Threads: create anchored thread on ownMsg, prevent duplicate, reply inside thread
  const thRes = await memApi.request('POST', `/api/channels/${encodeURIComponent(chId)}/threads`, {
    body: { title: 'Followup', parent_message_id: ownMsg.data.id, content: 'thread start' },
  });
  assert.equal(thRes.status, 200);
  const threadId = thRes.data.id;
  assert.equal(thRes.data.message_count, 1);

  const dupTh = await ownApi.request('POST', `/api/channels/${encodeURIComponent(chId)}/threads`, {
    body: { title: 'Dup', parent_message_id: ownMsg.data.id },
  });
  assert.equal(dupTh.status, 409);

  assert.equal((await ownApi.request('POST', `/api/threads/${encodeURIComponent(threadId)}/messages`, {
    body: { content: 'second reply', attachments: [] },
  })).status, 200);

  const thMsgs = await memApi.request('GET', `/api/threads/${encodeURIComponent(threadId)}/messages`);
  assert.equal(thMsgs.status, 200);
  assert.equal(thMsgs.data.length, 2);

  const refreshed = await ownApi.getMessages(chId);
  const parentView = refreshed.data.find((m) => m.id === ownMsg.data.id);
  assert.equal(parentView.thread_id, threadId);
  assert.equal(parentView.thread_count, 2);
});

test('Phase 3: Moderation kick, ban/unban, invite block, timeout enforcement, and audit log', async (t) => {
  if (checkSkip(t, online)) return;
  const owner = await registerUser('mown');
  const member = await registerUser('mmem');
  const ownApi = new ApiClient(TARGET_URL, owner.token);
  const memApi = new ApiClient(TARGET_URL, member.token);

  const srv = (await ownApi.createServer('Moderation Lab')).data;
  const ch = srv.channels.find((c) => c.kind === 'text');
  assert.equal((await memApi.joinServer(srv.id)).status, 200);

  // Create invite link for testing post-ban block
  const invRes = await ownApi.request('POST', `/api/servers/${encodeURIComponent(srv.id)}/invites`, { body: {} });
  assert.equal(invRes.status, 200);
  const inviteCode = invRes.data.code;

  // Timeout member -> 403 on post_message -> clear -> 200
  const toRes = await ownApi.request('POST', `/api/servers/${encodeURIComponent(srv.id)}/members/${encodeURIComponent(member.user.id)}/timeout`, {
    body: { minutes: 5 },
  });
  assert.equal(toRes.status, 200);
  assert.ok(toRes.data.timeout_until);
  assert.equal((await memApi.postMessage(ch.id, 'muted msg')).status, 403);

  assert.equal((await ownApi.request('POST', `/api/servers/${encodeURIComponent(srv.id)}/members/${encodeURIComponent(member.user.id)}/timeout`, {
    body: { minutes: 0 },
  })).status, 200);
  assert.equal((await memApi.postMessage(ch.id, 'unmuted msg')).status, 200);

  // Kick -> member gone -> can rejoin
  assert.equal((await ownApi.request('POST', `/api/servers/${encodeURIComponent(srv.id)}/members/${encodeURIComponent(member.user.id)}/kick`)).status, 204);
  assert.equal((await memApi.postMessage(ch.id, 'after kick')).status, 403);
  assert.equal((await memApi.joinServer(srv.id)).status, 200);

  // Ban -> removed and blocked on both /join and /invites/{code}/join -> listed in /bans -> unban -> can rejoin
  assert.equal((await ownApi.request('POST', `/api/servers/${encodeURIComponent(srv.id)}/members/${encodeURIComponent(member.user.id)}/ban`, {
    body: { reason: 'spamming' },
  })).status, 200);
  assert.equal((await memApi.joinServer(srv.id)).status, 403);
  assert.equal((await memApi.request('POST', `/api/invites/${encodeURIComponent(inviteCode)}/join`)).status, 403);

  const bans = await ownApi.request('GET', `/api/servers/${encodeURIComponent(srv.id)}/bans`);
  assert.equal(bans.status, 200);
  assert.equal(bans.data.length, 1);
  assert.equal(bans.data[0].reason, 'spamming');

  assert.equal((await ownApi.request('DELETE', `/api/servers/${encodeURIComponent(srv.id)}/bans/${encodeURIComponent(member.user.id)}`)).status, 204);
  assert.equal((await memApi.joinServer(srv.id)).status, 200);

  // Non-admin cannot view audit logs
  assert.equal((await memApi.request('GET', `/api/servers/${encodeURIComponent(srv.id)}/audit`)).status, 403);
  const audit = await ownApi.request('GET', `/api/servers/${encodeURIComponent(srv.id)}/audit`);
  assert.equal(audit.status, 200);
  const actions = audit.data.map((e) => e.action);
  for (const expected of ['member_timeout', 'member_timeout_clear', 'member_kick', 'member_ban', 'member_unban']) {
    assert.ok(actions.includes(expected), `expected audit action ${expected}`);
  }
});

/**
 * Tier 1 Feature Tests: Server Templates, Server Settings & Member Role Management
 * Covers starter templates, role customization, permission enforcement, and WS sync.
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

describe('Tier 1: Server Templates, Settings & Role Management', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('9.1: creates server from team/community/study templates with starter channels and role labels', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const reg = await client.register(randomUsername('tpl_own'), randomPassword(12));
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const teamRes = await client.createServer({
      name: 'Engineering Team',
      icon: 'ENG',
      template: 'team',
      description: 'Core engineering workspace',
      accent_color: '#10b981',
      roles_config: {
        admin_label: 'Tech Lead',
        member_label: 'Developer',
        allow_member_create_channel: false,
      },
    }, token);
    assert.equal(teamRes.status, 200, `Team create failed: ${teamRes.text}`);
    assert.equal(teamRes.data.accent_color, '#10b981');
    assert.equal(teamRes.data.description, 'Core engineering workspace');
    assert.equal(teamRes.data.roles_config.admin_label, 'Tech Lead');
    assert.equal(teamRes.data.roles_config.member_label, 'Developer');
    assert.equal(teamRes.data.roles_config.allow_member_create_channel, false);
    assert.ok(teamRes.data.channels.some((c) => c.name === 'announcements'));
    assert.ok(teamRes.data.channels.some((c) => c.name === 'tasks'));
    assert.ok(teamRes.data.channels.some((c) => c.kind === 'voice'));
    assert.equal(teamRes.data.member_roles[reg.data.user.id], 'owner');

    const studyRes = await client.createServer({ name: 'Math Study', template: 'study' }, token);
    assert.equal(studyRes.status, 200);
    assert.ok(studyRes.data.channels.some((c) => c.name === 'q-and-a'));
    assert.equal(studyRes.data.roles_config.admin_label, 'ติวเตอร์');
  });

  it('9.2: rejects unknown server template or invalid role/accent hex color with HTTP 400', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const reg = await client.register(randomUsername('tpl_bad'), randomPassword(12));
    assert.equal(reg.status, 200);

    const badTpl = await client.createServer({ name: 'Bad Tpl', template: 'nonexistent' }, reg.data.token);
    assert.equal(badTpl.status, 400);

    const badColor = await client.createServer({ name: 'Bad Col', accent_color: 'red' }, reg.data.token);
    assert.equal(badColor.status, 400);
  });

  it('9.3: updates server settings and enforces allow_member_create_channel permission', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const owner = await client.register(randomUsername('srv_cfg_own'), pass);
    const member = await client.register(randomUsername('srv_cfg_mem'), pass);
    assert.equal(owner.status, 200);
    assert.equal(member.status, 200);

    const srv = await client.createServer({ name: 'Config Guild', template: 'community' }, owner.data.token);
    assert.equal(srv.status, 200);
    const sid = srv.data.id;

    await client.joinServer(sid, member.data.token);

    // Member cannot edit server settings
    const memEdit = await client.request('PATCH', `/api/servers/${sid}`, {
      token: member.data.token,
      body: { name: 'Hacked Name' },
    });
    assert.equal(memEdit.status, 403);

    // Owner updates metadata and disables member channel creation
    const patchRes = await client.request('PATCH', `/api/servers/${sid}`, {
      token: owner.data.token,
      body: {
        name: 'Locked Community',
        description: 'Strict channel control',
        accent_color: '#f59e0b',
        roles_config: {
          admin_label: 'Moderator',
          member_label: 'Guest',
          allow_member_create_channel: false,
        },
      },
    });
    assert.equal(patchRes.status, 200, `PATCH server failed: ${patchRes.text}`);
    assert.equal(patchRes.data.name, 'Locked Community');
    assert.equal(patchRes.data.roles_config.allow_member_create_channel, false);

    // Regular member is now blocked from creating channels
    const blockedChan = await client.createChannel(sid, { name: 'mem-chan', kind: 'text' }, member.data.token);
    assert.equal(blockedChan.status, 403);
  });

  it('9.4: promotes member to admin, enables management permissions, and broadcasts WS updates', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(12);
    const owner = await client.register(randomUsername('role_own'), pass);
    const member = await client.register(randomUsername('role_mem'), pass);
    assert.equal(owner.status, 200);
    assert.equal(member.status, 200);

    const srv = await client.createServer({
      name: 'Role Ops',
      roles_config: { allow_member_create_channel: false },
    }, owner.data.token);
    const sid = srv.data.id;
    await client.joinServer(sid, member.data.token);

    const wsMem = await connectWs(member.data.token, { baseUrl: TARGET_URL });
    try {
      await wsMem.waitForMessage((m) => m.type === 'ready');

      // Member cannot promote themselves
      const selfPromote = await client.request('PATCH', `/api/servers/${sid}/members/${member.data.user.id}/role`, {
        token: member.data.token,
        body: { role: 'admin' },
      });
      assert.equal(selfPromote.status, 403);

      // Owner promotes member to admin
      const promoteRes = await client.request('PATCH', `/api/servers/${sid}/members/${member.data.user.id}/role`, {
        token: owner.data.token,
        body: { role: 'admin' },
      });
      assert.equal(promoteRes.status, 200, `Promote failed: ${promoteRes.text}`);
      assert.equal(promoteRes.data.role, 'admin');
      assert.equal(promoteRes.data.server.member_roles[member.data.user.id], 'admin');

      const wsEvent = await wsMem.waitForMessage(
        (m) => m.type === 'member_role_update' && m.server_id === sid && m.user_id === member.data.user.id,
        6000
      );
      assert.equal(wsEvent.role, 'admin');

      // Promoted admin can now create and delete a channel even with allow_member_create_channel=false
      const chRes = await client.createChannel(sid, { name: 'admin-room', kind: 'text' }, member.data.token);
      assert.equal(chRes.status, 200);
      const delRes = await client.deleteChannel(chRes.data.id, member.data.token);
      assert.equal(delRes.status, 200);

      // Owner demotes back to member
      const demoteRes = await client.request('PATCH', `/api/servers/${sid}/members/${member.data.user.id}/role`, {
        token: owner.data.token,
        body: { role: 'member' },
      });
      assert.equal(demoteRes.status, 200);
      assert.equal(demoteRes.data.role, 'member');

      const blockedAgain = await client.createChannel(sid, { name: 'should-fail', kind: 'text' }, member.data.token);
      assert.equal(blockedAgain.status, 403);
    } finally {
      wsMem.close();
    }
  });
});

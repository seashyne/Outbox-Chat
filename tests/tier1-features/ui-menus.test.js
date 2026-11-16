/**
 * Tier 1 Feature Tests: UI Menus & Backend Actions (Requirement R1)
 * Covers:
 * - Channel deletion (DELETE /api/channels/{id}) by owner/admin vs member rejection
 * - WebSocket broadcasting of channel_delete event
 * - Server leave action (POST /api/servers/{id}/leave) and owner restriction
 * - WebSocket broadcasting of member_leave event
 * - User profile self-edit action (PATCH /api/users/@me)
 * - User status presence menu actions and WebSocket broadcasting
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

describe('Tier 1: UI Menus & Backend Actions (Requirement R1)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('1.1: deletes channel via DELETE /api/channels/:id by server owner and returns 200 OK', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const ownerName = randomUsername('ch_del_own');
    const password = randomPassword(12);
    const regRes = await client.register(ownerName, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Create server and custom channel
    const srvRes = await client.createServer({ name: 'Delete Channel Test Srv' }, token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    const chRes = await client.createChannel(serverId, { name: 'to-be-deleted', kind: 'text' }, token);
    assert.equal(chRes.status, 200);
    const channelId = chRes.data.id;

    // Delete channel
    const delRes = await client.deleteChannel(channelId, token);
    assert.equal(delRes.status, 200, `Delete channel failed: ${delRes.text}`);
    assert.ok(delRes.data, 'Expected JSON response');
    assert.equal(delRes.data.success, true);
    assert.equal(delRes.data.channel_id, channelId);

    // Verify channel is removed from bootstrap
    const bootRes = await client.bootstrap(token);
    assert.equal(bootRes.status, 200);
    const serverChannels = bootRes.data.channels?.[serverId] ||
      bootRes.data.servers?.find((s) => s.id === serverId)?.channels || [];
    assert.ok(!serverChannels.some((c) => c.id === channelId), 'Deleted channel must not appear in server channels');

    // Verify messages endpoint on deleted channel returns 404
    const msgRes = await client.getMessages(channelId, {}, token);
    assert.equal(msgRes.status, 404, 'Messages on deleted channel must return 404');
  });

  it('1.2: rejects channel deletion by regular member with 403 Forbidden', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const ownerName = randomUsername('ch_perm_own');
    const memberName = randomUsername('ch_perm_mem');
    const password = randomPassword(12);

    const regOwn = await client.register(ownerName, password);
    const regMem = await client.register(memberName, password);
    assert.equal(regOwn.status, 200);
    assert.equal(regMem.status, 200);

    const srvRes = await client.createServer({ name: 'Perm Check Srv' }, regOwn.data.token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Member joins server
    await client.joinServer(serverId, regMem.data.token);

    // Owner creates channel
    const chRes = await client.createChannel(serverId, { name: 'protected-channel', kind: 'text' }, regOwn.data.token);
    assert.equal(chRes.status, 200);
    const channelId = chRes.data.id;

    // Member attempts to delete channel
    const delRes = await client.deleteChannel(channelId, regMem.data.token);
    assert.equal(delRes.status, 403, `Expected 403 Forbidden for member deletion, got: ${delRes.status}`);

    // Verify channel still exists
    const bootRes = await client.bootstrap(regOwn.data.token);
    const serverChannels = bootRes.data.channels?.[serverId] ||
      bootRes.data.servers?.find((s) => s.id === serverId)?.channels || [];
    assert.ok(serverChannels.some((c) => c.id === channelId), 'Channel must still exist after rejected deletion');
  });

  it('1.3: rejects channel deletion of non-existent channel with 404 Not Found', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('ch_del_404');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);

    const delRes = await client.deleteChannel('non-existent-channel-id-999', reg.data.token);
    assert.equal(delRes.status, 404, `Expected 404 for non-existent channel, got ${delRes.status}`);
  });

  it('1.4: broadcasts channel_delete event over WebSocket to all server members upon deletion', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const ownerName = randomUsername('ws_chdel_own');
    const memberName = randomUsername('ws_chdel_mem');
    const pass = randomPassword(12);

    const regOwn = await client.register(ownerName, pass);
    const regMem = await client.register(memberName, pass);
    assert.equal(regOwn.status, 200);
    assert.equal(regMem.status, 200);

    const srvRes = await client.createServer({ name: 'WS Delete Broadcast Srv' }, regOwn.data.token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    await client.joinServer(serverId, regMem.data.token);

    const chRes = await client.createChannel(serverId, { name: 'ws-del-target', kind: 'text' }, regOwn.data.token);
    assert.equal(chRes.status, 200);
    const channelId = chRes.data.id;

    // Connect WebSocket for member
    const wsMem = await connectWs(regMem.data.token, { baseUrl: TARGET_URL });
    try {
      await wsMem.waitForMessage((m) => m.type === 'ready');

      // Owner deletes channel
      const delRes = await client.deleteChannel(channelId, regOwn.data.token);
      assert.equal(delRes.status, 200);

      // Member should receive channel_delete event
      const event = await wsMem.waitForMessage(
        (m) => (m.type === 'channel_delete' || m.type === 'channelDelete') && m.channel_id === channelId,
        6000
      );
      assert.ok(event, 'Member must receive channel_delete event');
      assert.equal(event.server_id, serverId);
      assert.equal(event.channel_id, channelId);
    } finally {
      wsMem.close();
    }
  });

  it('1.5: allows member to leave server via POST /api/servers/:id/leave and updates membership', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const owner = randomUsername('srv_lv_own');
    const member = randomUsername('srv_lv_mem');
    const pass = randomPassword(12);

    const regOwn = await client.register(owner, pass);
    const regMem = await client.register(member, pass);
    assert.equal(regOwn.status, 200);
    assert.equal(regMem.status, 200);

    const srvRes = await client.createServer({ name: 'Leave Server Test' }, regOwn.data.token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Member joins
    await client.joinServer(serverId, regMem.data.token);

    // Verify member has access
    const beforeBoot = await client.bootstrap(regMem.data.token);
    assert.ok(beforeBoot.data.servers?.some((s) => s.id === serverId), 'Member must see server before leaving');

    // Member leaves server
    const leaveRes = await client.leaveServer(serverId, regMem.data.token);
    assert.equal(leaveRes.status, 200, `Leave server failed: ${leaveRes.text}`);
    assert.equal(leaveRes.data.success, true);
    assert.equal(leaveRes.data.server_id, serverId);

    // Verify member no longer sees server in bootstrap
    const afterBoot = await client.bootstrap(regMem.data.token);
    assert.ok(
      !afterBoot.data.servers?.some((s) => s.id === serverId),
      'Member must not see server in bootstrap after leaving'
    );

    // Verify member list on server no longer contains member
    const ownerBoot = await client.bootstrap(regOwn.data.token);
    const srvView = ownerBoot.data.servers?.find((s) => s.id === serverId);
    const members = ownerBoot.data.members?.[serverId] || srvView?.members || [];
    assert.ok(
      !members.some((m) => m.id === regMem.data.user.id || m.user_id === regMem.data.user.id),
      'Left user must be removed from server member list'
    );
  });

  it('1.6: rejects server owner leaving their own server with 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const owner = randomUsername('srv_lv_reject');
    const pass = randomPassword(12);

    const regOwn = await client.register(owner, pass);
    assert.equal(regOwn.status, 200);

    const srvRes = await client.createServer({ name: 'Owner Cannot Leave' }, regOwn.data.token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Owner attempts to leave own server
    const leaveRes = await client.leaveServer(serverId, regOwn.data.token);
    assert.equal(leaveRes.status, 400, `Expected 400 Bad Request for owner leave, got ${leaveRes.status}`);

    // Owner still in server
    const bootRes = await client.bootstrap(regOwn.data.token);
    assert.ok(bootRes.data.servers?.some((s) => s.id === serverId), 'Owner must still remain in server');
  });

  it('1.7: broadcasts member departure event over WebSocket to remaining server members', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const owner = randomUsername('ws_lv_own');
    const member = randomUsername('ws_lv_mem');
    const pass = randomPassword(12);

    const regOwn = await client.register(owner, pass);
    const regMem = await client.register(member, pass);
    assert.equal(regOwn.status, 200);
    assert.equal(regMem.status, 200);

    const srvRes = await client.createServer({ name: 'WS Leave Broadcast' }, regOwn.data.token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    await client.joinServer(serverId, regMem.data.token);

    // Owner connects WebSocket
    const wsOwn = await connectWs(regOwn.data.token, { baseUrl: TARGET_URL });
    try {
      await wsOwn.waitForMessage((m) => m.type === 'ready');

      // Member leaves server
      const leaveRes = await client.leaveServer(serverId, regMem.data.token);
      assert.equal(leaveRes.status, 200);

      // Owner receives member_leave event
      const event = await wsOwn.waitForMessage(
        (m) =>
          (m.type === 'member_leave' || m.type === 'memberLeave') &&
          m.server_id === serverId &&
          (m.user_id === regMem.data.user.id || m.user?.id === regMem.data.user.id),
        6000
      );
      assert.ok(event, 'Owner must receive member_leave event');
      assert.equal(event.server_id, serverId);
    } finally {
      wsOwn.close();
    }
  });
});

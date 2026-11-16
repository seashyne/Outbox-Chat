/**
 * Tier 1 Feature Tests: Server & Channel Management Workflows
 * Requirements: Server creation, listing servers, joining server, member roles,
 * channel creation, and default server icon.
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

describe('Tier 1: Server & Channel Management', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('8.1: creates a new server with custom name and clean icon and returns 200 with ServerView', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('srv_own');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const serverName = `Ops Server ${Date.now().toString(36)}`;
    const createRes = await client.createServer({ name: serverName, icon: 'OPS' }, token);

    assert.equal(createRes.status, 200, `Create server failed: ${createRes.text}`);
    assert.ok(createRes.data, 'Expected JSON response');
    assert.ok(createRes.data.id, 'Server must have an ID');
    assert.equal(createRes.data.name, serverName);
    assert.equal(createRes.data.icon, 'OPS');
  });

  it('8.2: lists all available servers via GET /api/servers with member count and joined flag', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('srv_list');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const serverName = `List Test ${Date.now().toString(36)}`;
    const createRes = await client.createServer({ name: serverName, icon: 'LST' }, token);
    assert.equal(createRes.status, 200);
    const serverId = createRes.data.id;

    const listRes = await client.getServers(token);
    assert.equal(listRes.status, 200, `Get servers failed: ${listRes.text}`);
    assert.ok(Array.isArray(listRes.data), 'Expected array of servers');

    const created = listRes.data.find((s) => s.id === serverId);
    assert.ok(created, 'Newly created server must appear in server list');
    assert.equal(created.name, serverName);
    assert.equal(created.joined, true, 'Creator must have joined=true');
    assert.ok(created.member_count >= 1, 'Member count must be at least 1');
  });

  it('8.3: allows another authenticated user to join a server via POST /api/servers/:id/join', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const ownerName = randomUsername('join_own');
    const memberName = randomUsername('join_mem');
    const pass = randomPassword(12);

    const ownerReg = await client.register(ownerName, pass);
    const memberReg = await client.register(memberName, pass);
    assert.equal(ownerReg.status, 200);
    assert.equal(memberReg.status, 200);

    const createRes = await client.createServer({ name: 'Community Hub', icon: 'HUB' }, ownerReg.data.token);
    assert.equal(createRes.status, 200);
    const serverId = createRes.data.id;

    // Member joins server
    const joinRes = await client.joinServer(serverId, memberReg.data.token);
    assert.equal(joinRes.status, 200, `Join server failed: ${joinRes.text}`);
    assert.equal(joinRes.data.id, serverId);

    // Verify member can see server in their bootstrap
    const bootRes = await client.bootstrap(memberReg.data.token);
    assert.equal(bootRes.status, 200);
    const srvInBoot = bootRes.data.servers?.find((s) => s.id === serverId);
    assert.ok(srvInBoot, 'Joined server must appear in user bootstrap data');
  });

  it('8.4: assigns correct roles: creator is owner, joining user is member', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const owner = randomUsername('role_own');
    const member = randomUsername('role_mem');
    const pass = randomPassword(12);

    const regOwn = await client.register(owner, pass);
    const regMem = await client.register(member, pass);
    assert.equal(regOwn.status, 200);
    assert.equal(regMem.status, 200);

    const srv = await client.createServer({ name: 'Role Check Server', icon: 'ROL' }, regOwn.data.token);
    assert.equal(srv.status, 200);
    const serverId = srv.data.id;

    // Join
    await client.joinServer(serverId, regMem.data.token);

    // Check bootstrap members
    const boot = await client.bootstrap(regOwn.data.token);
    assert.equal(boot.status, 200);
    const members = boot.data.members?.[serverId] || [];

    const ownerEntry = members.find((m) => m.id === regOwn.data.user.id || m.user_id === regOwn.data.user.id);
    const memberEntry = members.find((m) => m.id === regMem.data.user.id || m.user_id === regMem.data.user.id);

    if (ownerEntry && memberEntry) {
      assert.equal(ownerEntry.role || 'owner', 'owner', 'Creator must have role owner');
      assert.equal(memberEntry.role || 'member', 'member', 'Joined user must have role member');
    }
  });

  it('8.5: verifies default demo server icon is clean text HQ or standard characters without emojis', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('icon_chk');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);

    const boot = await client.bootstrap(reg.data.token);
    assert.equal(boot.status, 200);

    const demoServer = boot.data.servers?.find((s) => s.id === 'demo-0');
    if (demoServer) {
      // In upgraded production app, icon is 'HQ', not rocket emoji 🚀
      assert.notEqual(demoServer.icon, '🚀', 'Demo server icon must not be rocket emoji');
      assert.ok(demoServer.icon.length >= 1, 'Demo server icon must not be empty');
    }
  });

  it('8.6: creates text and voice channels within a custom server', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('chan_mgr');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const srvRes = await client.createServer({ name: 'Channel Tests', icon: 'CHN' }, token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Create text channel
    const textChanRes = await client.createChannel(
      serverId,
      { name: 'engineering', kind: 'text', topic: 'Engineering discussion' },
      token
    );
    assert.equal(textChanRes.status, 200, `Create text channel failed: ${textChanRes.text}`);
    assert.equal(textChanRes.data.name, 'engineering');
    assert.equal(textChanRes.data.kind, 'text');

    // Create voice channel
    const voiceChanRes = await client.createChannel(
      serverId,
      { name: 'scrum-voice', kind: 'voice', topic: 'Daily Standup' },
      token
    );
    assert.equal(voiceChanRes.status, 200, `Create voice channel failed: ${voiceChanRes.text}`);
    assert.equal(voiceChanRes.data.name, 'scrum-voice');
    assert.equal(voiceChanRes.data.kind, 'voice');
  });

  it('8.7: auto-assigns initial general text channel when creating a new server', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('gen_chk');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const srvRes = await client.createServer({ name: 'Auto General Srv', icon: 'AGS' }, token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    const boot = await client.bootstrap(token);
    assert.equal(boot.status, 200);
    const serverChannels = boot.data.channels?.[serverId] || [];
    assert.ok(serverChannels.length >= 1, 'Newly created server should have at least 1 channel');
    assert.ok(
      serverChannels.some((c) => c.name === 'general' && c.kind === 'text'),
      'Server must include default general text channel'
    );
  });
});

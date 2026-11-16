/**
 * Tier 4 Scenario Tests: Seed Bot Protection & Interaction Safety
 * Requirement: Feature 8 Seed Bot Protection & System Integrity
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

describe('Tier 4: Bot Protection & Interaction Scenarios', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('S2.1: seed bot credential hardening: denies login attempts with common and generated passwords', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const commonPasswords = [
      '',
      'password',
      'outbox',
      'outbox-bot',
      'admin',
      '12345678',
      'root',
      'toor',
      'Password123!',
      randomPassword(20),
    ];

    for (const pass of commonPasswords) {
      const res = await client.login('outbox-bot', pass);
      assert.ok(
        res.status === 401 || res.status === 400,
        `Bot login with pass "${pass}" should be rejected, got status ${res.status}`
      );
    }
  });

  it('S2.2: registration hijack prevention: rejects registering outbox-bot under any casing', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const botVariations = [
      'outbox-bot',
      'Outbox-Bot',
      'OUTBOX-BOT',
      'outbox-BOT',
      'Outbox-bot',
    ];

    const pass = randomPassword(16);

    for (const username of botVariations) {
      const res = await client.register(username, pass);
      assert.equal(
        res.status,
        409,
        `Expected 409 Conflict when attempting to register as bot "${username}", got ${res.status}`
      );
      assert.match(res.data?.error || '', /already taken/i);
    }
  });

  it('S2.3: verifies regular members cannot delete seed bot messages in demo-0', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('reg_user_bot');
    const pass = randomPassword(14);

    const reg = await client.register(username, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Fetch messages from demo-0
    const listRes = await client.getMessages('demo-0', { limit: 10 }, token);
    assert.equal(listRes.status, 200);

    // Find a message authored by outbox-bot
    const botMsg = listRes.data.find((m) => m.author.id === 'outbox-bot' || m.author.username === 'outbox-bot');
    if (botMsg) {
      // Regular user attempts to delete bot message
      const delRes = await client.deleteMessage(botMsg.id, token);
      assert.equal(
        delRes.status,
        403,
        `Regular member must not be permitted to delete seed bot message: got ${delRes.status}`
      );
    }
  });

  it('S2.4: verifies seed bot is properly marked as bot: true and present in demo server', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('bot_observer');
    const pass = randomPassword(14);

    const reg = await client.register(username, pass);
    const token = reg.data.token;

    const boot = await client.bootstrap(token);
    assert.equal(boot.status, 200);

    const demoServer = boot.data.servers.find((s) => s.id === 'demo');
    assert.ok(demoServer, 'Demo server must exist');

    const botMember = demoServer.members.find((m) => m.id === 'outbox-bot' || m.username === 'outbox-bot');
    assert.ok(botMember, 'outbox-bot must be in demo server member list');
    assert.equal(botMember.bot, true, 'outbox-bot must have bot: true');
  });
});

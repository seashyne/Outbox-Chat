/**
 * Tier 1 Feature Tests: User Profile & Status Menu Actions (Requirement R1)
 * Covers:
 * - User profile self-edit action (PATCH /api/users/@me)
 * - Invalid display_name validation (empty, whitespace, > 32 chars)
 * - User status presence menu actions and WebSocket persistence
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

describe('Tier 1: User Profile & Status Menu Actions (Requirement R1)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('1.8: updates user profile via PATCH /api/users/@me (display_name and avatar color)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('prof_edit');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const newDisplayName = 'Sir Chat-a-Lot';
    const newColor = '#faa61a';

    const patchRes = await client.patchMe({ display_name: newDisplayName, color: newColor }, token);
    assert.equal(patchRes.status, 200, `Patch profile failed: ${patchRes.text}`);
    assert.ok(patchRes.data?.user, 'Expected user object in patch response');
    assert.equal(patchRes.data.user.display_name, newDisplayName);
    assert.equal(patchRes.data.user.color, newColor);
    assert.equal(patchRes.data.user.username, user, 'Username must remain unchanged');

    const bootRes = await client.bootstrap(token);
    assert.equal(bootRes.status, 200);
    assert.equal(bootRes.data.me.display_name, newDisplayName);
    assert.equal(bootRes.data.me.color, newColor);

    const msgRes = await client.postMessage('demo-0', { content: 'Profile updated test message' }, token);
    assert.equal(msgRes.status, 200);
    assert.equal(msgRes.data.author.display_name, newDisplayName);
    assert.equal(msgRes.data.author.color, newColor);
  });

  it('1.9: rejects invalid display_name (empty or > 32 chars) with 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('prof_invalid');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const emptyRes = await client.patchMe({ display_name: '' }, token);
    assert.equal(emptyRes.status, 400, 'Empty display name must return 400');

    const wsRes = await client.patchMe({ display_name: '    ' }, token);
    assert.equal(wsRes.status, 400, 'Whitespace display name must return 400');

    const longRes = await client.patchMe({ display_name: 'A'.repeat(33) }, token);
    assert.equal(longRes.status, 400, 'Display name > 32 chars must return 400');
  });

  it('1.10: updates user presence status menu action and syncs across WebSocket connections', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('status_sync');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const ws = await connectWs(token, { baseUrl: TARGET_URL });
    try {
      await ws.waitForMessage((m) => m.type === 'ready');

      const patchRes = await client.patchSettings({ status: 'dnd' }, token);
      assert.equal(patchRes.status, 200, `Patch status failed: ${patchRes.text}`);
      assert.equal(patchRes.data.settings?.status, 'dnd');

      const bootRes = await client.bootstrap(token);
      assert.equal(bootRes.status, 200);
      assert.equal(bootRes.data.settings?.status, 'dnd');
    } finally {
      ws.close();
    }
  });

  it('1.11: uploads, validates, broadcasts, and clears real profile picture (avatar_url)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const user = randomUsername('prof_pic');
    const pass = randomPassword(12);
    const reg = await client.register(user, pass);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const ws = await connectWs(token, { baseUrl: TARGET_URL });
    try {
      await ws.waitForMessage((m) => m.type === 'ready');

      const badRes = await client.patchMe({ avatar_url: 'javascript:alert(1)' }, token);
      assert.equal(badRes.status, 400);

      const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';
      const setRes = await client.patchMe({ avatar_url: samplePng }, token);
      assert.equal(setRes.status, 200);
      assert.equal(setRes.data.user.avatar_url, samplePng);

      const wsEv = await ws.waitForMessage((m) => m.type === 'user_update' && m.user?.id === reg.data.user.id);
      assert.equal(wsEv.user.avatar_url, samplePng);

      const bootRes = await client.bootstrap(token);
      assert.equal(bootRes.data.me.avatar_url, samplePng);

      const clearRes = await client.patchMe({ avatar_url: '' }, token);
      assert.equal(clearRes.status, 200);
      assert.equal(clearRes.data.user.avatar_url, null);
    } finally {
      ws.close();
    }
  });
});

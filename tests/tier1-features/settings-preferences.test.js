/**
 * Tier 1 Feature Tests: Settings System & User Preferences (Requirement R2)
 * Covers:
 * - GET /api/users/@me/settings: initial default settings
 * - PATCH /api/users/@me/settings: updating theme presets (dark, light, slate, forest, etc.)
 * - PATCH /api/users/@me/settings: updating custom color palette (brand, sidebar, chat)
 * - PATCH /api/users/@me/settings: updating status (online, idle, dnd, invisible)
 * - PATCH /api/users/@me: display name & avatar color profile updates
 * - GET /api/bootstrap: verifying settings, channels map, and members map in top-level payload
 * - Cross-session settings persistence across full logout and re-login
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

describe('Tier 1: Settings System & User Preferences (Requirement R2)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('2.1: returns default user settings upon initial user registration via GET /api/users/@me/settings', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_def');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    const res = await client.getSettings(token);
    assert.equal(res.status, 200, `Get settings failed: ${res.text}`);
    assert.ok(res.data, 'Expected JSON body');
    assert.ok(res.data.settings, 'Response must contain settings object');

    const s = res.data.settings;
    assert.equal(s.theme, 'dark', 'Default theme must be dark');
    assert.equal(s.status, 'online', 'Default status must be online');
    assert.ok(typeof s.custom_colors === 'object' && s.custom_colors !== null, 'custom_colors must be an object');
  });

  it('2.2: updates theme preference via PATCH /api/users/@me/settings and verifies immediate retrieval', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_thm');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Switch theme to slate
    const patchRes = await client.patchSettings({ theme: 'slate' }, token);
    assert.equal(patchRes.status, 200, `Patch theme failed: ${patchRes.text}`);
    assert.equal(patchRes.data.settings?.theme, 'slate');

    // Retrieve settings
    const getRes = await client.getSettings(token);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.settings?.theme, 'slate');
    assert.equal(getRes.data.settings?.status, 'online', 'Status must remain preserved');
  });

  it('2.3: updates custom color palette in settings (brand, sidebar, chat) and preserves existing preferences', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_pal');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    const customColors = {
      brand: '#1abc9c',
      sidebar: '#161b22',
      chat: '#0d1117',
    };

    const patchRes = await client.patchSettings({ theme: 'custom', custom_colors: customColors }, token);
    assert.equal(patchRes.status, 200, `Patch colors failed: ${patchRes.text}`);
    assert.equal(patchRes.data.settings?.theme, 'custom');
    assert.deepEqual(patchRes.data.settings?.custom_colors, customColors);

    // Verify via GET
    const getRes = await client.getSettings(token);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.settings?.theme, 'custom');
    assert.equal(getRes.data.settings?.custom_colors?.brand, '#1abc9c');
    assert.equal(getRes.data.settings?.custom_colors?.sidebar, '#161b22');
    assert.equal(getRes.data.settings?.custom_colors?.chat, '#0d1117');
  });

  it('2.4: updates user presence status (idle, dnd, invisible) via PATCH /api/users/@me/settings', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_sta');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    for (const status of ['idle', 'dnd', 'invisible', 'online']) {
      const patchRes = await client.patchSettings({ status }, token);
      assert.equal(patchRes.status, 200, `Update status to ${status} failed: ${patchRes.text}`);
      assert.equal(patchRes.data.settings?.status, status);

      const getRes = await client.getSettings(token);
      assert.equal(getRes.data.settings?.status, status);
    }
  });

  it('2.5: updates user profile via PATCH /api/users/@me preserving settings and account credentials', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_prof');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Configure initial settings
    await client.patchSettings({ theme: 'midnight', status: 'idle' }, token);

    // Update profile
    const patchRes = await client.patchMe({ display_name: 'Midnight User', color: '#9b59b6' }, token);
    assert.equal(patchRes.status, 200, `Patch profile failed: ${patchRes.text}`);
    assert.equal(patchRes.data.user?.display_name, 'Midnight User');
    assert.equal(patchRes.data.user?.color, '#9b59b6');

    // Never leak password fields
    assert.equal(patchRes.data.user?.password, undefined);
    assert.equal(patchRes.data.user?.password_hash, undefined);
    assert.equal(patchRes.data.user?.password_salt, undefined);

    // Verify settings still intact
    const getRes = await client.getSettings(token);
    assert.equal(getRes.data.settings?.theme, 'midnight');
    assert.equal(getRes.data.settings?.status, 'idle');
  });

  it('2.6: verifies GET /api/bootstrap exposes settings, channels map, and members map in top-level payload', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_boot');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Create server to establish channels and members
    const srvRes = await client.createServer({ name: 'Bootstrap Schema Check' }, token);
    assert.equal(srvRes.status, 200);
    const serverId = srvRes.data.id;

    // Update settings
    await client.patchSettings({ theme: 'amber' }, token);

    const bootRes = await client.bootstrap(token);
    assert.equal(bootRes.status, 200, `Bootstrap failed: ${bootRes.text}`);
    const data = bootRes.data;

    // 1. Settings object in bootstrap
    assert.ok(data.settings, 'Bootstrap must include settings');
    assert.equal(data.settings.theme, 'amber');

    // 2. Top-level channels map for backwards compatibility
    assert.ok(typeof data.channels === 'object' && data.channels !== null, 'Bootstrap must include channels mapping');
    assert.ok(Array.isArray(data.channels[serverId]), 'channels[serverId] must be an array of channels');
    assert.ok(
      data.channels[serverId].some((c) => c.name === 'general'),
      'channels[serverId] must include general channel'
    );

    // 3. Top-level members map
    assert.ok(typeof data.members === 'object' && data.members !== null, 'Bootstrap must include members mapping');
    assert.ok(Array.isArray(data.members[serverId]), 'members[serverId] must be an array of members');
  });

  it('2.7: verifies complete settings persistence across full session logout and re-login', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_persist');
    const password = randomPassword(16);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token1 = regRes.data.token;

    // Customize settings
    const customColors = { brand: '#ff0055', sidebar: '#202020', chat: '#181818' };
    const patchRes = await client.patchSettings(
      { theme: 'custom', custom_colors: customColors, status: 'dnd' },
      token1
    );
    assert.equal(patchRes.status, 200);

    // Logout
    const logoutRes = await client.logout(token1);
    assert.equal(logoutRes.status, 200);

    // Old token invalid
    const invalidCheck = await client.getSettings(token1);
    assert.equal(invalidCheck.status, 401, 'Logged out token must be rejected');

    // Re-login with credentials
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200, `Re-login failed: ${loginRes.text}`);
    const token2 = loginRes.data.token;
    assert.notEqual(token2, token1, 'New session must issue new token');

    // Fetch settings with new token
    const getRes = await client.getSettings(token2);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.settings?.theme, 'custom', 'Theme must persist across re-login');
    assert.equal(getRes.data.settings?.status, 'dnd', 'Status must persist across re-login');
    assert.deepEqual(getRes.data.settings?.custom_colors, customColors, 'Custom colors must persist across re-login');

    // Bootstrap check with new token
    const bootRes = await client.bootstrap(token2);
    assert.equal(bootRes.status, 200);
    assert.equal(bootRes.data.settings?.theme, 'custom');
    assert.equal(bootRes.data.settings?.status, 'dnd');
  });

  it('2.8: rejects unauthenticated access to settings endpoints with 401 Unauthorized', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // GET without token
    const getNoToken = await client.getSettings(null);
    assert.equal(getNoToken.status, 401, 'GET settings without token must return 401');

    // GET with forged token
    const getForged = await client.getSettings('0000000000000000000000000000000000000000000000000000000000000000');
    assert.equal(getForged.status, 401, 'GET settings with invalid token must return 401');

    // PATCH without token
    const patchNoToken = await client.patchSettings({ theme: 'light' }, null);
    assert.equal(patchNoToken.status, 401, 'PATCH settings without token must return 401');
  });

  it('2.9: accepts partial settings updates without overriding omitted fields', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('set_partial');
    const password = randomPassword(14);
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    // Set custom theme and status
    await client.patchSettings({ theme: 'slate', status: 'idle' }, token);

    // Update only status
    const p1 = await client.patchSettings({ status: 'dnd' }, token);
    assert.equal(p1.status, 200);
    assert.equal(p1.data.settings?.status, 'dnd');
    assert.equal(p1.data.settings?.theme, 'slate', 'Theme must remain slate');

    // Update only theme
    const p2 = await client.patchSettings({ theme: 'forest' }, token);
    assert.equal(p2.status, 200);
    assert.equal(p2.data.settings?.theme, 'forest');
    assert.equal(p2.data.settings?.status, 'dnd', 'Status must remain dnd');
  });
});

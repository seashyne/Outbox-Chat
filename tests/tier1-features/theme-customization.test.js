/**
 * Tier 1 Feature Tests: Theme Customization System
 * Requirement R3: Theme Presets, Custom Color Palette Persistence, and Real-time Application
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

describe('Tier 1: Theme Customization System (Requirement R3)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('3.1: returns default theme ("dark") upon initial user registration', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_def');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200, `Registration failed: ${reg.text}`);
    const token = reg.data.token;

    const res = await client.request('GET', '/api/users/@me/settings', { token });
    assert.equal(res.status, 200, `GET settings failed: ${res.text}`);
    assert.ok(res.data?.settings, 'Response must include settings object');
    assert.equal(res.data.settings.theme, 'dark', 'Default theme must be "dark"');
    assert.ok(
      typeof res.data.settings.custom_colors === 'object' && res.data.settings.custom_colors !== null,
      'custom_colors must be an object'
    );
  });

  it('3.2: updates and persists all standard theme presets (light, slate, forest, midnight, amber)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_presets');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const presets = ['light', 'slate', 'forest', 'midnight', 'amber', 'dark'];

    for (const preset of presets) {
      const patchRes = await client.request('PATCH', '/api/users/@me/settings', {
        body: { theme: preset },
        token,
      });
      assert.equal(patchRes.status, 200, `Failed to update theme to ${preset}: ${patchRes.text}`);
      assert.equal(patchRes.data?.settings?.theme, preset, `Settings response theme should be ${preset}`);

      // Verify retrieval via GET /api/users/@me/settings
      const getRes = await client.request('GET', '/api/users/@me/settings', { token });
      assert.equal(getRes.status, 200);
      assert.equal(getRes.data?.settings?.theme, preset, `Persisted theme should be ${preset}`);
    }
  });

  it('3.3: configures custom color palette (brand, sidebar, chat) with custom theme preset', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_custom');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const customPalette = {
      brand: '#ff5722',
      sidebar: '#1e293b',
      chat: '#0f172a',
    };

    const patchRes = await client.request('PATCH', '/api/users/@me/settings', {
      body: {
        theme: 'custom',
        custom_colors: customPalette,
      },
      token,
    });

    assert.equal(patchRes.status, 200, `Failed to set custom palette: ${patchRes.text}`);
    const settings = patchRes.data.settings;
    assert.equal(settings.theme, 'custom');
    assert.equal(settings.custom_colors.brand, customPalette.brand);
    assert.equal(settings.custom_colors.sidebar, customPalette.sidebar);
    assert.equal(settings.custom_colors.chat, customPalette.chat);

    // Verify GET /api/users/@me/settings
    const getRes = await client.request('GET', '/api/users/@me/settings', { token });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.settings.theme, 'custom');
    assert.deepEqual(getRes.data.settings.custom_colors, customPalette);
  });

  it('3.4: custom color palette persists across preset changes and subsequent login sessions', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_persist');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const initialToken = reg.data.token;

    const customPalette = {
      brand: '#7c3aed',
      sidebar: '#18181b',
      chat: '#27272a',
    };

    // Step 1: Set custom colors
    await client.request('PATCH', '/api/users/@me/settings', {
      body: { theme: 'custom', custom_colors: customPalette },
      token: initialToken,
    });

    // Step 2: Switch to preset 'forest'
    await client.request('PATCH', '/api/users/@me/settings', {
      body: { theme: 'forest' },
      token: initialToken,
    });

    // Step 3: Re-login as the same user to obtain a new session token
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200, `Re-login failed: ${loginRes.text}`);
    const newToken = loginRes.data.token;
    assert.notEqual(newToken, initialToken, 'New session token should be generated');

    // Step 4: Verify bootstrap reflects persisted settings
    const bootRes = await client.bootstrap(newToken);
    assert.equal(bootRes.status, 200);
    assert.equal(bootRes.data.settings?.theme, 'forest');
    assert.equal(bootRes.data.settings?.custom_colors?.brand, customPalette.brand);
    assert.equal(bootRes.data.settings?.custom_colors?.sidebar, customPalette.sidebar);
    assert.equal(bootRes.data.settings?.custom_colors?.chat, customPalette.chat);

    // Step 5: Switch back to 'custom' and verify palette is still intact
    const switchBack = await client.request('PATCH', '/api/users/@me/settings', {
      body: { theme: 'custom' },
      token: newToken,
    });
    assert.equal(switchBack.status, 200);
    assert.equal(switchBack.data.settings.theme, 'custom');
    assert.deepEqual(switchBack.data.settings.custom_colors, customPalette);
  });

  it('3.5: immediately reflects updated theme in GET /api/bootstrap', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_boot');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Check initial bootstrap theme
    const boot1 = await client.bootstrap(token);
    assert.equal(boot1.status, 200);
    assert.equal(boot1.data.settings?.theme, 'dark');

    // Update to midnight
    const patchRes = await client.request('PATCH', '/api/users/@me/settings', {
      body: { theme: 'midnight' },
      token,
    });
    assert.equal(patchRes.status, 200);

    // Immediately verify bootstrap reflects midnight
    const boot2 = await client.bootstrap(token);
    assert.equal(boot2.status, 200);
    assert.equal(boot2.data.settings?.theme, 'midnight');
  });

  it('3.6: partial update of custom colors preserves unspecified color keys', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_partial');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Initialize full palette
    await client.request('PATCH', '/api/users/@me/settings', {
      body: {
        theme: 'custom',
        custom_colors: {
          brand: '#112233',
          sidebar: '#223344',
          chat: '#334455',
        },
      },
      token,
    });

    // Update only brand color
    const patchPartial = await client.request('PATCH', '/api/users/@me/settings', {
      body: {
        custom_colors: { brand: '#aabbcc' },
      },
      token,
    });
    assert.equal(patchPartial.status, 200);
    const colors = patchPartial.data.settings.custom_colors;
    assert.equal(colors.brand, '#aabbcc', 'Brand should be updated');
    assert.equal(colors.sidebar, '#223344', 'Sidebar should remain unchanged');
    assert.equal(colors.chat, '#334455', 'Chat should remain unchanged');
  });

  it('3.7: accepts settings updates enclosed inside a nested settings object', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('theme_nested');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    // Send payload formatted as { settings: { theme: "amber" } }
    const res = await client.request('PATCH', '/api/users/@me/settings', {
      body: {
        settings: {
          theme: 'amber',
        },
      },
      token,
    });
    assert.equal(res.status, 200, `Nested settings patch failed: ${res.text}`);
    assert.equal(res.data.settings.theme, 'amber');
  });
});

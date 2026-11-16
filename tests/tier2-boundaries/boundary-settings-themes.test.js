/**
 * Tier 2 Boundary Tests: Settings & Theme Customization Edge Cases
 * Requirements: Boundary Value Analysis & Negative Testing on Settings & Themes
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

describe('Tier 2: Settings & Theme Customization Boundaries', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  // --------------------------------------------------------------------------
  // Category A: Invalid Hex Color Strings
  // --------------------------------------------------------------------------

  it('B6.1: rejects non-hex characters in custom colors (e.g. #xyz, #gggggg, #12345z)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_hex_chars');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const invalidColors = ['#xyz', '#gggggg', '#12345z', '#zzzzzz', '#------'];

    for (const color of invalidColors) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { custom_colors: { brand: color } },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for invalid hex characters "${color}", got ${res.status}`
      );
    }
  });

  it('B6.2: rejects invalid hex color lengths (too short #12, #1, or too long #1234567)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_hex_len');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const invalidLengths = ['#', '#1', '#12', '#1234', '#12345', '#1234567', '#1234567890'];

    for (const color of invalidLengths) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { custom_colors: { sidebar: color } },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for invalid hex length "${color}", got ${res.status}`
      );
    }
  });

  it('B6.3: rejects hex colors missing leading "#" prefix or empty string', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_hex_prefix');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const invalidPrefixes = ['5865f2', 'ffffff', '000000', '', '   '];

    for (const color of invalidPrefixes) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { custom_colors: { chat: color } },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for color missing "#" or empty "${color}", got ${res.status}`
      );
    }
  });

  it('B6.4: rejects non-string types for custom color properties (numbers, booleans, arrays, objects)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_hex_types');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const invalidTypes = [
      { brand: 123456 },
      { sidebar: true },
      { chat: ['#ffffff'] },
      { brand: { nested: '#112233' } },
    ];

    for (const custom_colors of invalidTypes) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { custom_colors },
        token,
      });
      assert.ok(
        res.status === 400 || res.status === 422,
        `Expected HTTP 400 or 422 for non-string color property, got ${res.status}`
      );
    }
  });

  // --------------------------------------------------------------------------
  // Category B: Palette Map Limits & Unknown Properties
  // --------------------------------------------------------------------------

  it('B6.5: strips or rejects unknown and potentially malicious property keys in custom_colors', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_palette_keys');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const res = await client.request('PATCH', '/api/users/@me/settings', {
      body: {
        custom_colors: {
          brand: '#5865f2',
          evil_css: 'expression(alert(1))',
          unknown_key: '#112233',
        },
      },
      token,
    });

    if (res.status === 200) {
      // If accepted, must sanitize and strip unknown keys
      assert.equal(res.data.settings.custom_colors.evil_css, undefined);
      assert.equal(res.data.settings.custom_colors.unknown_key, undefined);
      assert.equal(res.data.settings.custom_colors.brand, '#5865f2');
    } else {
      assert.equal(res.status, 400, `Expected HTTP 400 or sanitized 200, got ${res.status}`);
    }
  });

  it('B6.6: handles massive number of keys in custom_colors without crashing', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_palette_overflow');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const massiveMap = { brand: '#5865f2' };
    for (let i = 0; i < 200; i++) {
      massiveMap[`key_${i}`] = '#ffffff';
    }

    const res = await client.request('PATCH', '/api/users/@me/settings', {
      body: { custom_colors: massiveMap },
      token,
    });

    assert.ok(
      res.status === 400 || res.status === 200,
      `Expected HTTP 400 or 200, got ${res.status}`
    );
    if (res.status === 200) {
      // Must not save all 200 keys
      const keys = Object.keys(res.data.settings.custom_colors || {});
      assert.ok(keys.length <= 10, 'custom_colors must be constrained to recognized palette keys');
    }
  });

  // --------------------------------------------------------------------------
  // Category C: Theme Presets & Control Character Validation
  // --------------------------------------------------------------------------

  it('B6.7: rejects unknown or unsupported theme preset names with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_theme_unknown');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const unknownPresets = ['neon', 'rainbow', 'hacker', 'matrix', 'super-dark', ''];

    for (const theme of unknownPresets) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { theme },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for unsupported theme preset "${theme}", got ${res.status}`
      );
    }
  });

  it('B6.8: rejects control characters and newlines in theme preset string', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_theme_ctrl');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const controlThemes = ['dark\n', 'light\r\n', 'slate\t', 'forest\x00', 'midnight\x1F'];

    for (const theme of controlThemes) {
      const res = await client.request('PATCH', '/api/users/@me/settings', {
        body: { theme },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for control char in theme "${JSON.stringify(theme)}", got ${res.status}`
      );
    }
  });

  it('B6.9: rejects control characters in profile fields (PATCH /api/users/@me)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_prof_ctrl');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const controlNames = ['Alice\nBob', 'Alice\r\nBob', 'Alice\x00Bob', 'Alice\tBob'];

    for (const name of controlNames) {
      const res = await client.request('PATCH', '/api/users/@me', {
        body: { display_name: name },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for control character in display_name "${JSON.stringify(name)}", got ${res.status}`
      );
    }
  });

  it('B6.10: rejects invalid avatar colors in profile update (PATCH /api/users/@me)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('b_prof_color');
    const password = randomPassword(12);
    const reg = await client.register(username, password);
    const token = reg.data.token;

    const invalidColors = ['not-a-color', '#xyz', '#12', '<script>', 'rgba(0,0,0,0)'];

    for (const color of invalidColors) {
      const res = await client.request('PATCH', '/api/users/@me', {
        body: { color },
        token,
      });
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for invalid profile avatar color "${color}", got ${res.status}`
      );
    }
  });
});

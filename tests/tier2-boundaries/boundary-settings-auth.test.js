/**
 * Tier 2 Boundary Tests: Settings Auth, Profile Limits, and Extreme Inputs
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

describe('Tier 2: Settings Auth & Profile Boundaries', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B6.11: rejects settings endpoints when Authorization header is missing with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const getRes = await client.request('GET', '/api/users/@me/settings');
    assert.equal(getRes.status, 401, `Expected HTTP 401 for unauthenticated GET, got ${getRes.status}`);

    const patchRes = await client.request('PATCH', '/api/users/@me/settings', {
      body: { theme: 'light' },
    });
    assert.equal(patchRes.status, 401, `Expected HTTP 401 for unauthenticated PATCH, got ${patchRes.status}`);
  });

  it('B6.12: rejects settings endpoints with invalid or malformed Bearer tokens with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const badTokens = ['forged_token_12345', 'Bearer ', 'x'.repeat(64)];
    for (const token of badTokens) {
      const res = await client.request('GET', '/api/users/@me/settings', { token });
      assert.equal(res.status, 401, `Expected HTTP 401 for invalid token "${token.slice(0, 10)}...", got ${res.status}`);
    }
  });

  it('B6.13: rejects oversized display_name (> 32 characters) with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const reg = await client.register(randomUsername('b_name_len'), randomPassword(12));
    const token = reg.data.token;

    for (const name of ['a'.repeat(33), 'a'.repeat(100)]) {
      const res = await client.request('PATCH', '/api/users/@me', { body: { display_name: name }, token });
      assert.equal(res.status, 400, `Expected HTTP 400 for ${name.length}-character display_name, got ${res.status}`);
    }
  });

  it('B6.14: accepts boundary 32-character display_name with HTTP 200 OK', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const reg = await client.register(randomUsername('b_name_32'), randomPassword(12));
    const token = reg.data.token;
    const exactly32 = 'x'.repeat(32);
    const res = await client.request('PATCH', '/api/users/@me', { body: { display_name: exactly32 }, token });
    assert.equal(res.status, 200);
    assert.equal(res.data.user?.display_name, exactly32);
  });

  it('B6.15: rejects extreme payload sizes in settings updates (> 10KB string) with HTTP 400 or 413', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const reg = await client.register(randomUsername('b_extreme_size'), randomPassword(12));
    const token = reg.data.token;
    const massiveColorString = '#' + 'a'.repeat(50000);
    const res = await client.request('PATCH', '/api/users/@me/settings', {
      body: { custom_colors: { brand: massiveColorString } },
      token,
    });
    assert.ok(res.status === 400 || res.status === 413 || res.status === 422, `Got ${res.status}`);
  });
});

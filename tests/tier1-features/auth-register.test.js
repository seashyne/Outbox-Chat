/**
 * Tier 1 Feature Tests: User Registration (POST /api/register)
 * Requirement R1: Production Authentication System
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
import { isValid64Hex } from '../helpers/crypto.js';

describe('Tier 1: User Registration (POST /api/register)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('1.1: successfully registers a new user with standard credentials and returns 200', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('reg_user');
    const password = randomPassword(16);

    const res = await client.register(username, password);

    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}: ${res.text}`);
    assert.ok(res.data, 'Expected JSON response body');
    assert.ok(typeof res.data.token === 'string', 'Expected string session token');
    assert.ok(isValid64Hex(res.data.token), `Token must be 64 hex characters, got: ${res.data.token}`);

    const user = res.data.user;
    assert.ok(user, 'Expected user object in response');
    assert.ok(typeof user.id === 'string' && user.id.length > 0, 'User ID must be non-empty string');
    assert.equal(user.username, username, 'Returned username must match submitted username');
    assert.equal(user.display_name, username, 'Display name should default to username');
    assert.ok(typeof user.color === 'string' && user.color.startsWith('#'), 'User color should be a hex color');
    assert.equal(user.bot, false, 'User must not be marked as a bot');
  });

  it('1.2: does not leak password, password_hash, or password_salt in the user object', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('sec_user');
    const password = randomPassword(20);

    const res = await client.register(username, password);
    assert.equal(res.status, 200);

    const user = res.data.user;
    assert.equal(user.password, undefined, 'User object must not contain plain password');
    assert.equal(user.password_hash, undefined, 'User object must not leak password_hash');
    assert.equal(user.password_salt, undefined, 'User object must not leak password_salt');
  });

  it('1.3: allows registration with minimum valid username length (1 character)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Use a single letter that is unlikely to be taken
    const singleChar = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // 'a'-'z'
    const password = randomPassword(12);

    const res = await client.register(singleChar, password);
    // If single char is taken, conflict 409 is acceptable, but if free, 200 OK.
    if (res.status === 409) {
      assert.match(res.data?.error || '', /already taken/i);
    } else {
      assert.equal(res.status, 200);
      assert.equal(res.data.user.username, singleChar);
    }
  });

  it('1.4: allows registration with maximum valid username length (32 characters)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Construct exact 32 characters username
    const base = `u32_${Date.now().toString(36)}_`;
    const fill = 'x'.repeat(Math.max(0, 32 - base.length));
    const username32 = (base + fill).slice(0, 32);
    assert.equal(username32.length, 32, 'Test username must be exactly 32 chars');

    const password = randomPassword(14);
    const res = await client.register(username32, password);

    assert.equal(res.status, 200, `Expected 200 for 32-char username: ${res.text}`);
    assert.equal(res.data.user.username, username32);
  });

  it('1.5: allows registration with minimum valid password length (8 characters)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('p8_user');
    const minPass = 'MinPass8';
    assert.equal(minPass.length, 8);

    const res = await client.register(username, minPass);
    assert.equal(res.status, 200, `Expected 200 for 8-char password: ${res.text}`);
    assert.ok(isValid64Hex(res.data.token));
  });

  it('1.6: allows registration with maximum valid password length (128 characters)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('p128_user');
    const maxPass = 'A1!'.repeat(42) + 'XY'; // 42*3 + 2 = 128 chars
    assert.equal(maxPass.length, 128);

    const res = await client.register(username, maxPass);
    assert.equal(res.status, 200, `Expected 200 for 128-char password: ${res.text}`);
    assert.ok(isValid64Hex(res.data.token));
  });

  it('1.7: allows registration with Unicode/international characters in username', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const thaiUser = `ผู้ใช้_${Date.now().toString(36).slice(-4)}`;
    const password = randomPassword(12);

    const res = await client.register(thaiUser, password);
    assert.equal(res.status, 200, `Expected 200 for Unicode username: ${res.text}`);
    assert.equal(res.data.user.username, thaiUser);
  });

  it('1.8: automatically assigns new registered users to the default demo server', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('demo_user');
    const password = randomPassword(12);

    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);

    const bootstrapRes = await client.bootstrap(regRes.data.token);
    assert.equal(bootstrapRes.status, 200);
    assert.ok(Array.isArray(bootstrapRes.data.servers), 'Servers must be an array');
    const demoServer = bootstrapRes.data.servers.find((s) => s.id === 'demo');
    assert.ok(demoServer, 'User should be a member of the default demo server');
  });
});

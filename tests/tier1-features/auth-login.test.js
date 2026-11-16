/**
 * Tier 1 Feature Tests: User Login & Token Issuance (POST /api/login)
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

describe('Tier 1: User Login (POST /api/login)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('2.1: logs in successfully with valid credentials and returns 200 with session token', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('login_u');
    const password = randomPassword(14);

    // Register first
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200, `Registration failed: ${regRes.text}`);

    // Now login
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200, `Login failed: ${loginRes.text}`);
    assert.ok(loginRes.data, 'Expected JSON body');
    assert.ok(typeof loginRes.data.token === 'string', 'Token must be a string');
    assert.ok(isValid64Hex(loginRes.data.token), 'Token must be 64-character hex');

    const user = loginRes.data.user;
    assert.ok(user, 'Expected user object in login response');
    assert.equal(user.username, username);
    assert.equal(user.bot, false);
  });

  it('2.2: supports case-insensitive username login (upper/lower case variations)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const baseName = `MixedCase_${Date.now().toString(36)}`;
    const password = randomPassword(16);

    const regRes = await client.register(baseName, password);
    assert.equal(regRes.status, 200);

    // Login with lower-case
    const lowerRes = await client.login(baseName.toLowerCase(), password);
    assert.equal(lowerRes.status, 200, `Lower-case login failed: ${lowerRes.text}`);
    assert.ok(isValid64Hex(lowerRes.data.token));

    // Login with UPPER-CASE
    const upperRes = await client.login(baseName.toUpperCase(), password);
    assert.equal(upperRes.status, 200, `Upper-case login failed: ${upperRes.text}`);
    assert.ok(isValid64Hex(upperRes.data.token));
  });

  it('2.3: issues independent valid session tokens across multiple consecutive logins', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('multilog');
    const password = randomPassword(12);

    await client.register(username, password);

    const login1 = await client.login(username, password);
    assert.equal(login1.status, 200);

    const login2 = await client.login(username, password);
    assert.equal(login2.status, 200);

    assert.ok(isValid64Hex(login1.data.token));
    assert.ok(isValid64Hex(login2.data.token));

    // Both tokens should be 64-char strings
    assert.equal(login1.data.token.length, 64);
    assert.equal(login2.data.token.length, 64);
  });

  it('2.4: returns consistent user identity between registration and login', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('ident_u');
    const password = randomPassword(14);

    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);

    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);

    const regUser = regRes.data.user;
    const loginUser = loginRes.data.user;

    assert.equal(loginUser.id, regUser.id, 'User ID must match across register and login');
    assert.equal(loginUser.username, regUser.username, 'Username must match');
    assert.equal(loginUser.display_name, regUser.display_name, 'Display name must match');
    assert.equal(loginUser.color, regUser.color, 'Avatar color must match');
    assert.equal(loginUser.bot, false);
  });

  it('2.5: never leaks password, password_hash, or password_salt in login response', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('leak_u');
    const password = randomPassword(16);

    await client.register(username, password);
    const loginRes = await client.login(username, password);

    assert.equal(loginRes.status, 200);
    const user = loginRes.data.user;
    assert.equal(user.password, undefined);
    assert.equal(user.password_hash, undefined);
    assert.equal(user.password_salt, undefined);
  });

  it('2.6: verifies that token issued by login can authenticate protected endpoints', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('auth_u');
    const password = randomPassword(14);

    await client.register(username, password);
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);

    const token = loginRes.data.token;
    const bootstrapRes = await client.bootstrap(token);

    assert.equal(bootstrapRes.status, 200, `Bootstrap failed with issued token: ${bootstrapRes.text}`);
    assert.equal(bootstrapRes.data.me.id, loginRes.data.user.id);
  });
});

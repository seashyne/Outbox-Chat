/**
 * Tier 2 Boundary Tests: Login Boundaries & Bot Protection
 * Requirement R1: POST /api/login boundary validation and Feature 8 Seed Bot Protection
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

describe('Tier 2: Login Boundaries (POST /api/login)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B2.1: rejects login for non-existent user with HTTP 401 Unauthorized', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const fakeUser = `nonexistent_${Date.now()}`;
    const res = await client.login(fakeUser, 'SomePassword123!');

    assert.equal(res.status, 401, `Expected 401, got ${res.status}: ${res.text}`);
    assert.match(res.data?.error || '', /invalid username or password/i);
  });

  it('B2.2: rejects login with incorrect password for existing user with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('badpwd_u');
    const correctPassword = randomPassword(16);

    const reg = await client.register(username, correctPassword);
    assert.equal(reg.status, 200);

    const badRes = await client.login(username, 'WrongPassword999!');
    assert.equal(badRes.status, 401, `Expected 401 for incorrect password, got ${badRes.status}`);
    assert.match(badRes.data?.error || '', /invalid username or password/i);
  });

  it('B2.3: rejects login for seed bot account (outbox-bot) with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Feature 8: Seed Bot Password Protection
    const botUsernames = ['outbox-bot', 'Outbox-Bot', 'OUTBOX-BOT'];
    const passwordsToTry = ['', 'password', 'admin', 'outbox', '12345678', randomPassword(16)];

    for (const botUser of botUsernames) {
      for (const pass of passwordsToTry) {
        const res = await client.login(botUser, pass);
        assert.ok(
          res.status === 401 || res.status === 400,
          `Expected 400/401 when attempting bot login with user="${botUser}", pass="${pass}", got ${res.status}`
        );
      }
    }
  });

  it('B2.4: rejects login with empty username or empty password with HTTP 400 or 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Empty username
    const res1 = await client.login('', 'Password123!');
    assert.ok(res1.status === 400 || res1.status === 401);

    // Empty password
    const res2 = await client.login('someuser', '');
    assert.ok(res2.status === 400 || res2.status === 401);

    // Whitespace username
    const res3 = await client.login('   ', 'Password123!');
    assert.ok(res3.status === 400 || res3.status === 401);
  });

  it('B2.5: rejects login with missing fields or malformed JSON with HTTP 400 or 422', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Missing password field
    const resNoPass = await client.request('POST', '/api/login', { body: { username: 'testuser' } });
    assert.ok(resNoPass.status === 400 || resNoPass.status === 401 || resNoPass.status === 422, `Expected 400, 401, or 422, got ${resNoPass.status}`);

    // Missing username field
    const resNoUser = await client.request('POST', '/api/login', { body: { password: 'Password123!' } });
    assert.ok(resNoUser.status === 400 || resNoUser.status === 401 || resNoUser.status === 422, `Expected 400, 401, or 422, got ${resNoUser.status}`);

    // Malformed JSON string
    const resInvalid = await client.request('POST', '/api/login', {
      body: '{"username": "test", badjson',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.ok(resInvalid.status === 400 || resInvalid.status === 422, `Expected HTTP 400 or 422 for malformed JSON, got ${resInvalid.status}`);
  });

  it('B2.6: returns uniform error message for non-existent user and bad password (credential enumeration prevention)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('enum_u');
    const password = randomPassword(16);

    await client.register(username, password);

    const wrongPassRes = await client.login(username, 'IncorrectPassword123!');
    const wrongUserRes = await client.login('completely_unknown_user_xyz', 'IncorrectPassword123!');

    assert.equal(wrongPassRes.status, 401);
    assert.equal(wrongUserRes.status, 401);
    // Both responses should share identical error semantics to prevent user enumeration
    assert.equal(wrongPassRes.data?.error, wrongUserRes.data?.error);
  });
});

/**
 * Tier 2 Boundary Tests: Registration Input Validation & Edge Cases
 * Requirement: Category-Partition & Boundary Value Analysis on POST /api/register
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

describe('Tier 2: Registration Boundaries (POST /api/register)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B1.1: rejects duplicate username with HTTP 409 Conflict', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('dup_u');
    const password = randomPassword(12);

    const first = await client.register(username, password);
    assert.equal(first.status, 200);

    const duplicate = await client.register(username, password);
    assert.equal(duplicate.status, 409, `Expected 409 Conflict, got ${duplicate.status}`);
    assert.match(duplicate.data?.error || '', /already taken/i);
  });

  it('B1.2: rejects case-insensitive duplicate username with HTTP 409 Conflict', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const base = `CaseDup_${Date.now().toString(36)}`;
    const password = randomPassword(12);

    const first = await client.register(base, password);
    assert.equal(first.status, 200);

    // Try lower-cased version
    const lowerDup = await client.register(base.toLowerCase(), password);
    assert.equal(lowerDup.status, 409, `Expected 409 Conflict for lower-case duplicate, got ${lowerDup.status}`);
    assert.match(lowerDup.data?.error || '', /already taken/i);

    // Try upper-cased version
    const upperDup = await client.register(base.toUpperCase(), password);
    assert.equal(upperDup.status, 409, `Expected 409 Conflict for upper-case duplicate, got ${upperDup.status}`);
    assert.match(upperDup.data?.error || '', /already taken/i);
  });

  it('B1.3: rejects empty or trimmed-empty username with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const password = randomPassword(12);

    // Empty string
    const emptyRes = await client.register('', password);
    assert.equal(emptyRes.status, 400, `Expected 400 for empty username, got ${emptyRes.status}`);

    // Whitespace only
    const whitespaceRes = await client.register('    ', password);
    assert.equal(whitespaceRes.status, 400, `Expected 400 for whitespace username, got ${whitespaceRes.status}`);
  });

  it('B1.4: rejects oversized username (> 32 characters) with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const password = randomPassword(12);
    const oversized33 = 'a'.repeat(33);

    const res = await client.register(oversized33, password);
    assert.equal(res.status, 400, `Expected 400 for 33-char username, got ${res.status}`);
    assert.match(res.data?.error || '', /username/i);
  });

  it('B1.5: rejects short password (< 8 characters) with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('short_p');
    const shortPass7 = '1234567'; // 7 characters
    assert.equal(shortPass7.length, 7);

    const res = await client.register(username, shortPass7);
    assert.equal(res.status, 400, `Expected 400 for 7-char password, got ${res.status}`);
    assert.match(res.data?.error || '', /password/i);
  });

  it('B1.6: rejects oversized password (> 128 characters) with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('long_p');
    const longPass129 = 'a'.repeat(129); // 129 characters
    assert.equal(longPass129.length, 129);

    const res = await client.register(username, longPass129);
    assert.equal(res.status, 400, `Expected 400 for 129-char password, got ${res.status}`);
    assert.match(res.data?.error || '', /password/i);
  });

  it('B1.7: rejects request with missing fields or malformed payload with HTTP 400 or 422', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Missing password
    const noPass = await client.request('POST', '/api/register', { body: { username: 'testuser' } });
    assert.ok(noPass.status === 400 || noPass.status === 422, `Expected HTTP 400 or 422 for missing password, got ${noPass.status}`);

    // Missing username
    const noUser = await client.request('POST', '/api/register', { body: { password: 'Password123!' } });
    assert.ok(noUser.status === 400 || noUser.status === 422, `Expected HTTP 400 or 422 for missing username, got ${noUser.status}`);

    // Empty object
    const emptyObj = await client.request('POST', '/api/register', { body: {} });
    assert.ok(emptyObj.status === 400 || emptyObj.status === 422, `Expected HTTP 400 or 422 for empty object, got ${emptyObj.status}`);

    // Non-JSON invalid string
    const invalidJson = await client.request('POST', '/api/register', {
      body: '{ not valid json',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.ok(invalidJson.status === 400 || invalidJson.status === 422, `Expected HTTP 400 or 422 for invalid JSON string, got ${invalidJson.status}`);
  });

  it('B1.8: rejects registration with control characters or newlines in username', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const controlUsers = ['user\nname', 'user\r\nname', 'user\x00name', 'user\tname'];
    for (const u of controlUsers) {
      const res = await client.register(u, 'ValidPassword123!');
      assert.ok(
        res.status === 400 || res.status === 422,
        `Expected 400 or 422 for control character in username "${u}", got ${res.status}`
      );
    }
  });

  it('B1.9: rejects registration where username is whitespace-only', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const res = await client.register('    ', 'ValidPassword123!');
    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for whitespace username, got ${res.status}`
    );
  });
});

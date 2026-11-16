/**
 * Tier 2 Boundary Tests: Session Token Validation & Authorization Edge Cases
 * Requirement R1: Protected Endpoint Authorization Boundaries
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiClient,
  TARGET_URL,
  isServerOnline,
  checkSkip,
} from '../helpers/client.js';
import { connectWs } from '../helpers/ws.js';

describe('Tier 2: Token Boundaries', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B3.1: rejects requests with completely missing Authorization header with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const endpoints = [
      ['GET', '/api/bootstrap'],
      ['GET', '/api/servers'],
      ['POST', '/api/servers'],
      ['GET', '/api/channels/demo-0/messages'],
      ['POST', '/api/channels/demo-0/messages'],
    ];

    for (const [method, path] of endpoints) {
      const res = await client.request(method, path);
      assert.equal(
        res.status,
        401,
        `Expected 401 for unauthenticated ${method} ${path}, got ${res.status}`
      );
      assert.match(res.data?.error || '', /invalid or missing token/i);
    }
  });

  it('B3.2: rejects malformed Authorization header schemes with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const malformedHeaders = [
      { Authorization: '' },
      { Authorization: 'Bearer' },
      { Authorization: 'Bearer   ' },
      { Authorization: 'Basic dXNlcjpwYXNz' },
      { Authorization: 'Token abcdef123456' },
      { Authorization: 'bearer lowercase-bearer' },
      { Authorization: 'RandomScheme 12345' },
    ];

    for (const headers of malformedHeaders) {
      const res = await client.request('GET', '/api/bootstrap', { headers });
      assert.equal(
        res.status,
        401,
        `Expected 401 for header ${JSON.stringify(headers)}, got ${res.status}`
      );
    }
  });

  it('B3.3: rejects fabricated or non-existent 64-hex tokens with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const fakeTokens = [
      '0'.repeat(64),
      'f'.repeat(64),
      'deadbeef'.repeat(8),
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ];

    for (const fakeToken of fakeTokens) {
      const res = await client.bootstrap(fakeToken);
      assert.equal(res.status, 401, `Expected 401 for fabricated token: ${fakeToken}`);
      assert.match(res.data?.error || '', /invalid or missing token/i);
    }
  });

  it('B3.4: rejects truncated and overlong tokens (length != 64) with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const invalidLengths = [
      'a'.repeat(32), // 32 chars (too short)
      'b'.repeat(63), // 63 chars (off by 1)
      'c'.repeat(65), // 65 chars (off by 1)
      'd'.repeat(128), // 128 chars (too long)
    ];

    for (const token of invalidLengths) {
      const res = await client.bootstrap(token);
      assert.equal(res.status, 401, `Expected 401 for token of length ${token.length}`);
    }
  });

  it('B3.5: safely handles malicious injection payloads in Authorization header without 500 error', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const injectionPayloads = [
      "' OR '1'='1",
      "'; DROP TABLE kv; --",
      '<script>alert(1)</script>',
      '{"$gt": ""}',
      '..%00../etc/passwd',
      'Bearer '.repeat(100),
    ];

    for (const payload of injectionPayloads) {
      try {
        const res = await client.request('GET', '/api/bootstrap', {
          headers: { Authorization: `Bearer ${payload}` },
        });
        assert.equal(
          res.status,
          401,
          `Expected 401 (not 500) for injection payload "${payload}", got ${res.status}`
        );
      } catch (err) {
        // If client-side HTTP stack rejects invalid header format before dispatch,
        // it's also acceptable client-side boundary defense
        if (err instanceof TypeError && err.message.includes('header')) {
          continue;
        }
        throw err;
      }
    }
  });

  it('B3.6: rejects WebSocket connection when token query parameter is missing or invalid', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    // Connect with empty token
    await assert.rejects(
      async () => {
        await connectWs('', { baseUrl: TARGET_URL, timeoutMs: 2000 });
      },
      /WebSocket/i,
      'Connecting to WS with empty token should be rejected'
    );

    // Connect with fabricated token
    await assert.rejects(
      async () => {
        await connectWs('0'.repeat(64), { baseUrl: TARGET_URL, timeoutMs: 2000 });
      },
      /WebSocket/i,
      'Connecting to WS with invalid token should be rejected'
    );
  });

  it('B3.7: rejects Authorization header with empty Bearer prefix ("Bearer ") with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const res = await client.request('GET', '/api/bootstrap', {
      headers: { Authorization: 'Bearer ' },
    });
    assert.equal(res.status, 401, `Expected 401 for empty Bearer token, got ${res.status}`);
  });

  it('B3.8: rejects Authorization header with unsupported schemes (e.g. Basic, Digest) with HTTP 401', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const badSchemes = [
      'Basic dXNlcjpwYXNz',
      'Digest username="test"',
      'Token abcdef',
      'CustomAuth 12345',
    ];

    for (const header of badSchemes) {
      const res = await client.request('GET', '/api/bootstrap', {
        headers: { Authorization: header },
      });
      assert.equal(res.status, 401, `Expected 401 for scheme "${header}", got ${res.status}`);
    }
  });
});

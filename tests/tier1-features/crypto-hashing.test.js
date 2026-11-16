/**
 * Tier 1 Feature Tests: Cryptographic Hashing & Password Security
 * Requirements: PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte salt (32 hex), 32-byte key (64 hex)
 * Covers RFC 6070 test vectors, constant-time verification, and credential omission.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  derivePbkdf2Hash,
  verifyPbkdf2Hash,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  KEY_BYTES,
  isValid32Hex,
  isValid64Hex,
} from '../helpers/crypto.js';
import {
  ApiClient,
  TARGET_URL,
  isServerOnline,
  checkSkip,
  randomUsername,
  randomPassword,
} from '../helpers/client.js';

describe('Tier 1: Cryptographic Hashing & Password Security', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('6.1: verifies RFC 6070 PBKDF2-HMAC-SHA256 test vector (c=1, dkLen=32)', () => {
    const saltHex = Buffer.from('salt').toString('hex');
    const expected = '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b';
    const derived = derivePbkdf2Hash('password', saltHex, 1, 32);

    assert.equal(derived, expected, 'Derived key must match RFC 6070 c=1 test vector');
    assert.ok(isValid64Hex(derived), 'Derived key must be a valid 64-character hex string');
    assert.equal(verifyPbkdf2Hash('password', saltHex, expected, 1), true);
  });

  it('6.2: verifies RFC 6070 PBKDF2-HMAC-SHA256 test vector (c=2, dkLen=32)', () => {
    const saltHex = Buffer.from('salt').toString('hex');
    const expected = 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43';
    const derived = derivePbkdf2Hash('password', saltHex, 2, 32);

    assert.equal(derived, expected, 'Derived key must match RFC 6070 c=2 test vector');
    assert.equal(verifyPbkdf2Hash('password', saltHex, expected, 2), true);
  });

  it('6.3: verifies RFC 6070 PBKDF2-HMAC-SHA256 test vector (c=4096, dkLen=32)', () => {
    const saltHex = Buffer.from('salt').toString('hex');
    const expected = 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a';
    const derived = derivePbkdf2Hash('password', saltHex, 4096, 32);

    assert.equal(derived, expected, 'Derived key must match RFC 6070 c=4096 test vector');
    assert.equal(verifyPbkdf2Hash('password', saltHex, expected, 4096), true);
  });

  it('6.4: derives PBKDF2 hash using production parameters (100,000 iterations, 16-byte salt, 32-byte key)', () => {
    assert.equal(PBKDF2_ITERATIONS, 100000, 'Iterations constant must be 100,000');
    assert.equal(SALT_BYTES, 16, 'Salt byte length must be 16');
    assert.equal(KEY_BYTES, 32, 'Key byte length must be 32');

    const randomSalt = crypto.randomBytes(SALT_BYTES).toString('hex');
    assert.equal(randomSalt.length, 32, 'Salt hex must be exactly 32 characters');
    assert.ok(isValid32Hex(randomSalt), 'Salt must be valid 32-character hex');

    const password = 'TestSecurePassword2026!';
    const hash = derivePbkdf2Hash(password, randomSalt, PBKDF2_ITERATIONS, KEY_BYTES);

    assert.equal(hash.length, 64, 'Derived key must be exactly 64 characters (32 bytes)');
    assert.ok(isValid64Hex(hash), 'Hash must be valid 64-character hex string');
  });

  it('6.5: constant-time verification correctly accepts matching credentials and rejects incorrect passwords', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const password = 'CorrectPassword999$';
    const hash = derivePbkdf2Hash(password, salt, PBKDF2_ITERATIONS, KEY_BYTES);

    // Matching password verification
    const valid = verifyPbkdf2Hash(password, salt, hash, PBKDF2_ITERATIONS);
    assert.equal(valid, true, 'Verification must return true for correct password');

    // Incorrect password verification
    const invalid = verifyPbkdf2Hash('WrongPassword999$', salt, hash, PBKDF2_ITERATIONS);
    assert.equal(invalid, false, 'Verification must return false for incorrect password');
  });

  it('6.6: PBKDF2 derivation is strictly deterministic for identical input parameters', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const password = 'DeterministicPassPhrase42!';

    const hash1 = derivePbkdf2Hash(password, salt, 1000, KEY_BYTES);
    const hash2 = derivePbkdf2Hash(password, salt, 1000, KEY_BYTES);

    assert.equal(hash1, hash2, 'Repeated derivations with identical parameters must yield identical hashes');
  });

  it('6.7: verifies omission of sensitive credentials (password_hash and password_salt) from register and login responses', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('sec_u');
    const password = randomPassword(16);

    // Register response
    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    assert.strictEqual(regRes.data.user?.password, undefined, 'Register user must not expose password');
    assert.strictEqual(regRes.data.user?.password_hash, undefined, 'Register user must not expose password_hash');
    assert.strictEqual(regRes.data.user?.password_salt, undefined, 'Register user must not expose password_salt');
    assert.strictEqual(regRes.data.password_hash, undefined, 'Root register response must not expose password_hash');
    assert.strictEqual(regRes.data.password_salt, undefined, 'Root register response must not expose password_salt');

    // Login response
    const loginRes = await client.login(username, password);
    assert.equal(loginRes.status, 200);
    assert.strictEqual(loginRes.data.user?.password, undefined, 'Login user must not expose password');
    assert.strictEqual(loginRes.data.user?.password_hash, undefined, 'Login user must not expose password_hash');
    assert.strictEqual(loginRes.data.user?.password_salt, undefined, 'Login user must not expose password_salt');
    assert.strictEqual(loginRes.data.password_hash, undefined, 'Root login response must not expose password_hash');
    assert.strictEqual(loginRes.data.password_salt, undefined, 'Root login response must not expose password_salt');
  });

  it('6.8: confirms session tokens match 64-hex specification and do not collide with password hashes', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('tok_u');
    const password = randomPassword(14);

    const regRes = await client.register(username, password);
    assert.equal(regRes.status, 200);
    const token = regRes.data.token;

    assert.ok(isValid64Hex(token), 'Session token must be 64-character hex');
    // Ensure token is distinct from PBKDF2 hash of the password
    const dummyHash = derivePbkdf2Hash(password, '00'.repeat(16), 1, KEY_BYTES);
    assert.notEqual(token, dummyHash, 'Session token must not be equivalent to raw password hash');
  });
});

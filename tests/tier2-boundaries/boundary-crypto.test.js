/**
 * Tier 2 Boundary & Corner Case Tests: Cryptographic Boundaries
 * Requirements: Invalid salt lengths, iteration count tampering, constant-time failure
 * on 1-bit difference, salt randomness/entropy, boundary password lengths, and helper validation.
 */

import { describe, it } from 'node:test';
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

describe('Tier 2: Cryptographic Boundaries & Corner Cases', () => {
  it('B6.1: handles boundary and invalid salt lengths and formats', () => {
    // Valid 32-character hex salt (16 bytes)
    const validSalt = 'a'.repeat(32);
    assert.equal(isValid32Hex(validSalt), true);

    // Invalid salt lengths / values
    const invalidSalts = [
      '',                     // Empty
      'a'.repeat(31),         // 31 hex characters (odd / short)
      'a'.repeat(33),         // 33 hex characters (long)
      'g'.repeat(32),         // Non-hex characters
      'xyz!@#$',              // Special characters
      null,
      undefined,
      12345,
    ];

    for (const invalid of invalidSalts) {
      assert.equal(isValid32Hex(invalid), false, `Expected isValid32Hex to be false for: ${invalid}`);
    }

    // Verify truncated odd-length salt produces different hash than padded valid salt
    const truncatedSalt = 'ab';
    const standardSalt = 'ab'.padEnd(32, '0');
    const hashTruncated = derivePbkdf2Hash('password', truncatedSalt, 10, KEY_BYTES);
    const hashStandard = derivePbkdf2Hash('password', standardSalt, 10, KEY_BYTES);
    assert.notEqual(hashTruncated, hashStandard);
  });

  it('B6.2: iteration count sensitivity: altering iteration count produces completely different derived key', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const password = 'BoundaryPassword123!';

    // Compare 100,000 iterations vs 99,999 iterations
    const hashExact = derivePbkdf2Hash(password, salt, 100000, KEY_BYTES);
    const hashMinusOne = derivePbkdf2Hash(password, salt, 99999, KEY_BYTES);
    const hashSmall = derivePbkdf2Hash(password, salt, 1, KEY_BYTES);

    assert.notEqual(hashExact, hashMinusOne, 'Changing iteration count by 1 must produce completely different hash');
    assert.notEqual(hashExact, hashSmall, 'Low iteration count must not match production iterations');
    assert.equal(verifyPbkdf2Hash(password, salt, hashExact, 99999), false);
    assert.equal(verifyPbkdf2Hash(password, salt, hashExact, 100000), true);
  });

  it('B6.3: constant-time failure on 1-bit difference in expected hash', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const password = 'PreciseEqualityCheck99!';
    const validHash = derivePbkdf2Hash(password, salt, 1000, KEY_BYTES);

    // Flip exactly 1 bit in the last character
    const lastChar = validHash[validHash.length - 1];
    const flippedChar = lastChar === '0' ? '1' : '0';
    const tamperedHash = validHash.slice(0, -1) + flippedChar;

    assert.equal(validHash.length, tamperedHash.length);
    assert.notEqual(validHash, tamperedHash);

    // Constant-time verify must fail on 1-bit modification
    const isValid = verifyPbkdf2Hash(password, salt, tamperedHash, 1000);
    assert.equal(isValid, false, 'verifyPbkdf2Hash must return false on 1-bit altered hash');

    // Constant-time verify must fail if hash length is truncated
    const truncatedHash = validHash.slice(0, 32);
    assert.equal(verifyPbkdf2Hash(password, salt, truncatedHash, 1000), false);
  });

  it('B6.4: salt randomness & entropy: generates 100 random salts and verifies uniqueness and byte length', () => {
    const saltSet = new Set();
    const count = 100;

    for (let i = 0; i < count; i++) {
      const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
      assert.equal(salt.length, 32, 'Salt must be 32 hex chars (16 bytes)');
      assert.ok(isValid32Hex(salt), 'Must satisfy isValid32Hex');
      saltSet.add(salt);
    }

    assert.equal(saltSet.size, count, 'All 100 generated salts must be cryptographically unique without collisions');
  });

  it('B6.5: derives PBKDF2 hash across boundary password lengths (empty, 8 chars, 128 chars)', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');

    // Minimum allowed length (8 characters)
    const minPass = 'MinLen8!';
    const minHash = derivePbkdf2Hash(minPass, salt, 500, KEY_BYTES);
    assert.ok(isValid64Hex(minHash));

    // Maximum allowed length (128 characters)
    const maxPass = 'P'.repeat(128);
    const maxHash = derivePbkdf2Hash(maxPass, salt, 500, KEY_BYTES);
    assert.ok(isValid64Hex(maxHash));

    // Empty string password edge case
    const emptyHash = derivePbkdf2Hash('', salt, 500, KEY_BYTES);
    assert.ok(isValid64Hex(emptyHash));
    assert.notEqual(minHash, maxHash);
    assert.notEqual(minHash, emptyHash);
  });

  it('B6.6: handles Unicode, emoji, and multibyte passwords consistently in PBKDF2', () => {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const unicodePass = 'パスワード🔑日本語UTF8';

    const hash1 = derivePbkdf2Hash(unicodePass, salt, 1000, KEY_BYTES);
    const hash2 = derivePbkdf2Hash(unicodePass, salt, 1000, KEY_BYTES);

    assert.ok(isValid64Hex(hash1));
    assert.equal(hash1, hash2, 'Unicode passwords must derive deterministically');
    assert.equal(verifyPbkdf2Hash(unicodePass, salt, hash1, 1000), true);
    assert.equal(verifyPbkdf2Hash(unicodePass + 'x', salt, hash1, 1000), false);
  });

  it('B6.7: isValid64Hex and isValid32Hex rigorously reject malformed format strings', () => {
    // 64 hex characters validation
    assert.equal(isValid64Hex('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), true);
    assert.equal(isValid64Hex('0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'), true);
    assert.equal(isValid64Hex('0123456789abcdef'.repeat(3)), false); // 48 chars
    assert.equal(isValid64Hex('0123456789abcdef'.repeat(5)), false); // 80 chars
    assert.equal(isValid64Hex('g'.repeat(64)), false); // non-hex
    assert.equal(isValid64Hex(null), false);
    assert.equal(isValid64Hex({}), false);

    // 32 hex characters validation
    assert.equal(isValid32Hex('0123456789abcdef0123456789abcdef'), true);
    assert.equal(isValid32Hex('0123456789ABCDEF0123456789ABCDEF'), true);
    assert.equal(isValid32Hex('0123456789abcdef'.repeat(3)), false); // 48 chars
    assert.equal(isValid32Hex('g'.repeat(32)), false); // non-hex
  });
});

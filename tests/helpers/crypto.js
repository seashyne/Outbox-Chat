/**
 * Cryptographic Validation Helpers for Outbox Chat E2E Tests
 * Uses Node.js built-in `node:crypto` module.
 * PBKDF2-HMAC-SHA256, 100,000 iterations, 32-byte key, 16-byte salt.
 */

import crypto from 'node:crypto';

export const PBKDF2_ITERATIONS = 100000;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

/**
 * Derives a PBKDF2-HMAC-SHA256 key hex string.
 * @param {string} password
 * @param {string} saltHex - 32-character hex salt
 * @param {number} [iterations]
 * @param {number} [keyBytes]
 * @returns {string} 64-character hex hash
 */
export function derivePbkdf2Hash(
  password,
  saltHex,
  iterations = PBKDF2_ITERATIONS,
  keyBytes = KEY_BYTES
) {
  const saltBuf = Buffer.from(saltHex, 'hex');
  const derived = crypto.pbkdf2Sync(
    password,
    saltBuf,
    iterations,
    keyBytes,
    'sha256'
  );
  return derived.toString('hex');
}

/**
 * Verifies a password against a salt and expected PBKDF2 hash using timing-safe comparison.
 * @param {string} password
 * @param {string} saltHex
 * @param {string} expectedHashHex
 * @param {number} [iterations]
 * @returns {boolean}
 */
export function verifyPbkdf2Hash(
  password,
  saltHex,
  expectedHashHex,
  iterations = PBKDF2_ITERATIONS
) {
  const actualHashHex = derivePbkdf2Hash(password, saltHex, iterations, KEY_BYTES);
  const actualBuf = Buffer.from(actualHashHex, 'hex');
  const expectedBuf = Buffer.from(expectedHashHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Validates that a string is a 64-character lowercase or uppercase hex string (session token / password hash).
 * @param {string} str
 * @returns {boolean}
 */
export function isValid64Hex(str) {
  return typeof str === 'string' && /^[0-9a-fA-F]{64}$/.test(str);
}

/**
 * Validates that a string is a 32-character hex string (salt).
 * @param {string} str
 * @returns {boolean}
 */
export function isValid32Hex(str) {
  return typeof str === 'string' && /^[0-9a-fA-F]{32}$/.test(str);
}

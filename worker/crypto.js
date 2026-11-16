/**
 * Web Crypto PBKDF2-HMAC-SHA256 password hashing and constant-time comparison
 * for the Cloudflare Workers backend.
 */

const textEncoder = new TextEncoder();

/** Encodes a Uint8Array as lowercase hex. */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decodes a hex string into a Uint8Array, returning null on invalid input. */
export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const val = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(val)) return null;
    bytes[i / 2] = val;
  }
  return bytes;
}

/** Constant-time string comparison to avoid timing side-channels on password hashes. */
export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Generates a 16-byte cryptographically random hex salt. */
export function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Derives a 256-bit PBKDF2-HMAC-SHA256 hex digest (100,000 iterations). */
export async function hashPassword(password, saltHex) {
  const saltBytes = hexToBytes(saltHex);
  if (!saltBytes) throw new Error("Invalid salt");
  const passBytes = textEncoder.encode(password);
  const key = await crypto.subtle.importKey(
    "raw",
    passBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

/** Returns UTF-8 byte length of a string (matches Rust `str::len`). */
export function utf8Length(str) {
  return textEncoder.encode(str).length;
}

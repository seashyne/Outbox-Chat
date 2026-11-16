//! Pure-Rust cryptographic utilities for Outbox Chat.
//!
//! Splits low-level hashing primitives (`sha256.rs`) from high-level password
//! hashing, hex encoding, constant-time equality, and OS-entropy salt helpers.

mod sha256;
#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub use sha256::{hmac_sha256, pbkdf2_hmac_sha256, HmacSha256, Sha256};

/// Iteration count matching Cloudflare Workers Web Crypto parameters.
pub const PBKDF2_ITERATIONS: u32 = 100_000;
/// Derived key length in bytes (256-bit).
pub const PBKDF2_KEY_LEN: usize = 32;

/// Encodes raw bytes as lowercase hexadecimal.
pub fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

/// Decodes a hexadecimal string into bytes, returning `None` if malformed.
pub fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[i..i + 2], 16).ok()?;
        bytes.push(byte);
    }
    Some(bytes)
}

/// Compares two byte slices without short-circuiting on mismatched bytes.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Compares two strings in constant time when lengths match.
pub fn constant_time_eq_str(a: &str, b: &str) -> bool {
    constant_time_eq(a.as_bytes(), b.as_bytes())
}

/// Generates a 16-byte random salt from `/dev/urandom`, falling back to UUIDv4 entropy.
pub fn random_salt() -> [u8; 16] {
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        if f.read_exact(&mut buf).is_ok() {
            return buf;
        }
    }
    let u1 = uuid::Uuid::new_v4();
    let u2 = uuid::Uuid::new_v4();
    let b1 = u1.as_bytes();
    let b2 = u2.as_bytes();
    for i in 0..16 {
        buf[i] = b1[i] ^ b2[15 - i];
    }
    buf
}

/// Generates a 32-character hex-encoded random salt.
pub fn random_salt_hex() -> String {
    hex_encode(&random_salt())
}

/// Derives a PBKDF2-HMAC-SHA256 hex digest from `password` and `salt_hex`.
pub fn hash_password(password: &str, salt_hex: &str) -> Result<String, &'static str> {
    let salt = hex_decode(salt_hex).ok_or("invalid hex salt")?;
    let mut out = [0u8; PBKDF2_KEY_LEN];
    pbkdf2_hmac_sha256(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut out);
    Ok(hex_encode(&out))
}

/// Verifies `password` against a stored hex salt and expected hex hash in constant time.
pub fn verify_password(password: &str, salt_hex: &str, expected_hash_hex: &str) -> bool {
    if expected_hash_hex.is_empty() || salt_hex.is_empty() {
        return false;
    }
    match hash_password(password, salt_hex) {
        Ok(computed) => constant_time_eq_str(&computed, expected_hash_hex),
        Err(_) => false,
    }
}
